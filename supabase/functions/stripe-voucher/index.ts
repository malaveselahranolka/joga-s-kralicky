// =====================================================================
//  stripe-voucher — Stripe Checkout na koupi dárkových poukazů
//  Volá se z koupit-poukaz.html. Vstup: { email, count, druh, deti }
//  → Výstup: { ok, url, amount_czk }
//  Po zaplacení webhook vygeneruje kódy poukazů a uloží je.
//
//  Počet kusů (a u dětského poukazu počet dětí) určuje zákazník, ale
//  částku počítá SERVER:
//      cena za poukaz daného druhu × počet kusů
//
//  Secrets:  STRIPE_SECRET_KEY, PAYMENT_VOUCHER_CZK (výchozí 499),
//            PAYMENT_DETI_CZK (výchozí 1090), PAYMENT_DETI_DITE_CZK
//            (výchozí 500), SITE_URL
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
//  `deti` (lekce Děti & králíčci, zákonný zástupce + 1 až 4 děti) je
//  v prodeji od 24. 9. 2026. Co k němu patří jinde:
//    * databáze: vouchers.druh a create_booking_poukazem pouští poukaz jen
//      na lekci stejného druhu (supabase/poukaz-deti.sql), vouchers.deti
//      a 1 + deti míst při uplatnění (supabase/poukaz-deti-pocet.sql)
//    * stripe-webhook a stripe-confirm: druh z metadat, cena podle druhu
//      (_shared/poukaz-druh.ts — ceny tam musí sedět s tabulkou níž)
//    * e-mail a PDF: věta „na jakou lekci" podle druhu
// ---------------------------------------------------------------------
//  Cena: klasický poukaz PAYMENT_VOUCHER_CZK (499). Dětský poukaz stojí
//  stejně jako vstup na dětskou lekci: zákonný zástupce + 1 dítě
//  PAYMENT_DETI_CZK (1090), každé další dítě PAYMENT_DETI_DITE_CZK (500),
//  nejvýš maxDeti dětí na poukaz. Počet dětí jde do metadat (deti)
//  a databáze podle něj při uplatnění zabere 1 + deti míst.
type Druh = {
  nazev: string; aktivni: boolean; cenaEnv: string; cenaVychozi: string;
  diteEnv?: string; diteVychozi?: string; maxDeti?: number;
};
const DRUHY: Record<string, Druh> = {
  klasik: { nazev: "Dárkový poukaz – vstup na lekci (Jóga s králíčky)", aktivni: true, cenaEnv: "PAYMENT_VOUCHER_CZK", cenaVychozi: "499" },
  deti: {
    nazev: "Dárkový poukaz – lekce Děti & králíčci (Jóga s králíčky)", aktivni: true,
    cenaEnv: "PAYMENT_DETI_CZK", cenaVychozi: "1090",
    diteEnv: "PAYMENT_DETI_DITE_CZK", diteVychozi: "500", maxDeti: 4,
  },
};
const S_DETMI = ["s jedním dítětem", "se dvěma dětmi", "se třemi dětmi", "se čtyřmi dětmi"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const { email, count, druh, deti } = await req.json().catch(() => ({}));
    const sk = env("STRIPE_SECRET_KEY");
    if (!sk) return json({ ok: false, error: "stripe_not_configured" }, 500);

    // Starší web druh neposílal — bez něj je to klasický poukaz.
    const druhId = typeof druh === "string" && druh ? druh : "klasik";
    const typ = Object.prototype.hasOwnProperty.call(DRUHY, druhId) ? DRUHY[druhId] : null;
    if (!typ || !typ.aktivni) return json({ ok: false, error: "druh_nedostupny" }, 400);

    // Verzi API schválně nefixujeme — výchozí verze účtu umí branding_settings.
    const stripe = new Stripe(sk, { httpClient: Stripe.createFetchHttpClient() });

    // Počet dětí má smysl jen u dětského poukazu; mimo rozsah se odmítne,
    // ať zákazník nezaplatí za jiný počet, než si vybral.
    let detiN = 1;
    if (typ.maxDeti) {
      detiN = deti === undefined || deti === null || deti === "" ? 1 : Number(deti);
      if (!Number.isInteger(detiN) || detiN < 1 || detiN > typ.maxDeti) {
        return json({ ok: false, error: "invalid_deti" }, 400);
      }
    }
    const czk = Number(env(typ.cenaEnv, typ.cenaVychozi)) +
      (typ.diteEnv ? Number(env(typ.diteEnv, typ.diteVychozi)) * (detiN - 1) : 0);
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
            description: typ.maxDeti
              ? `${pieces} × ${czk} Kč · zákonný zástupce ${S_DETMI[detiN - 1]}`
              : `${pieces} × ${czk} Kč`,
            // Vycentrovaný králík — Stripe fotku ořízne do čtverce.
            images: [`${base}/assets/photos/rabbit-1.jpg`],
          },
        },
      }],
      custom_text: {
        submit: { message: "Kódy poukazů dostanete hned po zaplacení e-mailem." },
      },
      metadata: { type: "voucher", count: String(qty), druh: druhId, deti: String(detiN) },
      // Metadata relace se na platbu samy nepřenesou. Bez tohohle řádku
      // dorazí platba za poukaz do peněžních pohybů bez jakékoli značky
      // a souhrn ji vykáže jako nespárovaný příjem — přestože je to
      // poctivý prodej, jen započítaný z tabulky poukazů.
      // Stejný postup jako u rezervací ve stripe-create.
      payment_intent_data: { metadata: { type: "voucher", count: String(qty), druh: druhId, deti: String(detiN) } },
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

    return json({ ok: true, url: session.url, amount_czk: czk * qty, count: qty, deti: detiN });
  } catch (e) {
    return json({ ok: false, error: "server_error", detail: String(e) }, 500);
  }
});
