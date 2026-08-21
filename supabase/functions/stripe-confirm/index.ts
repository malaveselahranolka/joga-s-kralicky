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
//  DŮLEŽITÉ: tahle funkce dělá TY SAMÉ kontroly jako stripe-webhook
//  (částka, měna, počet míst, shoda session). Kdyby je dělal jen webhook,
//  stačilo by útočníkovi jít touhle cestou. Měníš-li kontroly tady,
//  změň je i tam.
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

    // Rezervaci pozná JEN metadata.booking_id, které nastavuje výhradně
    // stripe-create. client_reference_id se záměrně neuznává — ten si
    // k pevnému platebnímu odkazu připíše kdokoli.
    const bookingId = (s as any)?.metadata?.booking_id ?? null;
    if (!bookingId) return json({ ok: true, paid: false, error: "no_booking_ref" });

    if (s.payment_status !== "paid") {
      return json({ ok: true, paid: false });
    }

    const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
    const { data: bk, error: bkErr } = await admin
      .from("bookings")
      .select("id, spots, payment_status, payment_amount, payment_ref")
      .eq("id", bookingId)
      .maybeSingle();
    if (bkErr) return json({ ok: false, error: "booking_lookup_failed", detail: bkErr.message }, 500);
    if (!bk) return json({ ok: true, paid: false, error: "booking_not_found" });

    // Už zaplaceno dřív (nejspíš webhookem) → nic nepřepisujeme.
    if (bk.payment_status === "paid") return json({ ok: true, paid: true });

    // --- stejné kontroly jako ve webhooku ---
    if (String(s.currency).toLowerCase() !== "czk") {
      return json({ ok: false, error: "currency_mismatch" }, 409);
    }
    if (bk.payment_ref && bk.payment_ref !== s.id) {
      return json({ ok: false, error: "session_mismatch" }, 409);
    }
    const metaSpots = Number((s as any)?.metadata?.spots);
    if (!Number.isFinite(metaSpots) || metaSpots !== Number(bk.spots)) {
      return json({ ok: false, error: "spots_mismatch" }, 409);
    }
    const entryCzk = Number(env("PAYMENT_ENTRY_CZK", env("PAYMENT_DEPOSIT_CZK", "499")));
    const expected = Number(bk.payment_amount) > 0
      ? Number(bk.payment_amount)
      : Math.round(entryCzk * 100) * Number(bk.spots);
    if (Number(s.amount_total) !== expected) {
      return json({ ok: false, error: "amount_mismatch" }, 409);
    }

    const { error } = await admin.from("bookings").update({
      payment_status: "paid",
      paid_at: new Date().toISOString(),
      payment_method: "online",
      payment_ref: s.id,
      payment_amount: s.amount_total,
      hold_expires_at: null,   // zaplaceno → místo se už neuvolňuje
    }).eq("id", bookingId);
    if (error) return json({ ok: false, error: "db_update_failed", detail: error.message }, 500);

    return json({ ok: true, paid: true });
  } catch (e) {
    return json({ ok: false, error: "server_error", detail: String(e) }, 500);
  }
});
