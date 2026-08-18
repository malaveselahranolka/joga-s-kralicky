// =====================================================================
//  stripe-voucher — Stripe Checkout na koupi dárkových poukazů
//  Volá se z webu. Vstup: { email, count }  → Výstup: { ok, url, amount_czk }
//  Po zaplacení webhook vygeneruje kódy poukazů a uloží je.
//
//  Počet kusů určuje zákazník, ale částku počítá SERVER:
//      cena za poukaz (PAYMENT_VOUCHER_CZK) × počet kusů
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

const MAX_VOUCHERS = 10;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const { email, count } = await req.json().catch(() => ({}));
    const sk = env("STRIPE_SECRET_KEY");
    if (!sk) return json({ ok: false, error: "stripe_not_configured" }, 500);

    // Verzi API schválně nefixujeme — výchozí verze účtu umí branding_settings.
    const stripe = new Stripe(sk, { httpClient: Stripe.createFetchHttpClient() });

    const czk = Number(env("PAYMENT_VOUCHER_CZK", "499"));
    const qty = Math.min(MAX_VOUCHERS, Math.max(1, Number(count) || 1));
    const base = env("SITE_URL", "https://www.jogaskralicky.cz/").replace(/\/$/, "");
    const pieces = qty === 1 ? "1 poukaz" : (qty < 5 ? qty + " poukazy" : qty + " poukazů");

    const params: any = {
      mode: "payment",
      customer_email: email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email)) ? String(email) : undefined,
      // Jen karta (+ Apple Pay a Google Pay), stejně jako u rezervací.
      payment_method_types: ["card"],
      line_items: [{
        quantity: qty,
        price_data: {
          currency: "czk",
          unit_amount: Math.round(czk * 100),
          product_data: {
            name: "Dárkový poukaz – vstup na lekci (Jóga s králíčky)",
            description: `${pieces} × ${czk} Kč`,
            // Vycentrovaný králík — Stripe fotku ořízne do čtverce.
            images: [`${base}/assets/photos/rabbit-1.jpg`],
          },
        },
      }],
      custom_text: {
        submit: { message: "Kódy poukazů dostanete hned po zaplacení e-mailem." },
      },
      metadata: { type: "voucher", count: String(qty) },
      success_url: `${base}/rezervace.html?voucher=ok&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/rezervace.html?voucher=zrus`,
    };

    // Vzhled brány — stejné hodnoty jako ve stripe-create, ať to ladí.
    // Mění se TADY, ne ve Stripe Dashboardu (ten to nepřebije).
    const extras = {
      branding_settings: {
        background_color: "#2C3B2E",
        button_color: "#2C3B2E",
        display_name: "Jóga s králíčky",
        border_style: "rounded",
      },
      wallet_options: { link: { display: "never" } },
    };

    // Kdyby Stripe doplňky nepřijal, platba se založí bez nich.
    let session;
    try {
      session = await stripe.checkout.sessions.create({ ...params, ...extras });
    } catch (_e) {
      session = await stripe.checkout.sessions.create(params);
    }

    return json({ ok: true, url: session.url, amount_czk: czk * qty, count: qty });
  } catch (e) {
    return json({ ok: false, error: "server_error", detail: String(e) }, 500);
  }
});
