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
//
//  ---------------------------------------------------------------------
//  TŘI PRAVIDLA, KTERÁ TAHLE FUNKCE DRŽÍ (a dřív nedržela):
//
//  1) NEVĚŘÍME, ŽE JE ZAPLACENO SPRÁVNĚ. Ověřujeme, že částka, měna a počet
//     míst v Stripe session sedí s tím, co má rezervace v databázi. Dřív
//     stačilo, že platba dorazila — takže zaplacení jednoho vstupu mohlo
//     označit celou vícemístnou rezervaci jako uhrazenou.
//
//  2) NEBEREME client_reference_id. Ten si k libovolnému pevnému platebnímu
//     odkazu připíše kdokoli. Rezervaci teď pozná jen metadata.booking_id,
//     které nastavuje výhradně naše funkce stripe-create.
//
//  3) NELŽEME STRIPU. Když zápis do databáze selže, vrátíme 5xx a Stripe
//     doručení zopakuje. Dřív se vracelo 200 i po chybě, takže zaplacená
//     rezervace mohla navždy zůstat „nezaplaceno" a nikdo se to nedozvěděl.
//
//  Opakované doručení té samé události řeší tabulka public.stripe_events
//  (vkládáme event.id jako primární klíč — druhý pokus na něm neprojde).
// =====================================================================
import Stripe from "https://esm.sh/stripe@14.21.0?target=denonext";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { bookingEmail, voucherEmail, enqueue, dispatch } from "../_shared/email.ts";

const env = (n: string, d = "") => Deno.env.get(n) ?? d;

// Stripe čeká na naši odpověď a odesílání e-mailů je pomalé (EmailJS má
// limit 1 požadavek za sekundu). Pustíme ho tedy na pozadí a odpovíme hned.
// Co se nestihne, zůstane ve frontě a vezme si to dispatcher nebo admin.
function sendInBackground(admin: unknown) {
  const job = dispatch(admin, 3).catch((e) =>
    console.error("stripe-webhook: rozeslani na pozadi selhalo", String(e)));
  // @ts-ignore EdgeRuntime existuje jen v Supabase runtime
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(job);
}

Deno.serve(async (req) => {
  const sk = env("STRIPE_SECRET_KEY");
  const whSecret = env("STRIPE_WEBHOOK_SECRET");
  // Bez tajného klíče nemá funkce jak cokoli ověřit. Chybějící podpisový
  // secret ale fatální není — níž je druhá cesta přes dotaz u Stripu.
  if (!sk) return new Response("not configured", { status: 500 });

  const stripe = new Stripe(sk, { httpClient: Stripe.createFetchHttpClient() });
  const sig = req.headers.get("stripe-signature");
  const body = await req.text();

  // ---------------------------------------------------------------
  //  OVĚŘENÍ, ŽE UDÁLOST OPRAVDU POSLAL STRIPE
  //  Dvě cesty, v tomhle pořadí:
  //
  //  1) PODPIS (STRIPE_WEBHOOK_SECRET) — standardní a nejlevnější způsob.
  //
  //  2) DOTAZ PŘÍMO STRIPU — když podpis neprojde. Z těla si vezmeme JEDINÉ
  //     id události, vyzvedneme si ji naším tajným klíčem a s tělem požadavku
  //     dál nepracujeme. Autorita je výhradně odpověď Stripu, takže podvržený
  //     obsah nemá jak projít.
  //
  //     Proč to tu je: sdílený podpisový secret se rozejde snadno (překlep,
  //     mezera při kopírování, přeložený endpoint) a selhává TIŠE. Přesně to
  //     se stalo 15.–21. 8. 2026: 123 událostí po sobě skončilo na „bad
  //     signature", Stripe endpoint vypnul a zaplacenému zákazníkovi nevznikl
  //     poukaz. Tahle druhá cesta drží systém funkční i tehdy.
  //
  //     Cena: jedno volání Stripe API navíc. Přísná kontrola tvaru id běží
  //     ještě před ním, aby se z endpointu nedal dělat zesilovač požadavků.
  // ---------------------------------------------------------------
  let event: Stripe.Event;
  try {
    if (!whSecret) throw new Error("STRIPE_WEBHOOK_SECRET not set");
    event = await stripe.webhooks.constructEventAsync(
      body, sig!, whSecret, undefined, Stripe.createSubtleCryptoProvider(),
    );
  } catch (sigErr) {
    let id: unknown = null;
    try { id = JSON.parse(body)?.id; } catch (_e) { /* nevalidní JSON */ }
    if (typeof id !== "string" || !/^evt_[A-Za-z0-9]+$/.test(id)) {
      return new Response("bad signature: " + String(sigErr), { status: 400 });
    }
    try {
      event = await stripe.events.retrieve(id);
      console.warn("stripe-webhook: podpis neprosel, udalost overena dotazem u Stripu", id);
    } catch (_e) {
      return new Response("event not found: " + id, { status: 400 });
    }
  }

  const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
  const obj = event.data.object as any;

  // ---------------------------------------------------------------
  //  ODPOVĚDI
  //  ok()      – zpracováno, Stripe už nemusí posílat znovu
  //  reject()  – událost neprošla kontrolou. Vracíme 200 schválně:
  //              opakování by dopadlo stejně. Důvod zůstane v
  //              public.stripe_events, ať je v adminu vidět.
  //  retry()   – naše chyba (databáze). 5xx → Stripe to zkusí znovu.
  // ---------------------------------------------------------------
  const ok = (note = "processed") =>
    new Response(JSON.stringify({ received: true, status: note }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });

  const mark = async (status: string, error: string | null, bookingId: string | null) => {
    // Deník je jediné místo, kde je v adminu vidět, co se s událostí stalo.
    // Když se zápis nepovede, obchodní změna už proběhla a Stripe nemá co
    // opakovat — ale nesmí to zmizet potichu, jinak se ztratí stopa.
    const { error: markErr } = await admin.from("stripe_events")
      .update({ status, error, booking_id: bookingId })
      .eq("id", event.id);
    if (markErr) console.error("stripe-webhook: denik se nezapsal", event.id, status, markErr.message);
  };

  const reject = async (reason: string, bookingId: string | null = null) => {
    console.error("stripe-webhook ODMITNUTO", event.id, event.type, reason);
    await mark("rejected", reason, bookingId);
    return ok("rejected: " + reason);
  };

  // Naše chyba → 5xx, Stripe to zkusí znovu. Záznam v deníku necháme se
  // stavem 'failed', ať ho druhý pokus pozná jako nedokončený a smí ho
  // zpracovat. (Kdybychom ho mazali a mazání selhalo, zůstal by navždy
  // ve stavu 'processing' a další doručení by se odmítalo jako duplicita.)
  const retry = async (reason: string) => {
    console.error("stripe-webhook CHYBA DB", event.id, event.type, reason);
    await admin.from("stripe_events").update({ status: "failed", error: reason }).eq("id", event.id);
    return new Response(JSON.stringify({ error: reason }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  };

  // ---------------------------------------------------------------
  //  IDEMPOTENCE
  //  Vložení event.id je zámek: kdo ho vloží, ten událost zpracuje.
  //  Druhé doručení narazí na primární klíč (23505). Dokončenou událost
  //  podruhé nezpracováváme; nedokončenou (spadlý pokus) ano.
  //  Případné dvojí zpracování nevadí — zápisy jsou idempotentní
  //  (nastavit „paid" podruhé nic nezmění, poukazy jdou přes upsert).
  // ---------------------------------------------------------------
  const { error: lockErr } = await admin.from("stripe_events").insert({
    id: event.id, type: event.type, status: "processing",
  });
  if (lockErr) {
    if (lockErr.code !== "23505") return await retry("event_lock_failed: " + lockErr.message);

    const { data: prior, error: priorErr } = await admin
      .from("stripe_events").select("status").eq("id", event.id).maybeSingle();
    if (priorErr) return await retry("event_recheck_failed: " + priorErr.message);
    const unfinished = prior?.status === "processing" || prior?.status === "failed";
    if (!unfinished) return ok("duplicate");
    // jinak propadneme dál a zkusíme událost dokončit
  }

  // ---------------------------------------------------------------
  //  REZERVACE
  //  booking_id bere JEN z metadata — ta umí nastavit pouze stripe-create.
  //  client_reference_id (pevné platební odkazy) se záměrně ignoruje.
  // ---------------------------------------------------------------
  const bookingId: string | null = obj?.metadata?.booking_id ?? null;
  const isVoucher = obj?.metadata?.type === "voucher";

  if (bookingId) {
    const { data: bk, error: bkErr } = await admin
      .from("bookings")
      .select("id, name, email, spots, status, payment_status, payment_amount, payment_ref, lesson:lessons(title, starts_at, duration_min)")
      .eq("id", bookingId)
      .maybeSingle();
    if (bkErr) return await retry("booking_lookup_failed: " + bkErr.message);
    if (!bk) return await reject("booking_not_found", bookingId);

    if (event.type === "checkout.session.completed") {
      // Zaplaceno už je (typicky stihl stripe-confirm po návratu z brány).
      // Nepřepisujeme, ať se paid_at neposouvá při opakovaném doručení.
      if (bk.payment_status === "paid" && bk.payment_ref === obj?.id) {
        await mark("skipped", "already_paid", bookingId);
        return ok("already_paid");
      }

      // --- kontroly, bez kterých se nic neoznačí jako zaplacené ---
      // Zrušená rezervace: místo už může být obsazené někým jiným, takže ji
      // zpátky neoživujeme. Peníze ve Stripu zůstaly a musí se vrátit ručně —
      // proto vlastní důvod, ať se to v adminu pozná od běžného odmítnutí.
      if (bk.status === "cancelled") {
        return await reject("booking_cancelled_refund_needed", bookingId);
      }
      if (obj?.payment_status !== "paid") {
        return await reject("payment_status_not_paid:" + String(obj?.payment_status), bookingId);
      }
      if (String(obj?.currency).toLowerCase() !== "czk") {
        return await reject("currency_mismatch:" + String(obj?.currency), bookingId);
      }
      // payment_ref zapsala stripe-create při zakládání platby. Když nesedí,
      // přišla platba z jiné session, než která k téhle rezervaci patří.
      if (bk.payment_ref && bk.payment_ref !== obj?.id) {
        return await reject("session_mismatch", bookingId);
      }
      // Počet míst v metadatech musí sedět s rezervací — jinak by šlo
      // zaplatit za jedno místo a nechat si potvrdit čtyři.
      const metaSpots = Number(obj?.metadata?.spots);
      if (!Number.isFinite(metaSpots) || metaSpots !== Number(bk.spots)) {
        return await reject("spots_mismatch:" + String(obj?.metadata?.spots) + "/" + String(bk.spots), bookingId);
      }
      // Očekávaná částka: primárně to, co spočítal server při zakládání
      // platby; když sloupec chybí, dopočítá se z ceny za místo.
      const entryCzk = Number(env("PAYMENT_ENTRY_CZK", env("PAYMENT_DEPOSIT_CZK", "499")));
      const expected = Number(bk.payment_amount) > 0
        ? Number(bk.payment_amount)
        : Math.round(entryCzk * 100) * Number(bk.spots);
      if (Number(obj?.amount_total) !== expected) {
        return await reject("amount_mismatch:" + String(obj?.amount_total) + "/" + String(expected), bookingId);
      }

      // --- teprve teď zapisujeme, a hlídáme výsledek ---
      const { error: payErr } = await admin.from("bookings").update({
        payment_status: "paid",
        paid_at: new Date().toISOString(),
        payment_method: "online",
        payment_ref: obj.id,
        payment_amount: obj.amount_total,
        hold_expires_at: null,   // zaplaceno → místo se už neuvolňuje
      }).eq("id", bookingId);
      if (payErr) return await retry("booking_paid_update_failed: " + payErr.message);

      // Potvrzení s QR kódem. Zařazení do fronty MUSÍ projít — když se
      // nepovede, vracíme 5xx a Stripe událost pošle znovu. Radši událost
      // zpracovat dvakrát (zápisy jsou idempotentní) než nechat zaplaceného
      // hosta bez vstupenky, což je přesně to, co se dělo dřív.
      const mailErr = await enqueue(admin, [bookingEmail(bk as any, env("SITE_URL", "https://www.jogaskralicky.cz/"))]);
      if (mailErr) return await retry("email_enqueue_failed: " + mailErr.message);
      sendInBackground(admin);

      await mark("processed", null, bookingId);
      return ok();
    }

    if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
      // Zaplacenou rezervaci nikdy neshazujeme — mohla dorazit dřív jinou cestou.
      if (bk.payment_status === "paid") {
        await mark("skipped", "already_paid", bookingId);
        return ok("already_paid");
      }
      // Musí jít o TU platbu, kterou k rezervaci vedeme. Host, kterému první
      // brána propadla a hned si otevřel druhou, má v payment_ref už tu novou —
      // a propadlá stará by mu jinak pustila místo zpátky do nabídky přímo
      // uprostřed placení. Stripe navíc nezaručuje pořadí doručení, takže se
      // starší událost může objevit až po novější.
      if (bk.payment_ref && obj?.id && bk.payment_ref !== obj.id) {
        await mark("skipped", "stale_session", bookingId);
        return ok("stale_session");
      }
      const { error: failErr } = await admin.from("bookings").update({
        payment_status: "failed",
        hold_expires_at: new Date().toISOString(),   // místo hned zpátky do nabídky
      }).eq("id", bookingId).neq("payment_status", "paid");
      if (failErr) return await retry("booking_failed_update_failed: " + failErr.message);

      await mark("processed", null, bookingId);
      return ok();
    }

    await mark("ignored", "unhandled_type", bookingId);
    return ok("ignored");
  }

  // ---------------------------------------------------------------
  //  DÁRKOVÉ POUKAZY
  //  Kódy jsou DETERMINISTICKÉ ze session id, protože úplně stejný výpočet
  //  dělá i web v rezervace.html (funkce voucherCodes) — jinak by host viděl
  //  jiné kódy, než jaké máš v adminu. Když ten výpočet měníš, změň ho na
  //  obou místech naráz.
  // ---------------------------------------------------------------
  if (isVoucher && event.type === "checkout.session.completed") {
    if (obj?.payment_status !== "paid") {
      return await reject("voucher_payment_status_not_paid:" + String(obj?.payment_status));
    }
    if (String(obj?.currency).toLowerCase() !== "czk") {
      return await reject("voucher_currency_mismatch:" + String(obj?.currency));
    }

    const count = Math.max(1, Number(obj?.metadata?.count) || 1);
    const voucherCzk = Number(env("PAYMENT_VOUCHER_CZK", env("PAYMENT_ENTRY_CZK", "499")));
    const expected = Math.round(voucherCzk * 100) * count;
    if (Number(obj?.amount_total) !== expected) {
      return await reject("voucher_amount_mismatch:" + String(obj?.amount_total) + "/" + String(expected));
    }

    const stem = "DK-" + String(obj.id).replace(/[^A-Za-z0-9]/g, "").slice(-8).toUpperCase();
    const email = obj?.customer_details?.email || obj?.customer_email || null;
    const each = Math.round(Number(obj.amount_total) / count);
    // Obchodní podmínky slibují platnost 12 měsíců — držíme ji i v datech.
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

    const rows = Array.from({ length: count }, (_, i) => ({
      code: count === 1 ? stem : `${stem}-${i + 1}`,
      email,
      amount: each,          // cena za JEDEN poukaz, ne celá objednávka
      session_id: obj.id,
      redeemed: false,
      expires_at: expiresAt,
    }));

    // ZÁMĚRNĚ insert-ignore, NE upsert. Vystavení smí řádek založit, ale
    // nikdy ne přepsat: upsert by při opakovaném doručení události vrátil
    // redeemed na false a posunul expires_at o rok. Uplatnění a expiraci
    // řídí výhradně RPC redeem_voucher (supabase/vouchers-lifecycle.sql).
    const { error: vErr } = await admin
      .from("vouchers")
      .upsert(rows, { onConflict: "code", ignoreDuplicates: true });
    if (vErr) return await retry("voucher_upsert_failed: " + vErr.message);

    // Jeden e-mail na každý poukaz — každý je samostatný dárek, takže se dá
    // rovnou přeposlat obdarovanému. Bez e-mailové adresy nemáme kam poslat;
    // kódy pak host uvidí aspoň na návratové stránce.
    if (email) {
      const mailErr = await enqueue(admin, rows.map((r) => voucherEmail(r.code, email, r.amount)));
      if (mailErr) return await retry("voucher_email_enqueue_failed: " + mailErr.message);
      sendInBackground(admin);
    }

    await mark("processed", null, null);
    return ok();
  }

  await mark("ignored", "no_booking_or_voucher", null);
  return ok("ignored");
});
