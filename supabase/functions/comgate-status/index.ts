// =====================================================================
//  comgate-status — pro návratovou stránku: vrátí stav platby
//  GET ?refId=<booking_id>  nebo  ?transId=<comgate transId>
//  Výstup: { ok, status: 'paid'|'pending'|'cancelled'|'failed'|'none' }
//  Žádná osobní data ven nepouští.
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cors, env, paymentStatus, mapStatus } from "../_shared/comgate.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const url = new URL(req.url);
    const refId = url.searchParams.get("refId");
    const transId = url.searchParams.get("transId");
    const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

    let row: { payment_status: string; payment_ref: string | null } | null = null;
    if (refId) {
      const { data } = await sb.from("bookings").select("payment_status, payment_ref").eq("id", refId).single();
      row = data as any;
    } else if (transId) {
      const { data } = await sb.from("bookings").select("payment_status, payment_ref").eq("payment_ref", transId).single();
      row = data as any;
    } else {
      return json({ ok: false, error: "missing_id" }, 400);
    }
    if (!row) return json({ ok: true, status: "none" });

    // pokud čekáme, doptej se Comgate naživo a stav osvěž
    if (row.payment_status === "pending" && row.payment_ref) {
      const st = await paymentStatus(row.payment_ref);
      const fresh = mapStatus(st.status);
      if (fresh !== "pending") {
        await sb.from("bookings").update({
          payment_status: fresh,
          paid_at: fresh === "paid" ? new Date().toISOString() : null,
        }).eq("payment_ref", row.payment_ref);
      }
      return json({ ok: true, status: fresh });
    }

    return json({ ok: true, status: row.payment_status });
  } catch (e) {
    return json({ ok: false, error: "server_error", detail: String(e) }, 500);
  }
});
