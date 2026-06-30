// =====================================================================
//  comgate-create — založí platbu (zálohu) k existující rezervaci
//  Volá se z webu po úspěšné rezervaci. Vstup: { booking_id }
//  Výstup: { ok, redirect }  → web na 'redirect' přesměruje zákazníka.
//
//  Bezpečnost: částku určuje SERVER (COMGATE_DEPOSIT_CZK), ne prohlížeč.
//  Edge funkce čte/zapisuje přes service-role klíč (mimo RLS).
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cors, env, createPayment } from "../_shared/comgate.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const { booking_id } = await req.json().catch(() => ({}));
    if (!booking_id) return json({ ok: false, error: "missing_booking_id" }, 400);

    const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

    // načti rezervaci + lekci (kvůli e-mailu a popisku)
    const { data: bk, error } = await sb
      .from("bookings")
      .select("id, email, name, spots, payment_status, lesson:lessons(title, starts_at)")
      .eq("id", booking_id)
      .single();
    if (error || !bk) return json({ ok: false, error: "booking_not_found" }, 404);
    if (bk.payment_status === "paid") return json({ ok: false, error: "already_paid" }, 409);

    const depositCzk = Number(env("COMGATE_DEPOSIT_CZK", "290"));
    const priceHaler = Math.round(depositCzk * 100) * Math.max(1, Number(bk.spots) || 1);
    const lessonTitle = (bk as any).lesson?.title ?? "Lekce jógy";

    const r = await createPayment({
      priceHaler,
      curr: "CZK",
      label: `Záloha – ${lessonTitle} (Jóga s králíčky)`,
      refId: String(bk.id),
      email: bk.email,
      lang: "cs",
    });

    if (r.code !== "0" || !r.redirect) {
      return json({ ok: false, error: "comgate_error", detail: r.message || r.code }, 502);
    }

    // ulož transId + pending k rezervaci
    await sb.from("bookings").update({
      payment_status: "pending",
      payment_amount: priceHaler,
      payment_ref: r.transId,
    }).eq("id", bk.id);

    return json({ ok: true, redirect: r.redirect, transId: r.transId });
  } catch (e) {
    return json({ ok: false, error: "server_error", detail: String(e) }, 500);
  }
});
