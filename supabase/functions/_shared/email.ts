// =====================================================================
//  Odesílání e-mailů ze serveru — sdílené pro stripe-webhook a email-dispatch
//
//  POŘÁD JE TO EMAILJS a pořád tytéž šablony jako dřív. Změnilo se JEN to,
//  odkud se odeslání spouští.
//
//  Dřív ho spouštěl prohlížeč na návratové stránce po platbě. To znamená,
//  že e-mail vznikl jedině tehdy, když se zákazník po platbě opravdu vrátil
//  na náš web, ve stejném prohlížeči, a stránka doběhla. Zavřel záložku?
//  Zaplatil na mobilu a potvrzení otevřel na notebooku? EmailJS na vteřinu
//  zaškobrtl? E-mail nebyl a nikdo se to nedozvěděl — chyba se polykala
//  prázdným catch blokem.
//
//  Teď se e-mail nejdřív ZAPÍŠE do fronty (public.email_outbox) a teprve
//  pak se zkusí odeslat. Když odeslání selže, řádek zůstane a zkusí se
//  znovu. Prohlížeč zůstává jako druhá cesta, ale nic už na něm nestojí.
//
//  ---------------------------------------------------------------------
//  SECRETS
//    EMAILJS_PRIVATE_KEY   ← JEDINÉ, co je opravdu tajné a musí se doplnit
//                            (EmailJS → Account → Security → Private Key,
//                             tamtéž zapnout API požadavky mimo prohlížeč)
//
//  Zbytek má výchozí hodnoty shodné se supabase-config.js, protože to jsou
//  veřejné identifikátory — jsou stejně vidět v HTML. Přepsat je ale jde:
//    EMAILJS_PUBLIC_KEY, EMAILJS_SERVICE_ID,
//    EMAILJS_TEMPLATE_ID, EMAILJS_VOUCHER_TEMPLATE_ID
//
//  BEZ PRIVÁTNÍHO KLÍČE SE NIC NEROZBIJE: fronta se plní dál, jen se z ní
//  neodesílá, a v adminu je vidět proč. Prohlížeč posílá jako dosud.
// =====================================================================

const env = (n: string, d = "") => Deno.env.get(n) ?? d;

const EMAILJS_API = "https://api.emailjs.com/api/v1.0/email/send";

export const emailConfig = () => ({
  privateKey: env("EMAILJS_PRIVATE_KEY"),
  publicKey: env("EMAILJS_PUBLIC_KEY", "vLh3HLiqUbRBLKmNN"),
  serviceId: env("EMAILJS_SERVICE_ID", "service_9n1wtnv"),
  bookingTemplate: env("EMAILJS_TEMPLATE_ID", "template_iblqvg1"),
  voucherTemplate: env("EMAILJS_VOUCHER_TEMPLATE_ID", "template_0biilyq"),
});

export const emailReady = () => !!emailConfig().privateKey;

// ---------------------------------------------------------------------
//  ČESKÉ FORMÁTOVÁNÍ
//  Musí vyjít ZNAKÝ NA ZNAK stejně jako v prohlížeči (rezervace.html),
//  jinak by hostovi přišel jinak vypadající e-mail podle toho, kdo ho
//  poslal. Časové pásmo je tu zásadní: server běží v UTC, ale lekce
//  začíná v pražském čase — bez timeZone by e-mail hlásil o dvě hodiny
//  míň a host by dorazil pozdě.
// ---------------------------------------------------------------------
const TZ = "Europe/Prague";

const parts = (iso: string) => {
  const fmt = new Intl.DateTimeFormat("cs-CZ", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(iso))) out[p.type] = p.value;
  return out;
};

const fmtDate = (iso: string) => {
  const p = parts(iso);
  return `${p.day}. ${p.month}. ${p.year}`;
};

const fmtTime = (iso: string) => {
  const p = parts(iso);
  return `${p.hour}:${p.minute}`;
};

const fmtDow = (iso: string) => {
  const d = new Intl.DateTimeFormat("cs-CZ", {timeZone: TZ, weekday: "long"})
    .format(new Date(iso));
  return d.charAt(0).toUpperCase() + d.slice(1);
};

const spotsTxt = (n: number) => n + (n === 1 ? " místo" : (n < 5 ? " místa" : " míst"));

const czk = (n: number) => Number(n).toLocaleString("cs-CZ") + " Kč";

const qrFor = (data: string) =>
  "https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=8&data=" +
  encodeURIComponent(data);

// ---------------------------------------------------------------------
//  PODKLADY PRO ŠABLONY
//  Názvy polí musí sedět s tím, co šablony v EmailJS očekávají — jsou to
//  tytéž, které dosud posílal prohlížeč z rezervace.html.
// ---------------------------------------------------------------------
const PLACE = "Fit&Fun Studio Ostrava, Tovární 486/7, 709 00 Ostrava-Mariánské Hory";

export type Booking = {
  id: string;
  name: string;
  email: string;
  spots: number;
  payment_amount: number | null;
  lesson?: {title?: string; starts_at?: string; duration_min?: number} | null;
};

export function bookingEmail(bk: Booking, siteUrl: string) {
  const title = bk.lesson?.title ?? "Lekce jógy";
  const startsAt = bk.lesson?.starts_at;
  const spots = Math.max(1, Number(bk.spots) || 1);
  const base = siteUrl.replace(/\/$/, "");
  const ticketUrl = `${base}/vstupenka.html#${bk.id}`;

  let datetime = title;
  if (startsAt) {
    const end = new Date(new Date(startsAt).getTime() +
      (Number(bk.lesson?.duration_min) || 60) * 60000).toISOString();
    datetime = `${fmtDow(startsAt)} ${fmtDate(startsAt)} · ${fmtTime(startsAt)}–${fmtTime(end)}`;
  }

  return {
    order_key: `booking:${bk.id}`,
    kind: "booking",
    to_email: bk.email,
    template_id: emailConfig().bookingTemplate,
    params: {
      email: bk.email,
      to_email: bk.email,
      name: bk.name,
      lesson: title,
      datetime,
      spots: spotsTxt(spots),
      // haléře → koruny; když sloupec chybí, radši nic než špatné číslo
      price: bk.payment_amount ? czk(Math.round(Number(bk.payment_amount) / 100)) : "",
      location: PLACE,
      ticket_url: ticketUrl,
      // QR musí být hostovaný obrázek — e-mail nespustí JavaScript.
      // Kóduje odkaz na stav rezervace, přesně to, co čte čtečka v adminu.
      qr_url: qrFor(ticketUrl),
    },
  };
}

export function voucherEmail(code: string, email: string, amountHaleru: number) {
  return {
    order_key: `voucher:${code}`,
    kind: "voucher",
    to_email: email,
    template_id: emailConfig().voucherTemplate,
    params: {
      email,
      to_email: email,
      code,
      amount: czk(Math.round(Number(amountHaleru) / 100)),
      qr_url: qrFor(code),
    },
  };
}

// ---------------------------------------------------------------------
//  ZAŘAZENÍ DO FRONTY
//  insert-ignore přes unikátní order_key: opakované doručení téže události
//  ani souběh webhooku s návratovou stránkou nezaloží e-mail dvakrát.
// ---------------------------------------------------------------------
export async function enqueue(admin: any, rows: any[]) {
  if (!rows.length) return null;
  const {error} = await admin
    .from("email_outbox")
    .upsert(rows, {onConflict: "order_key", ignoreDuplicates: true});
  return error;
}

// ---------------------------------------------------------------------
//  SAMOTNÉ ODESLÁNÍ
//  EmailJS má limit 1 požadavek za sekundu. Držíme 1100 ms — prohlížeč
//  měl 700 ms, což limit překračovalo, takže kdo koupil víc poukazů,
//  o část kódů přišel a chyba se spolkla.
// ---------------------------------------------------------------------
const RATE_MS = 1100;

async function sendOne(templateId: string, params: unknown): Promise<string | null> {
  const c = emailConfig();
  if (!c.privateKey) return "emailjs_private_key_not_set";

  const res = await fetch(EMAILJS_API, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      service_id: c.serviceId,
      template_id: templateId,
      user_id: c.publicKey,
      accessToken: c.privateKey,   // bez něj EmailJS požadavek mimo prohlížeč odmítne
      template_params: params,
    }),
  });

  if (res.ok) return null;
  const detail = await res.text().catch(() => "");
  return `emailjs_${res.status}: ${detail.slice(0, 200)}`;
}

// ---------------------------------------------------------------------
//  ZPRACOVÁNÍ FRONTY
//  claim_email_batch si dávku zamkne (`for update skip locked`) a rovnou
//  započítá pokus, takže dva souběžné běhy si e-maily nerozešlou dvakrát
//  a spadlý běh se sám odloží místo aby se zacyklil.
// ---------------------------------------------------------------------
export async function dispatch(admin: any, limit = 10) {
  const out = {claimed: 0, sent: 0, failed: 0, skipped: false as boolean | string};

  if (!emailReady()) {
    // Fronta se plní dál, jen se z ní neodesílá. V adminu je vidět proč.
    out.skipped = "emailjs_private_key_not_set";
    return out;
  }

  const {data: batch, error} = await admin.rpc("claim_email_batch", {p_limit: limit});
  if (error) {
    console.error("email dispatch: fronta se nedala načíst", error.message);
    out.skipped = "claim_failed";
    return out;
  }

  const rows = batch ?? [];
  out.claimed = rows.length;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let err: string | null;
    try {
      err = await sendOne(row.template_id, row.params);
    } catch (e) {
      err = "network: " + String(e).slice(0, 200);
    }

    if (err) {
      out.failed++;
      console.error("email dispatch: neodesláno", row.order_key, err);
      await admin.rpc("mark_email_error", {p_id: row.id, p_error: err});
    } else {
      out.sent++;
      await admin.rpc("mark_email_sent", {p_id: row.id});
    }

    if (i < rows.length - 1) await new Promise((r) => setTimeout(r, RATE_MS));
  }

  return out;
}
