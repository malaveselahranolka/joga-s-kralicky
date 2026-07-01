// =====================================================================
//  stripe-webhook — sem Stripe posílá potvrzení o zaplacení
//  Tuhle URL nastavíš ve Stripe Dashboard (Developers → Webhooks).
//  Ověří podpis (STRIPE_WEBHOOK_SECRET) a zapíše stav platby k rezervaci.
//
//  DŮLEŽITÉ: tuhle funkci nasaď s VYPNUTÝM ověřováním JWT
//  (Stripe neposílá Supabase token). V Dashboardu = přepínač „Verify JWT" OFF,
//  přes CLI = `supabase functions deploy stripe-webhook --no-verify-jwt`.
//
//  Secrets:  STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
// =====================================================================
import Stripe from "https://esm.sh/stripe@14.21.0?target=denonext";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const env = (n: string, d = "") => Deno.env.get(n) ?? d;

Deno.serve(async (req) => {
  const sk = env("STRIPE_SECRET_KEY");
  const whSecret = env("STRIPE_WEBHOOK_SECRET");
  if (!sk || !whSecret) return new Response("not configured", { status: 500 });

  const stripe = new Stripe(sk, { httpClient: Stripe.createFetchHttpClient() });
  const sig = req.headers.get("stripe-signature");
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body, sig!, whSecret, undefined, Stripe.createSubtleCryptoProvider(),
    );
  } catch (e) {
    return new Response("bad signature: " + String(e), { status: 400 });
  }

  const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
  const obj = event.data.object as any;
  const bookingId = obj?.metadata?.booking_id;
  const isVoucher = obj?.metadata?.type === "voucher";

  if (bookingId) {
    if (event.type === "checkout.session.completed") {
      await admin.from("bookings").update({
        payment_status: "paid",
        paid_at: new Date().toISOString(),
        payment_method: "online",
      }).eq("id", bookingId);
    } else if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
      await admin.from("bookings").update({ payment_status: "failed" }).eq("id", bookingId);
    }
  } else if (isVoucher && event.type === "checkout.session.completed") {
    // dárkový poukaz zaplacen → vygeneruj kód a ulož (kód je deterministický ze session id)
    const code = "DK-" + String(obj.id).replace(/[^A-Za-z0-9]/g, "").slice(-8).toUpperCase();
    const email = obj?.customer_details?.email || obj?.customer_email || null;
    const amount = obj?.amount_total ?? null;
    await admin.from("vouchers").upsert({
      code, email, amount, session_id: obj.id, redeemed: false,
    }, { onConflict: "code" });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
