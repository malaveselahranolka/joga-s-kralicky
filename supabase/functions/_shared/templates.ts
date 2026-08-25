// =====================================================================
//  HTML podoba odchozích e-maylů
//
//  Dokud se posílalo přes EmailJS, žila tahle část mimo repozitář — v jejich
//  webovém editoru šablon. To mělo tři nepříjemné důsledky: nešlo to
//  verzovat, nešlo to zkontrolovat před nasazením a hlavně to znamenalo,
//  že jsme na tom dodavateli viseli i obsahem, ne jen doručením.
//
//  Tady jsou ty samé dva e-maily napsané v kódu. Vstupem jsou přesně ta
//  pole, která už teď leží v email_outbox.params, takže se nic nemigruje —
//  fronta zůstává, jak je, a starým řádkům se nic nestane.
//
//  PRAVIDLA PRO HTML V E-MAILECH (proto to vypadá jako web z roku 2005):
//    * layout na <table>, ne flex/grid — Outlook nic jiného spolehlivě neumí
//    * styly inline, ne v <style> — Gmail <style> v některých případech zahodí
//    * žádný JavaScript, žádné externí CSS, obrázky jen jako <img src="https://…">
//    * všechno musí dávat smysl i bez obrázků (Seznam i Gmail je defaultně
//      blokují, dokud odesílatele neznají) — proto je kód poukazu i jako text
// =====================================================================

const FOREST = "#2C3B2E";
const CREAM = "#F7F4EC";
const PAPER = "#F1EEE5";
const INK = "#1E231C";
const INK_SOFT = "#5C6357";
const LINE = "#E3DFD3";

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

// Obálka, kterou sdílí oba e-maily. `preheader` je text, co se v seznamu
// zpráv ukáže hned za předmětem — když ho nenastavíme, klient tam nacpe
// první větu HTML, což bývá „Zobrazit v prohlížeči" nebo prázdno.
function shell(preheader: string, body: string): string {
  return `<!doctype html>
<html lang="cs"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>Jóga s králíčky</title>
</head>
<body style="margin:0;padding:0;background:${PAPER};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAPER};">
<tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#FFFFFF;border:1px solid ${LINE};border-radius:16px;overflow:hidden;">
    <tr><td style="background:${FOREST};padding:22px 28px;">
      <span style="font-family:Georgia,'Times New Roman',serif;font-size:19px;font-weight:600;color:${CREAM};letter-spacing:-0.01em;">Jóga s králíčky</span>
    </td></tr>
    <tr><td style="padding:30px 28px 34px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:${INK};">
${body}
    </td></tr>
  </table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
    <tr><td style="padding:18px 28px 0;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.7;color:${INK_SOFT};">
      Fit&amp;Fun Studio, Tovární 486/7, 709 00 Ostrava-Mariánské Hory<br>
      <a href="mailto:info@jogaskralicky.cz" style="color:${INK_SOFT};">info@jogaskralicky.cz</a> &middot; +420 603 340 860
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;
}

// Řádek tabulky s údajem. Popisek vlevo úzce, hodnota vpravo tučně.
const row = (label: string, value: string) => value
  ? `<tr>
      <td style="padding:7px 14px 7px 0;font-size:13px;color:${INK_SOFT};white-space:nowrap;vertical-align:top;">${esc(label)}</td>
      <td style="padding:7px 0;font-size:15px;font-weight:600;color:${INK};vertical-align:top;">${esc(value)}</td>
    </tr>`
  : "";

const qrBlock = (url: string, caption: string) => `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:26px 0 6px;">
    <tr><td align="center" style="background:${CREAM};border:1px solid ${LINE};border-radius:14px;padding:22px;">
      <img src="${esc(url)}" width="200" height="200" alt="QR kód" style="display:block;width:200px;height:200px;border:0;background:#FFFFFF;border-radius:8px;">
      <div style="margin-top:12px;font-size:13px;color:${INK_SOFT};line-height:1.5;">${caption}</div>
    </td></tr>
  </table>`;

export type MailOut = { subject: string; html: string; text: string };

// ---------------------------------------------------------------------
//  POTVRZENÍ REZERVACE
//  params: name, lesson, datetime, spots, price, location, ticket_url, qr_url
// ---------------------------------------------------------------------
export function bookingMail(p: Record<string, string>): MailOut {
  const firstName = String(p.name || "").trim().split(/\s+/)[0] || "";
  const greeting = firstName ? `Dobrý den, ${esc(firstName)},` : "Dobrý den,";

  const html = shell(
    `${p.lesson || "Lekce"} · ${p.datetime || ""} — místo je vaše.`,
    `<p style="margin:0 0 14px;">${greeting}</p>
     <p style="margin:0 0 22px;">platba dorazila a místo je vaše. Tady je všechno na jednom místě:</p>
     <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid ${LINE};border-bottom:1px solid ${LINE};padding:4px 0;">
       ${row("Lekce", p.lesson)}
       ${row("Kdy", p.datetime)}
       ${row("Míst", p.spots)}
       ${row("Zaplaceno", p.price)}
       ${row("Kde", p.location)}
     </table>
     ${p.qr_url ? qrBlock(p.qr_url, "Ve studiu stačí ukázat tenhle kód.<br>Nemusíte nic tisknout.") : ""}
     ${p.ticket_url ? `<p style="margin:22px 0 0;text-align:center;">
       <a href="${esc(p.ticket_url)}" style="display:inline-block;background:${FOREST};color:${CREAM};text-decoration:none;font-weight:600;font-size:15px;padding:13px 26px;border-radius:999px;">Stav rezervace</a>
     </p>
     <p style="margin:14px 0 0;text-align:center;font-size:12px;color:${INK_SOFT};word-break:break-all;">${esc(p.ticket_url)}</p>` : ""}
     <p style="margin:26px 0 0;font-size:13px;color:${INK_SOFT};">Přijďte prosím o pár minut dřív, ať stihnete pozdravit králíky. Kdyby cokoliv, odepište na tenhle e-mail.</p>`,
  );

  // Textová verze není formalita: filtry berou e-mail bez ní jako podezřelý
  // a odečítače obrazovky si s tabulkovým HTML neporadí.
  //
  // Prázdné řetězce v poli jsou ZÁMĚRNÉ odstavcové mezery, takže se nesmí
  // odfiltrovat spolu s nevyplněnými poli — proto `null` pro „tenhle údaj
  // nemáme" a filtr jen na něj.
  const text = [
    firstName ? `Dobrý den, ${firstName},` : "Dobrý den,",
    "",
    "platba dorazila a místo je vaše.",
    "",
    p.lesson ? `Lekce: ${p.lesson}` : null,
    p.datetime ? `Kdy: ${p.datetime}` : null,
    p.spots ? `Míst: ${p.spots}` : null,
    p.price ? `Zaplaceno: ${p.price}` : null,
    p.location ? `Kde: ${p.location}` : null,
    "",
    p.ticket_url ? `Stav rezervace a QR kód: ${p.ticket_url}` : null,
    p.ticket_url ? "" : null,
    "Přijďte prosím o pár minut dřív. Kdyby cokoliv, odepište na tenhle e-mail.",
    "",
    "Jóga s králíčky, Fit&Fun Studio, Tovární 486/7, Ostrava-Mariánské Hory",
    "info@jogaskralicky.cz, +420 603 340 860",
  ].filter((l) => l !== null).join("\n");

  return {
    subject: p.datetime ? `Rezervace potvrzena — ${p.datetime}` : "Rezervace potvrzena",
    html,
    text,
  };
}

// ---------------------------------------------------------------------
//  DÁRKOVÝ POUKAZ
//  params: code, amount, qr_url
// ---------------------------------------------------------------------
export function voucherMail(p: Record<string, string>): MailOut {
  const html = shell(
    `Kód poukazu ${p.code || ""} — platí rok na kteroukoliv lekci.`,
    `<p style="margin:0 0 14px;">Dobrý den,</p>
     <p style="margin:0 0 22px;">děkujeme za nákup. Tohle je dárkový poukaz na jednu lekci jógy s králíčky — obdarovaný ho uplatní přímo ve studiu, stačí ukázat kód.</p>
     <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
       <tr><td align="center" style="background:${FOREST};border-radius:14px;padding:26px 18px;">
         <div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:rgba(247,244,236,0.7);">Kód poukazu</div>
         <div style="margin-top:10px;font-family:'Courier New',Courier,monospace;font-size:29px;font-weight:700;letter-spacing:0.06em;color:${CREAM};">${esc(p.code)}</div>
         ${p.amount ? `<div style="margin-top:10px;font-size:14px;color:rgba(247,244,236,0.85);">Hodnota ${esc(p.amount)}</div>` : ""}
       </td></tr>
     </table>
     ${p.qr_url ? qrBlock(p.qr_url, "Ve studiu můžete ukázat i tenhle QR kód.") : ""}
     <p style="margin:24px 0 0;">Poukaz platí <strong>12 měsíců</strong> od zakoupení a může ho uplatnit kdokoliv — klidně ho rovnou přepošlete dál. Termín si obdarovaný vybere na
       <a href="https://www.jogaskralicky.cz/rezervace.html" style="color:${FOREST};font-weight:600;">jogaskralicky.cz/rezervace</a>.</p>
     <p style="margin:20px 0 0;font-size:13px;color:${INK_SOFT};">Uložte si prosím tenhle e-mail. Kdyby se kód ztratil, napište nám a najdeme ho.</p>`,
  );

  // Prázdné řetězce jsou záměrné mezery mezi odstavci, `null` znamená
  // „tenhle údaj nemáme" — filtruje se jen to druhé.
  const text = [
    "Dobrý den,",
    "",
    "děkujeme za nákup. Tohle je dárkový poukaz na jednu lekci jógy s králíčky.",
    "",
    `KÓD POUKAZU: ${p.code || ""}`,
    p.amount ? `Hodnota: ${p.amount}` : null,
    "",
    "Poukaz platí 12 měsíců od zakoupení a může ho uplatnit kdokoliv.",
    "Termín si obdarovaný vybere na https://www.jogaskralicky.cz/rezervace.html",
    "",
    "Uložte si prosím tenhle e-mail. Kdyby se kód ztratil, napište nám a najdeme ho.",
    "",
    "Jóga s králíčky, Fit&Fun Studio, Tovární 486/7, Ostrava-Mariánské Hory",
    "info@jogaskralicky.cz, +420 603 340 860",
  ].filter((l) => l !== null).join("\n");

  return { subject: `Dárkový poukaz ${p.code || ""}`.trim(), html, text };
}

// Fronta nese u každého řádku `kind`, takže se podle něj vybírá šablona.
// Neznámý druh raději shodí odeslání, než aby poslal prázdný e-mail —
// řádek zůstane ve frontě a je vidět, že se s ním něco děje.
export function renderMail(kind: string, params: Record<string, string>): MailOut | null {
  if (kind === "booking") return bookingMail(params);
  if (kind === "voucher") return voucherMail(params);
  return null;
}
