// =====================================================================
//  stripe-voucher — Stripe Checkout na koupi dárkových poukazů
//  Volá se z koupit-poukaz.html. Vstup: { email, count, druh }
//  → Výstup: { ok, url, amount_czk }
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

// ---------------------------------------------------------------------
//  DRUHY POUKAZŮ — na jakou lekci poukaz platí
//
//  Web si seznam bere z payment-config.js (voucherDruhy), ale ROZHODUJE
//  tenhle. Druh, který tu není aktivní, server odmítne, i kdyby si ho
//  někdo do požadavku dopsal ručně.
//
//  `deti` (lekce pro rodiče s dětmi) je PŘIPRAVENÝ, ale VYPNUTÝ, protože
//  lekce ještě není hotová. Až bude, postup spuštění:
//    1. Databáze: sloupec public.vouchers.druh (text, výchozí 'klasik')
//       a RPC na uplatnění (create_booking_poukazem, redeem_voucher)
//       musí dětský poukaz pustit jen na dětskou lekci a naopak.
//       Lekce proto potřebuje vlastní označení druhu, ne jen název.
//    2. stripe-webhook a stripe-confirm: číst metadata.druh, zapsat ho
//       do sloupce `druh` a ověřit částku podle ceny TOHO druhu (teď obě
//       počítají s jednou cenou PAYMENT_VOUCHER_CZK).
//    3. Tady: `aktivni: true` (a případně vlastní cena přes secret).
//    4. payment-config.js: `aktivni: true` u `deti` → na webu se objeví
//       výběr lekce.
//    5. E-mail s poukazem a PDF: napsat, na jakou lekci poukaz platí.
// ---------------------------------------------------------------------
const DRUHY: Record<string, { nazev: string; aktivni: boolean }> = {
  klasik: { nazev: "Dárkový poukaz – vstup na lekci (Jóga s králíčky)", aktivni: true },
  deti: { nazev: "Dárkový poukaz – lekce Děti a králíci (Jóga s králíčky)", aktivni: false },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const { email, count, druh } = await req.json().catch(() => ({}));
    const sk = env("STRIPE_SECRET_KEY");
    if (!sk) return json({ ok: false, error: "stripe_not_configured" }, 500);

    // Starší web druh neposílal — bez něj je to klasický poukaz.
    const druhId = typeof druh === "string" && druh ? druh : "klasik";
    const typ = Object.prototype.hasOwnProperty.call(DRUHY, druhId) ? DRUHY[druhId] : null;
    if (!typ || !typ.aktivni) return json({ ok: false, error: "druh_nedostupny" }, 400);

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
            name: typ.nazev,
            description: `${pieces} × ${czk} Kč`,
            // Vycentrovaný králík — Stripe fotku ořízne do čtverce.
            images: [`${base}/assets/photos/rabbit-1.jpg`],
          },
        },
      }],
      custom_text: {
        submit: { message: "Kódy poukazů dostanete hned po zaplacení e-mailem." },
      },
      metadata: { type: "voucher", count: String(qty), druh: druhId },
      // Metadata relace se na platbu samy nepřenesou. Bez tohohle řádku
      // dorazí platba za poukaz do peněžních pohybů bez jakékoli značky
      // a souhrn ji vykáže jako nespárovaný příjem — přestože je to
      // poctivý prodej, jen započítaný z tabulky poukazů.
      // Stejný postup jako u rezervací ve stripe-create.
      payment_intent_data: { metadata: { type: "voucher", count: String(qty), druh: druhId } },
      // Poukaz se kupuje na vlastní stránce (dřív na rezervace.html, ta
      // teď starý návrat s ?voucher= jen přesměruje sem).
      success_url: `${base}/koupit-poukaz.html?voucher=ok&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/koupit-poukaz.html?voucher=zrus`,
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
