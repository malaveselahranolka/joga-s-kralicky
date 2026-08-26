// =====================================================================
//  stripe-confirm — po návratu z platby se zeptá Stripu, jestli je
//  zaplaceno, a zapíše to do databáze.
//
//  Zvládá OBOJÍ:
//    * rezervaci  (metadata.booking_id od stripe-create)
//    * poukazy    (metadata.type === "voucher" od stripe-voucher)
//
//  Proč to existuje: kdyby se stav zapisoval JEN webhookem a ten nechodí
//  (špatný STRIPE_WEBHOOK_SECRET, jiný režim test/live, výpadek), zůstala by
//  rezervace navždy „nezaplaceno" a poukaz by v databázi vůbec nevznikl —
//  zákazník by u dveří slyšel „neznámý poukaz". Přesně to se 21. 8. 2026
//  stalo: obě platby ve Stripu proběhly, webhook nedorazil, rezervaci
//  zachránila tahle funkce a poukaz neměl co ho zachrání.
//
//  Vstup:  { session_id: "cs_live_..." }
//  Výstup: { ok, paid, kind, codes? }
//
//  Bezpečné: stav si bereme přímo ze Stripu, prohlížeči nevěříme nic.
//  Nasazuj s VYPNUTÝM „Verify JWT": bez platného ID platební session
//  (dlouhé náhodné, nedohledatelné) funkce nic neudělá.
//
//  DŮLEŽITÉ: dělá TY SAMÉ kontroly jako stripe-webhook (částka, měna,
//  počet míst, shoda session). Kdyby je dělal jen webhook, stačilo by
//  útočníkovi jít touhle cestou. Měníš-li kontroly tady, změň je i tam.
//
//  Secrets:  STRIPE_SECRET_KEY, PAYMENT_ENTRY_CZK, PAYMENT_VOUCHER_CZK
// =====================================================================
import Stripe from "https://esm.sh/stripe@14.21.0?target=denonext";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { bookingEmail, voucherEmail, enqueue, dispatch, emailReady } from "../_shared/email.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const env = (n: string, d = "") => Deno.env.get(n) ?? d;

// Zákazník čeká na odpověď a odesílání je pomalé (EmailJS: 1 požadavek za
// vteřinu). Pustíme ho na pozadí; co se nestihne, vezme si dispatcher.
// `limit` je počet e-mailů, které se zkusí odeslat hned. U poukazů je to
// jeden na každý kód, takže při nákupu pěti poukazů musí ven pět — s pevnou
// trojkou by dva zůstaly ve frontě a dorazily až s dalším během cronu,
// tedy klidně o pět minut později.
function sendInBackground(admin: unknown, limit = 3) {
  const job = dispatch(admin, Math.max(1, Math.min(limit, 25))).catch((e) =>
    console.error("stripe-confirm: rozeslani na pozadi selhalo", String(e)));
  // @ts-ignore EdgeRuntime existuje jen v Supabase runtime
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(job);
}

// Kódy poukazů jsou DETERMINISTICKÉ ze session id. Úplně stejný výpočet dělá
// stripe-webhook i web v rezervace.html (funkce voucherCodes) — jinak by host
// viděl jiné kódy, než jaké jsou v adminu. Měníš-li to, změň to na všech třech
// místech naráz.
function voucherCodes(sessionId: string, count: number): string[] {
  const stem = "DK-" + String(sessionId).replace(/[^A-Za-z0-9]/g, "").slice(-8).toUpperCase();
  return count === 1 ? [stem] : Array.from({ length: count }, (_, i) => `${stem}-${i + 1}`);
}

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
    const meta = (s as any)?.metadata ?? {};

    // Nezaplaceno → nic nezapisujeme, ať jde o rezervaci nebo poukaz.
    if (s.payment_status !== "paid") return json({ ok: true, paid: false });
    if (String(s.currency).toLowerCase() !== "czk") {
      return json({ ok: false, error: "currency_mismatch" }, 409);
    }

    const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

    // ---------------------------------------------------------------
    //  DÁRKOVÉ POUKAZY
    // ---------------------------------------------------------------
    if (meta.type === "voucher") {
      const count = Math.max(1, Number(meta.count) || 1);
      const voucherCzk = Number(env("PAYMENT_VOUCHER_CZK", env("PAYMENT_ENTRY_CZK", "499")));
      const expected = Math.round(voucherCzk * 100) * count;
      if (Number(s.amount_total) !== expected) {
        return json({ ok: false, error: "amount_mismatch" }, 409);
      }

      const codes = voucherCodes(String(s.id), count);
      const email = (s as any)?.customer_details?.email || s.customer_email || null;
      const each = Math.round(Number(s.amount_total) / count);
      // Obchodní podmínky slibují platnost 12 měsíců — držíme ji i v datech.
      const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

      const rows = codes.map((code) => ({
        code,
        email,
        amount: each,          // cena za JEDEN poukaz, ne celá objednávka
        session_id: String(s.id),
        redeemed: false,
        expires_at: expiresAt,
      }));

      // ZÁMĚRNĚ insert-ignore, NE upsert.
      //
      // Tahle funkce běží pokaždé, když se otevře návratová adresa po platbě
      // — a tu si zákazník může uložit do záložek. S upsertem se při každém
      // dalším otevření přepsalo redeemed zpátky na false a expires_at se
      // posunulo o rok dál. Uplatněný poukaz tak šel oživit a používat
      // donekonečna. Vystavení musí zapsat řádek JEDNOU a pak už na něj
      // nikdy nesahat; uplatnění a expiraci řídí RPC redeem_voucher.
      const { error: vErr } = await admin
        .from("vouchers")
        .upsert(rows, { onConflict: "code", ignoreDuplicates: true });
      if (vErr) return json({ ok: false, error: "voucher_upsert_failed", detail: vErr.message }, 500);

      // Kódy do e-mailu. Dřív je rozesílal prohlížeč na téhle stránce —
      // kdo ji zavřel dřív, než smyčka doběhla, zůstal bez nich a chyba
      // se spolkla. Teď je odesílá server a co selže, zůstane ve frontě.
      if (email) {
        const mailErr = await enqueue(admin, rows.map((r) => voucherEmail(r.code, email, r.amount)));
        if (mailErr) return json({ ok: false, error: "voucher_email_enqueue_failed", detail: mailErr.message }, 500);
        sendInBackground(admin, rows.length);
      }

      // serverEmail říká prohlížeči, jestli má mlčet (posíláme my)
      // nebo poslat sám (chybí EMAILJS_PRIVATE_KEY, tak ať host neostrouhá)
      return json({ ok: true, paid: true, kind: "voucher", codes, serverEmail: emailReady() });
    }

    // ---------------------------------------------------------------
    //  REZERVACE
    //  Rezervaci pozná JEN metadata.booking_id od stripe-create.
    //  client_reference_id se záměrně neuznává — ten si k pevnému
    //  platebnímu odkazu připíše kdokoli.
    // ---------------------------------------------------------------
    const bookingId = meta.booking_id ?? null;
    if (!bookingId) return json({ ok: true, paid: false, error: "no_booking_ref" });

    const { data: bk, error: bkErr } = await admin
      .from("bookings")
      .select("id, name, email, spots, status, payment_status, payment_amount, payment_ref, lesson:lessons(title, starts_at, duration_min)")
      .eq("id", bookingId)
      .maybeSingle();
    if (bkErr) return json({ ok: false, error: "booking_lookup_failed", detail: bkErr.message }, 500);
    if (!bk) return json({ ok: true, paid: false, error: "booking_not_found" });

    // Už zaplaceno dřív (nejspíš webhookem) → nic nepřepisujeme.
    if (bk.payment_status === "paid") return json({ ok: true, paid: true, kind: "booking", serverEmail: emailReady() });

    // Zrušenou rezervaci nikdy neoznačíme jako zaplacenou — místo už může mít
    // někdo jiný. Peníze ve Stripu zůstanou a musí se vrátit ručně; hlásíme to
    // zvlášť, ať to nezapadne mezi běžné odmítnutí.
    if (bk.status === "cancelled") {
      console.error("stripe-confirm: platba k ZRUSENE rezervaci, nutny refund", bookingId, s.id);
      return json({ ok: false, error: "booking_cancelled", refund_needed: true }, 409);
    }

    if (bk.payment_ref && bk.payment_ref !== s.id) {
      return json({ ok: false, error: "session_mismatch" }, 409);
    }
    const metaSpots = Number(meta.spots);
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

    // Potvrzení s QR kódem. Když se zařazení nepovede, vrátíme chybu —
    // ať se to pozná hned, ne až u dveří.
    const mailErr = await enqueue(admin, [
      bookingEmail({ ...(bk as any), payment_amount: s.amount_total }, env("SITE_URL", "https://www.jogaskralicky.cz/")),
    ]);
    if (mailErr) return json({ ok: false, error: "email_enqueue_failed", detail: mailErr.message }, 500);
    sendInBackground(admin);

    return json({ ok: true, paid: true, kind: "booking", serverEmail: emailReady() });
  } catch (e) {
    return json({ ok: false, error: "server_error", detail: String(e) }, 500);
  }
});
