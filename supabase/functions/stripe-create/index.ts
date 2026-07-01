// =====================================================================
//  stripe-create — založí Stripe Checkout platbu (zálohu) k rezervaci
//  Volá se z webu po úspěšné rezervaci. Vstup: { booking_id }
//  Výstup: { ok, url }  → web na 'url' přesměruje zákazníka (Stripe Checkout).
//
//  Bezpečnost: částku určuje SERVER (PAYMENT_DEPOSIT_CZK), ne prohlížeč.
//  Tajný klíč Stripe je jen v prostředí (Supabase secrets):
//    STRIPE_SECRET_KEY   – sk_test_... / sk_live_...
//    PAYMENT_DEPOSIT_CZK – výše zálohy v Kč (výchozí 290)
//    SITE_URL            – adresa webu (návrat po platbě)
// =====================================================================
import Stripe from "https://esm.sh/stripe@14.21.0?target=denonext";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const env = (n: string, d = "") => Deno.env.get(n) ?? d;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const { booking_id } = await req.json().catch(() => ({}));
    if (!booking_id) return json({ ok: false, error: "missing_booking_id" }, 400);

    const sk = env("STRIPE_SECRET_KEY");
    if (!sk) return json({ ok: false, error: "stripe_not_configured" }, 500);
    const stripe = new Stripe(sk, { httpClient: Stripe.createFetchHttpClient(), apiVersion: "2024-06-20" });

    const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
    const { data: bk, error } = await admin
      .from("bookings")
      .select("id, email, spots, payment_status, lesson:lessons(title)")
      .eq("id", booking_id)
      .single();
    if (error || !bk) return json({ ok: false, error: "booking_not_found" }, 404);
    if (bk.payment_status === "paid") return json({ ok: false, error: "already_paid" }, 409);

    const depositCzk = Number(env("PAYMENT_DEPOSIT_CZK", "290"));
    const unit = Math.round(depositCzk * 100); // haléře
    const qty = Math.max(1, Number(bk.spots) || 1);
    const lessonTitle = (bk as any).lesson?.title ?? "Lekce jógy";
    const base = env("SITE_URL", "https://malaveselahranolka.github.io/joga-s-kralicky/").replace(/\/$/, "");

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: bk.email,
      line_items: [{
        quantity: qty,
        price_data: {
          currency: "czk",
          unit_amount: unit,
          product_data: { name: `Záloha – ${lessonTitle} (Jóga s králíčky)` },
        },
      }],
      metadata: { booking_id: String(bk.id) },
      payment_intent_data: { metadata: { booking_id: String(bk.id) } },
      success_url: `${base}/?platba=ok#rezervace`,
      cancel_url: `${base}/?platba=zrus#rezervace`,
    });

    await admin.from("bookings").update({
      payment_status: "pending",
      payment_amount: unit * qty,
      payment_ref: session.id,
      payment_method: "online",
    }).eq("id", bk.id);

    return json({ ok: true, url: session.url });
  } catch (e) {
    return json({ ok: false, error: "server_error", detail: String(e) }, 500);
  }
});
