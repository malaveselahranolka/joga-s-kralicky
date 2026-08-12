// =====================================================================
//  stripe-confirm — po návratu z platby se zeptá Stripu, jestli je
//  zaplaceno, a zapíše to k rezervaci.
//
//  Proč to existuje: dřív se „zaplaceno" zapisovalo JEN webhookem. Když
//  webhook nechodí (není nasazený, sedí v jiném režimu než platba —
//  test vs live, špatný whsec), rezervace zůstane navždy „nezaplaceno"
//  a host to vidí u QR kódu. Tahle funkce je druhá, nezávislá cesta.
//
//  Vstup:  { session_id: "cs_live_..." }   (z návratové URL platby)
//  Výstup: { ok, paid }
//
//  Bezpečné: stav si bereme přímo ze Stripu, prohlížeči nevěříme nic — a ven
//  neposíláme nic než „zaplaceno ano/ne". Nasazuj s VYPNUTÝM „Verify JWT":
//  bez platného ID platební session (nedohledatelné, dlouhé náhodné) funkce
//  nic neudělá, a s ním jen potvrdí to, co Stripe stejně říká.
//
//  Secrets:  STRIPE_SECRET_KEY
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
    const { session_id } = await req.json().catch(() => ({}));
    if (!session_id || !/^cs_[A-Za-z0-9_]+$/.test(String(session_id))) {
      return json({ ok: false, error: "missing_session_id" }, 400);
    }

    const sk = env("STRIPE_SECRET_KEY");
    if (!sk) return json({ ok: false, error: "stripe_not_configured" }, 500);
    const stripe = new Stripe(sk, { httpClient: Stripe.createFetchHttpClient(), apiVersion: "2024-06-20" });

    const s = await stripe.checkout.sessions.retrieve(String(session_id));

    // ID rezervace chodí dvěma cestami — stejně jako ve webhooku
    const bookingId = (s as any)?.metadata?.booking_id || s?.client_reference_id;
    if (!bookingId) return json({ ok: true, paid: false, error: "no_booking_ref" });

    if (s.payment_status !== "paid" && s.payment_status !== "no_payment_required") {
      return json({ ok: true, paid: false });
    }

    const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
    const { error } = await admin.from("bookings").update({
      payment_status: "paid",
      paid_at: new Date().toISOString(),
      payment_method: "online",
      payment_ref: s.id,
      payment_amount: s.amount_total ?? null,
    }).eq("id", bookingId);
    if (error) return json({ ok: false, error: "db_update_failed", detail: error.message }, 500);

    return json({ ok: true, paid: true });
  } catch (e) {
    return json({ ok: false, error: "server_error", detail: String(e) }, 500);
  }
});
