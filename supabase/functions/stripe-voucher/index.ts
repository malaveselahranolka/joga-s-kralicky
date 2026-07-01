// =====================================================================
//  stripe-voucher — Stripe Checkout na koupi dárkového poukazu (499 Kč)
//  Volá se z webu. Vstup: { email }  → Výstup: { ok, url }
//  Po zaplacení webhook vygeneruje kód poukazu a uloží ho.
//
//  Secrets:  STRIPE_SECRET_KEY, PAYMENT_VOUCHER_CZK (výchozí 499), SITE_URL
// =====================================================================
import Stripe from "https://esm.sh/stripe@14.21.0?target=denonext";

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
    const { email } = await req.json().catch(() => ({}));
    const sk = env("STRIPE_SECRET_KEY");
    if (!sk) return json({ ok: false, error: "stripe_not_configured" }, 500);
    const stripe = new Stripe(sk, { httpClient: Stripe.createFetchHttpClient(), apiVersion: "2024-06-20" });

    const czk = Number(env("PAYMENT_VOUCHER_CZK", "499"));
    const base = env("SITE_URL", "https://malaveselahranolka.github.io/joga-s-kralicky/").replace(/\/$/, "");

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email)) ? String(email) : undefined,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "czk",
          unit_amount: Math.round(czk * 100),
          product_data: { name: "Dárkový poukaz – jednorázový vstup (Jóga s králíčky)" },
        },
      }],
      metadata: { type: "voucher" },
      success_url: `${base}/rezervace.html?voucher=ok&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/rezervace.html?voucher=zrus`,
    });

    return json({ ok: true, url: session.url });
  } catch (e) {
    return json({ ok: false, error: "server_error", detail: String(e) }, 500);
  }
});
