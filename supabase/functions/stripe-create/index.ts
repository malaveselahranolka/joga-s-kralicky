// =====================================================================
//  stripe-create — založí Stripe Checkout platbu k rezervaci
//  Volá se z webu hned po vytvoření rezervace. Vstup: { booking_id }
//  Výstup: { ok, url, amount_czk, spots }  → web na 'url' přesměruje hosta.
//
//  Platí se VÝHRADNĚ ONLINE a částku určuje SERVER, ne prohlížeč:
//      cena za místo (PAYMENT_ENTRY_CZK) × počet míst v rezervaci
//  Díky quantity vidí host v bráně i rozpis „499 Kč × 3 osoby".
//
//  Tajný klíč Stripe je jen v prostředí (Supabase secrets):
//    STRIPE_SECRET_KEY   – sk_test_... / sk_live_...
//    PAYMENT_ENTRY_CZK   – cena za jedno místo v Kč (výchozí 499)
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

// Jak dlouho platí odkaz na platbu. Stripe povoluje nejméně 30 minut a web
// drží místo 35 minut (supabase/online-only.sql), takže se to potkává.
const SESSION_MINUTES = 30;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const { booking_id } = await req.json().catch(() => ({}));
    if (!booking_id) return json({ ok: false, error: "missing_booking_id" }, 400);

    const sk = env("STRIPE_SECRET_KEY");
    if (!sk) return json({ ok: false, error: "stripe_not_configured" }, 500);
    // Verzi API schválně NEfixujeme — použije se výchozí verze účtu, která
    // je novější a umí branding_settings (vzhled brány) níž. Napevno zadaná
    // stará verze by ten parametr odmítla.
    const stripe = new Stripe(sk, { httpClient: Stripe.createFetchHttpClient() });

    const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
    const { data: bk, error } = await admin
      .from("bookings")
      .select("id, email, spots, status, payment_status, lesson:lessons(title)")
      .eq("id", booking_id)
      .single();
    if (error || !bk) return json({ ok: false, error: "booking_not_found" }, 404);
    if (bk.status === "cancelled") return json({ ok: false, error: "booking_cancelled" }, 409);
    if (bk.payment_status === "paid") return json({ ok: false, error: "already_paid" }, 409);

    // Prodluž držení místa a zároveň ověř, že místa pořád jsou. Když mezitím
    // rezervace propadla a lekce se naplnila, platbu vůbec nezakládáme —
    // ať host neplatí za místo, které už není.
    const { data: hold } = await admin.rpc("hold_booking", {
      p_id: booking_id,
      p_minutes: SESSION_MINUTES + 5,
    });
    if (hold && hold.ok === false) {
      return json({ ok: false, error: hold.error || "hold_failed" }, 409);
    }

    const entryCzk = Number(env("PAYMENT_ENTRY_CZK", env("PAYMENT_DEPOSIT_CZK", "499")));
    const unit = Math.round(entryCzk * 100); // haléře
    const qty = Math.max(1, Number(bk.spots) || 1);
    const lessonTitle = (bk as any).lesson?.title ?? "Lekce jógy";
    const base = env("SITE_URL", "https://www.jogaskralicky.cz/").replace(/\/$/, "");
    const persons = qty === 1 ? "1 osoba" : (qty < 5 ? qty + " osoby" : qty + " osob");

    // Fotka k lekci — v platební bráně se ukáže nad názvem, ať to není holá plocha.
    //
    // POZOR na výběr: Stripe fotku ořízne do ČTVERCE. Fotky jógy z assets/photos
    // jsou umělecké detaily těla bez hlavy — ve čtverci z nich vyjdou nechtěné
    // výřezy (yoga-11 takhle udělal detail rozkroku). Proto tu jsou jen králíci:
    // mají subjekt uprostřed a ořez jim nevadí. Než sem dáš jinou fotku,
    // podívej se, jak vypadá ve čtvercovém výřezu.
    const t = lessonTitle.toLowerCase();
    const photo = t.includes("děti") ? "rabbit-6.jpg" : "rabbit-1.jpg";

    const params: any = {
      mode: "payment",
      customer_email: bk.email,
      // Jen karta — vypíná Link (peněženka Stripu) a Klarnu (nákup na splátky).
      // Apple Pay a Google Pay tím NEzmizí, ty jezdí jako karta.
      // POZOR: tohle přebíjí Settings → Payment methods ve Stripe Dashboardu.
      // Chceš někdy přidat další způsob platby? Přidej ho sem do seznamu.
      payment_method_types: ["card"],
      expires_at: Math.floor(Date.now() / 1000) + SESSION_MINUTES * 60,
      line_items: [{
        quantity: qty,
        price_data: {
          currency: "czk",
          unit_amount: unit,
          product_data: {
            name: `${lessonTitle} — vstup (Jóga s králíčky)`,
            description: `Rezervace na jméno, ${persons} × ${entryCzk} Kč`,
            images: [`${base}/assets/photos/${photo}`],
          },
        },
      }],
      custom_text: {
        submit: { message: "Místo na lekci držíme 35 minut, než platbu dokončíte." },
      },
      metadata: { booking_id: String(bk.id), spots: String(qty) },
      payment_intent_data: { metadata: { booking_id: String(bk.id), spots: String(qty) } },
      // {CHECKOUT_SESSION_ID} doplní Stripe — web se pak brány zeptá,
      // jestli je opravdu zaplaceno (funkce stripe-confirm).
      success_url: `${base}/rezervace.html?platba=ok&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/rezervace.html?platba=zrus`,
    };

    // ---------------------------------------------------------------
    //  VZHLED PLATEBNÍ BRÁNY
    //  POZOR: tohle PŘEBÍJÍ nastavení ve Stripe Dashboardu (Branding).
    //  Chceš jiné barvy? Změň je TADY, ne v dashboardu — ten už na tuhle
    //  bránu nemá vliv. (Dashboard dál řídí vzhled e-mailových účtenek
    //  a odkazu na dárkový poukaz.)
    //  Barvy jsou z webu: --forest #2C3B2E. Logo a ikonu bereme z účtu.
    // ---------------------------------------------------------------
    const branding = {
      background_color: "#2C3B2E",   // levý panel — lesní zeleň jako na webu
      button_color: "#2C3B2E",       // dřív bílé tlačítko na bílé = vypadalo neaktivně
      display_name: "Jóga s králíčky", // dřív se zákazníkům ukazovalo „kralicci"
      border_style: "rounded",
    };

    // Nastavení navíc, bez kterých platba funguje taky. Kdyby je Stripe
    // nepřijal, založíme platbu bez nich — radši brána v základním vzhledu
    // než žádná brána.
    // Peněženku Link tu schválně nevypínáme. Šlo by to přes
    // wallet_options.link.display = "never", jenže kdyby to Stripe odmítl,
    // spadne to sem dolů do fallbacku a přišli bychom i o barvy. Link nikomu
    // nevadí a Apple Pay ani Google Pay nijak neblokuje.
    const extras = { branding_settings: branding };

    let session;
    try {
      session = await stripe.checkout.sessions.create({ ...params, ...extras });
    } catch (_e) {
      session = await stripe.checkout.sessions.create(params);
    }

    await admin.from("bookings").update({
      payment_status: "pending",
      payment_amount: unit * qty,
      payment_ref: session.id,
      payment_method: "online",
    }).eq("id", bk.id);

    return json({ ok: true, url: session.url, amount_czk: entryCzk * qty, spots: qty });
  } catch (e) {
    return json({ ok: false, error: "server_error", detail: String(e) }, 500);
  }
});
