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
  // booking_id chodí dvěma cestami:
  //  • metadata.booking_id      — když platbu zakládá funkce stripe-create
  //  • client_reference_id      — když web posílá zákazníka na Payment Link
  //                               s ?client_reference_id=<id rezervace>
  const bookingId = obj?.metadata?.booking_id || obj?.client_reference_id;
  const isVoucher = obj?.metadata?.type === "voucher";

  if (bookingId) {
    // Sloupec hold_expires_at přidává až online-only.sql, proto se nastavuje
    // zvlášť — kdyby ještě nebyl, nesmí to shodit zápis stavu platby.
    if (event.type === "checkout.session.completed") {
      await admin.from("bookings").update({
        payment_status: "paid",
        paid_at: new Date().toISOString(),
        payment_method: "online",
      }).eq("id", bookingId);
      await admin.from("bookings").update({ hold_expires_at: null }).eq("id", bookingId);
    } else if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
      await admin.from("bookings").update({ payment_status: "failed" }).eq("id", bookingId);
      // platba nedopadla → místo pustíme hned zpátky do nabídky
      await admin.from("bookings").update({ hold_expires_at: new Date().toISOString() })
        .eq("id", bookingId).neq("payment_status", "paid");
    }
  } else if (isVoucher && event.type === "checkout.session.completed") {
    // Dárkové poukazy zaplaceny → vygeneruj kódy a ulož je.
    // Kódy jsou DETERMINISTICKÉ ze session id, protože úplně stejný výpočet
    // dělá i web v rezervace.html (funkce voucherCodes) — jinak by host viděl
    // jiné kódy, než jaké máš v adminu. Když ten výpočet měníš, změň ho na
    // obou místech naráz.
    const count = Math.max(1, Number(obj?.metadata?.count) || 1);
    const stem = "DK-" + String(obj.id).replace(/[^A-Za-z0-9]/g, "").slice(-8).toUpperCase();
    const email = obj?.customer_details?.email || obj?.customer_email || null;
    const total = obj?.amount_total ?? null;
    const each = total != null ? Math.round(total / count) : null;

    const rows = Array.from({ length: count }, (_, i) => ({
      code: count === 1 ? stem : `${stem}-${i + 1}`,
      email,
      amount: each,          // cena za JEDEN poukaz, ne celá objednávka
      session_id: obj.id,
      redeemed: false,
    }));
    await admin.from("vouchers").upsert(rows, { onConflict: "code" });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
