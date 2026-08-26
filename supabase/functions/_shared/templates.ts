// =====================================================================
//  HTML podoba odchozích e-mailů
//
//  Dokud se posílalo přes EmailJS, žila tahle část mimo repozitář — v jejich
//  webovém editoru šablon. To mělo tři nepříjemné důsledky: nešlo to
//  verzovat, nešlo to zkontrolovat před nasazením a hlavně to znamenalo,
//  že jsme na tom dodavateli viseli i obsahem, ne jen doručením.
//
//  Vstupem jsou přesně ta pole, která leží v email_outbox.params, takže se
//  nic nemigruje — fronta zůstává, jak je, a starým řádkům se nic nestane.
//
//  PRAVIDLA PRO HTML V E-MAILECH (proto to vypadá jako web z roku 2005):
//    * layout na <table>, ne flex/grid — Outlook nic jiného spolehlivě neumí
//    * styly inline, ne v <style> — Gmail <style> v některých případech zahodí
//    * žádný JavaScript, žádné externí CSS, obrázky jen jako <img src="https://…">
//    * žádný gradient na barevném bloku se světlým textem — Gmail v tmavém
//      režimu pozadí přebarví, ale text ne, a nadpis zmizí
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

// Obálka, kterou sdílí všechny e-maily. `preheader` je text, co se v seznamu
// zpráv ukáže hned za předmětem — když ho nenastavíme, klient tam nacpe
// první větu HTML, což bývá „Zobrazit v prohlížeči" nebo prázdno.
function shell(preheader: string, body: string): string {
  return `<!doctype html>
<html lang="cs"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>Jóga s králíčky</title>
</head>
<body style="margin:0;padding:0;background:${PAPER};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAPER};">
<tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#FFFFFF;border:1px solid ${LINE};border-radius:16px;overflow:hidden;box-shadow:0 12px 32px rgba(30,35,28,0.12);">
    <tr><td bgcolor="${FOREST}" style="background:${FOREST};padding:24px 28px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="padding-right:12px;">
          <img src="https://www.jogaskralicky.cz/assets/logo-email.png" width="40" height="40" alt="" style="display:block;width:40px;height:40px;border-radius:50%;border:2px solid rgba(247,244,236,0.4);">
        </td>
        <td style="vertical-align:middle;">
          <span style="font-family:Georgia,'Times New Roman',serif;font-size:19px;font-weight:600;color:${CREAM};letter-spacing:-0.01em;">Jóga s králíčky</span>
        </td>
      </tr></table>
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
//  Posílá se JEDEN e-mail na KAŽDÝ zakoupený poukaz — každý je samostatný
//  dárek, takže se dá rovnou přeposlat obdarovanému.
// ---------------------------------------------------------------------
export function voucherMail(p: Record<string, string>): MailOut {
  const html = shell(
    `Kód poukazu ${p.code || ""} — platí rok na kteroukoliv lekci.`,
    `<p style="margin:0 0 14px;">Dobrý den,</p>
     <p style="margin:0 0 22px;">děkujeme za nákup. Tohle je dárkový poukaz na jednu lekci jógy s králíčky — obdarovaný ho uplatní přímo ve studiu, stačí ukázat kód.</p>
     <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
       <tr><td align="center" bgcolor="${FOREST}" style="background:${FOREST};border-radius:14px;padding:26px 18px;">
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

// ---------------------------------------------------------------------
//  ZRUŠENÍ LEKCE
//  params: name, lesson, datetime, spots, price, zaplaceno ('1' | '')
//
//  Když majitelka zruší lekci, hosté se to dřív nedozvěděli vůbec —
//  admin jen připomněl „nezapomeňte hosty informovat“. Host, který
//  zaplatil, tak mohl klidně přijet do studia na lekci, co se nekoná.
//
//  Text schválně nic neslibuje o penězích automaticky: vratky se řeší
//  ručně, takže e-mail říká, že se ozveme, a nabídne obě obvyklé cesty
//  (náhradní termín / poukaz), jak je má i obchodní řád.
// ---------------------------------------------------------------------
export function cancelMail(p: Record<string, string>): MailOut {
  const firstName = String(p.name || "").trim().split(/\s+/)[0] || "";
  const zaplaceno = String(p.zaplaceno || "") === "1";

  const html = shell(
    `${p.lesson || "Lekce"} ${p.datetime || ""} se bohužel nekoná.`,
    `<p style="margin:0 0 14px;">${firstName ? `Dobrý den, ${esc(firstName)},` : "Dobrý den,"}</p>
     <p style="margin:0 0 22px;">moc nás to mrzí, ale <strong>tuhle lekci musíme zrušit</strong>. Nepřijíždějte prosím do studia.</p>
     <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid ${LINE};border-bottom:1px solid ${LINE};padding:4px 0;">
       ${row("Zrušená lekce", p.lesson)}
       ${row("Původní termín", p.datetime)}
       ${row("Míst", p.spots)}
     </table>
     ${zaplaceno
       ? `<p style="margin:22px 0 0;">Vstupné máte zaplacené${p.price ? ` (${esc(p.price)})` : ""}. Ozveme se vám do dvou pracovních dnů a domluvíme se — buď vás <strong>přesuneme na jiný termín</strong>, vystavíme <strong>dárkový poukaz v plné hodnotě</strong>, nebo vám peníze vrátíme zpět na kartu. Vyberete si vy.</p>`
       : `<p style="margin:22px 0 0;">Rezervace nebyla zaplacená, takže se nic nestrhlo a nemusíte nic řešit.</p>`}
     <p style="margin:20px 0 0;">Nejbližší volné termíny najdete na
       <a href="https://www.jogaskralicky.cz/rezervace.html" style="color:${FOREST};font-weight:600;">jogaskralicky.cz/rezervace</a>.</p>
     <p style="margin:24px 0 0;font-size:13px;color:${INK_SOFT};">Omlouváme se za komplikace. Kdyby cokoliv, stačí odepsat na tenhle e-mail.</p>`,
  );

  const text = [
    firstName ? `Dobrý den, ${firstName},` : "Dobrý den,",
    "",
    "moc nás to mrzí, ale tuhle lekci musíme zrušit. Nepřijíždějte prosím do studia.",
    "",
    p.lesson ? `Zrušená lekce: ${p.lesson}` : null,
    p.datetime ? `Původní termín: ${p.datetime}` : null,
    p.spots ? `Míst: ${p.spots}` : null,
    "",
    zaplaceno
      ? `Vstupné máte zaplacené${p.price ? ` (${p.price})` : ""}. Ozveme se do dvou pracovních dnů a domluvíme se — náhradní termín, dárkový poukaz v plné hodnotě, nebo vrácení peněz na kartu.`
      : "Rezervace nebyla zaplacená, takže se nic nestrhlo a nemusíte nic řešit.",
    "",
    "Nejbližší volné termíny: https://www.jogaskralicky.cz/rezervace.html",
    "",
    "Omlouváme se za komplikace. Kdyby cokoliv, stačí odepsat na tenhle e-mail.",
    "",
    "Jóga s králíčky, Fit&Fun Studio, Tovární 486/7, Ostrava-Mariánské Hory",
    "info@jogaskralicky.cz, +420 603 340 860",
  ].filter((l) => l !== null).join("\n");

  return {
    subject: p.datetime ? `Zrušená lekce — ${p.datetime}` : "Zrušená lekce",
    html,
    text,
  };
}

// ---------------------------------------------------------------------
//  UVÍTÁNÍ V NEWSLETTERU
//  params: email
// ---------------------------------------------------------------------
export function welcomeMail(p: Record<string, string>): MailOut {
  const unsubUrl = `https://www.jogaskralicky.cz/?unsub=${encodeURIComponent(p.email || "")}`;

  const html = shell(
    "Jste přihlášeni — občas pošleme nové termíny a pár fotek králíků.",
    `<p style="margin:0 0 14px;">Dobrý den,</p>
     <p style="margin:0 0 22px;">díky za přihlášení k odběru novinek. Nebudeme vás zahlcovat — občas pošleme <strong>nové termíny</strong>, <strong>akce</strong> a pár <strong>fotek králíků</strong> ze studia.</p>
     <p style="margin:0;">Volné termíny na lekce najdete kdykoliv na
       <a href="https://www.jogaskralicky.cz/rezervace.html" style="color:${FOREST};font-weight:600;">jogaskralicky.cz/rezervace</a>.</p>
     <p style="margin:26px 0 0;font-size:12px;color:${INK_SOFT};">Odhlásit se můžete kdykoliv jedním kliknutím: <a href="${esc(unsubUrl)}" style="color:${INK_SOFT};">odhlásit odběr</a>.</p>`,
  );

  const text = [
    "Dobrý den,",
    "",
    "díky za přihlášení k odběru novinek. Nebudeme vás zahlcovat — občas pošleme nové termíny, akce a pár fotek králíků ze studia.",
    "",
    "Volné termíny: https://www.jogaskralicky.cz/rezervace.html",
    "",
    `Odhlásit se můžete kdykoliv: ${unsubUrl}`,
    "",
    "Jóga s králíčky, Fit&Fun Studio, Tovární 486/7, Ostrava-Mariánské Hory",
    "info@jogaskralicky.cz, +420 603 340 860",
  ].join("\n");

  return { subject: "Vítejte v newsletteru Jóga s králíčky", html, text };
}

// Fronta nese u každého řádku `kind`, takže se podle něj vybírá šablona.
// Neznámý druh raději shodí odeslání, než aby poslal prázdný e-mail —
// řádek zůstane ve frontě a je vidět, že se s ním něco děje.
export function renderMail(kind: string, params: Record<string, string>): MailOut | null {
  if (kind === "booking") return bookingMail(params);
  if (kind === "voucher") return voucherMail(params);
  if (kind === "cancel") return cancelMail(params);
  if (kind === "welcome") return welcomeMail(params);
  return null;
}
