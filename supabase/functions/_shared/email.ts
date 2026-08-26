// =====================================================================
//  Odesílání e-mailů ze serveru — sdílené pro stripe-webhook a email-dispatch
//
//  Odesílá se přes Resend, nebo — dokud není jeho klíč nastavený — přes
//  původní EmailJS. Vybírá se to podle přítomnosti klíče, viz níž.
//
//  Dřív odeslání spouštěl prohlížeč na návratové stránce po platbě. To znamená,
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
//
//  Současná cesta — Brevo (podoba e-mailů je v ./templates.ts):
//    BREVO_API_KEY      xkeysib-… z app.brevo.com → SMTP & API → API Keys
//    EMAIL_FROM         výchozí „Jóga s králíčky <info@jogaskralicky.cz>"
//    EMAIL_REPLY_TO     výchozí info@jogaskralicky.cz
//
//  Připravená náhrada — Resend (stejné šablony, jiné API):
//    RESEND_API_KEY     re_… — POUŽITELNÉ AŽ PO PŘESUNU DNS, viz níž
//
//  Původní cesta — EmailJS (šablony žijí u nich ve webovém editoru):
//    EMAILJS_PRIVATE_KEY   Account → Security → Private Key, tamtéž
//                          zapnout API požadavky mimo prohlížeč
//    EMAILJS_PUBLIC_KEY, EMAILJS_SERVICE_ID,
//    EMAILJS_TEMPLATE_ID, EMAILJS_VOUCHER_TEMPLATE_ID
//      — veřejné identifikátory, výchozí hodnoty sedí se supabase-config.js
//
//  Pořadí preference: Brevo → Resend → EmailJS, podle toho, který klíč
//  existuje. Není-li žádný, NIC SE NEROZBIJE: fronta se plní dál, jen se
//  z ní neodesílá, a v adminu je vidět proč.
// =====================================================================

import { renderMail } from "./templates.ts";

const env = (n: string, d = "") => Deno.env.get(n) ?? d;

const EMAILJS_API = "https://api.emailjs.com/api/v1.0/email/send";
const RESEND_API = "https://api.resend.com/emails";
const BREVO_API = "https://api.brevo.com/v3/smtp/email";

export const emailConfig = () => ({
  privateKey: env("EMAILJS_PRIVATE_KEY"),
  publicKey: env("EMAILJS_PUBLIC_KEY", "vLh3HLiqUbRBLKmNN"),
  serviceId: env("EMAILJS_SERVICE_ID", "service_9n1wtnv"),
  bookingTemplate: env("EMAILJS_TEMPLATE_ID", "template_iblqvg1"),
  voucherTemplate: env("EMAILJS_VOUCHER_TEMPLATE_ID", "template_0biilyq"),
});

// ---------------------------------------------------------------------
//  KDO E-MAIL ODEŠLE
//
//  Tři možnosti, ne z rozmaru — je to přechodová cesta a zároveň pojistka.
//
//  EMAILJS byl postavený na kontaktní formuláře v prohlížeči a na tenhle
//  provoz už nestačí: free plán má 200 požadavků MĚSÍČNĚ na všechno
//  dohromady (rezervace, každý poukaz zvlášť, každý odběratel newsletteru),
//  a omezení odesílání na vlastní doménu je u něj placená funkce. Dokud
//  tedy posílal prohlížeč, musel být jeho veřejný klíč v HTML a poslat si
//  přes něj e-mail mohl kdokoli z libovolné domény.
//
//  BREVO je současná cesta. Ověření domény mu stačí přes TXT záznamy
//  (Brevo code + DKIM + DMARC) — a to je jediné, co jde přidat v DNS
//  panelu u emailprofi, kde doména bydlí.
//
//  RESEND je hotový a odzkoušený, ale nepoužitelný: kromě TXT vyžaduje
//  i MX záznam na subdoméně `send`, a ten si v tom panelu přidat nejde
//  (typ MX tam v nabídce není a stávající MX jsou zamčené). Doména u něj
//  proto zůstala ve stavu `pending`. Nechávám ho tu pro případ, že se DNS
//  jednou přestěhuje jinam — pak stačí prohodit secret.
//
//  Přepínač je schválně podle přítomnosti klíče, ne podle nějakého
//  EMAIL_PROVIDER=… . Pořadí níž je zároveň pořadím preference.
// ---------------------------------------------------------------------

// Odesílatel je společný všem dodavatelům. Drží se v jednom tvaru
// „Jméno <adresa>"; Brevo ho potřebuje rozložený, tak se níž rozebere.
export const senderConfig = () => ({
  // MUSÍ být adresa na ověřené doméně, jinak dodavatel odeslání odmítne.
  from: env("EMAIL_FROM", "Jóga s králíčky <info@jogaskralicky.cz>"),
  // Odpovědi hosta ať chodí do skutečné schránky u Seznamu, ne do prázdna.
  replyTo: env("EMAIL_REPLY_TO", "info@jogaskralicky.cz"),
});

// „Jóga s králíčky <info@jogaskralicky.cz>" → {name, email}
// Bez jména vrátí prázdný name a celý řetězec jako adresu.
export function parseFrom(s: string): {name: string; email: string} {
  const m = /^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/.exec(s);
  if (m) return {name: m[1].replace(/^"|"$/g, ""), email: m[2]};
  return {name: "", email: s.trim()};
}

export const brevoConfig = () => ({ apiKey: env("BREVO_API_KEY") });
export const resendConfig = () => ({ apiKey: env("RESEND_API_KEY") });

export const emailProvider = (): "brevo" | "resend" | "emailjs" | null => {
  if (brevoConfig().apiKey) return "brevo";
  if (resendConfig().apiKey) return "resend";
  if (emailConfig().privateKey) return "emailjs";
  return null;
};

export const emailReady = () => emailProvider() !== null;

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

// Jeden poukaz = jeden e-mail. order_key nese kód, takže je pro každý
// poukaz jiný a při nákupu více kusů se založí tolik zpráv, kolik je kódů.
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
//  Pauza mezi e-maily se řídí limitem dodavatele. EmailJS pouští jeden
//  požadavek za sekundu (držíme 1100 ms — prohlížeč měl 700 ms, což limit
//  překračoval, takže kdo koupil víc poukazů, o část kódů přišel a chyba
//  se spolkla). Resend pouští dva za sekundu, takže stačí polovina.
// ---------------------------------------------------------------------
const rateMs = () => {
  switch (emailProvider()) {
    case "brevo":  return 350;
    case "resend": return 600;
    default:       return 1100;
  }
};

type OutboxRow = {
  kind: string;
  to_email: string;
  template_id: string;
  params: Record<string, string>;
};

async function sendViaBrevo(row: OutboxRow): Promise<string | null> {
  const mail = renderMail(row.kind, row.params || {});
  // Neznámý druh e-mailu neumíme vykreslit. Vracíme chybu místo prázdné
  // zprávy — řádek zůstane ve frontě a v adminu je vidět proč.
  if (!mail) return `brevo_unknown_kind: ${row.kind}`;

  const s = senderConfig();
  const from = parseFrom(s.from);

  const res = await fetch(BREVO_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      // Brevo nepoužívá Bearer, ale vlastní hlavičku.
      "api-key": brevoConfig().apiKey,
    },
    body: JSON.stringify({
      sender: from.name ? {name: from.name, email: from.email} : {email: from.email},
      to: [{email: row.to_email}],
      replyTo: {email: s.replyTo},
      subject: mail.subject,
      htmlContent: mail.html,
      textContent: mail.text,
    }),
  });

  // Úspěch je 201 Created, ne 200 — proto res.ok, ne rovnost na 200.
  if (res.ok) return null;
  const detail = await res.text().catch(() => "");
  return `brevo_${res.status}: ${detail.slice(0, 200)}`;
}

async function sendViaResend(row: OutboxRow): Promise<string | null> {
  const mail = renderMail(row.kind, row.params || {});
  if (!mail) return `resend_unknown_kind: ${row.kind}`;

  const s = senderConfig();
  const res = await fetch(RESEND_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resendConfig().apiKey}`,
    },
    body: JSON.stringify({
      from: s.from,
      to: [row.to_email],
      reply_to: s.replyTo,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    }),
  });

  if (res.ok) return null;
  const detail = await res.text().catch(() => "");
  return `resend_${res.status}: ${detail.slice(0, 200)}`;
}

async function sendViaEmailJs(row: OutboxRow): Promise<string | null> {
  const c = emailConfig();
  const res = await fetch(EMAILJS_API, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      service_id: c.serviceId,
      template_id: row.template_id,
      user_id: c.publicKey,
      accessToken: c.privateKey,   // bez něj EmailJS požadavek mimo prohlížeč odmítne
      template_params: row.params,
    }),
  });

  if (res.ok) return null;
  const detail = await res.text().catch(() => "");
  return `emailjs_${res.status}: ${detail.slice(0, 200)}`;
}

async function sendOne(row: OutboxRow): Promise<string | null> {
  switch (emailProvider()) {
    case "brevo":   return await sendViaBrevo(row);
    case "resend":  return await sendViaResend(row);
    case "emailjs": return await sendViaEmailJs(row);
    default:        return "email_provider_not_configured";
  }
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
    out.skipped = "email_provider_not_configured";
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
      err = await sendOne(row);
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

    if (i < rows.length - 1) await new Promise((r) => setTimeout(r, rateMs()));
  }

  return out;
}
