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

import { PLATNOST_TEXT } from "./poukaz-platnost.ts";

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
//  params: code, amount   (qr_url se sem sice pořád posílá, ale nepoužívá
//                          se — viz níž; nechává se kvůli starým řádkům
//                          ve frontě, ať se dají vykreslit i zpětně)
//
//  Posílá se JEDEN e-mail na KAŽDÝ zakoupený poukaz — každý je samostatný
//  dárek, takže se dá rovnou přeposlat obdarovanému.
//
//  PROČ TU NENÍ QR KÓD
//  Byl tu, dokud šel poukaz uplatnit jedině u dveří: host ho ukázal a
//  majitelka ho načetla čtečkou ve správě. Od zavedení uplatnění online
//  (supabase/poukaz-rezervace.sql) ale poukaz slouží k něčemu jinému —
//  k tomu, aby si obdarovaný udělal REZERVACI. Po jejím dokončení mu
//  přijde běžné potvrzení, a teprve v NĚM je QR kód, který se ukazuje
//  u dveří.
//
//  Dva QR kódy ve dvou různých e-mailech by znamenaly, že host u dveří
//  ukáže ten špatný. Poukaz proto nese jen kód; vstupenkou je až
//  potvrzení rezervace.
// ---------------------------------------------------------------------
export function voucherMail(p: Record<string, string>): MailOut {
  const html = shell(
    `Kód poukazu ${p.code || ""} — platí ${PLATNOST_TEXT} na kteroukoliv lekci.`,
    `<p style="margin:0 0 14px;">Dobrý den,</p>
     <p style="margin:0 0 22px;">děkujeme za nákup. Tohle je dárkový poukaz na jednu lekci jógy s králíčky.</p>
     <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
       <tr><td align="center" bgcolor="${FOREST}" style="background:${FOREST};border-radius:14px;padding:26px 18px;">
         <div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:rgba(247,244,236,0.7);">Kód poukazu</div>
         <div style="margin-top:10px;font-family:'Courier New',Courier,monospace;font-size:29px;font-weight:700;letter-spacing:0.06em;color:${CREAM};">${esc(p.code)}</div>
         ${p.amount ? `<div style="margin-top:10px;font-size:14px;color:rgba(247,244,236,0.85);">Hodnota ${esc(p.amount)}</div>` : ""}
       </td></tr>
     </table>
     <p style="margin:26px 0 12px;font-weight:600;">Jak si vybrat termín</p>
     <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid ${LINE};border-bottom:1px solid ${LINE};">
       <tr><td style="padding:12px 0;font-size:14px;line-height:1.6;">
         <strong>1.</strong> Na <a href="https://www.jogaskralicky.cz/rezervace.html" style="color:${FOREST};font-weight:600;">jogaskralicky.cz/rezervace</a> vyberte termín, který vám sedí.<br>
         <strong>2.</strong> Ve formuláři rozklikněte <strong>„Mám dárkový poukaz“</strong> a vepište kód výš.<br>
         <strong>3.</strong> Odešlete. <strong>Nic se neplatí</strong> — poukaz je vstupné.
       </td></tr>
     </table>
     <p style="margin:18px 0 0;">Potvrzení rezervace vám pak přijde e-mailem <strong>i s QR kódem</strong>. Ten se ukazuje ve studiu — tenhle e-mail s sebou brát nemusíte.</p>
     <p style="margin:22px 0 0;text-align:center;">
       <a href="https://www.jogaskralicky.cz/rezervace.html" style="display:inline-block;background:${FOREST};color:${CREAM};text-decoration:none;font-weight:600;font-size:15px;padding:13px 26px;border-radius:999px;">Vybrat termín</a>
     </p>
     <p style="margin:26px 0 0;">Poukaz platí <strong>${PLATNOST_TEXT}</strong> od zakoupení a může ho uplatnit kdokoliv — klidně ho rovnou přepošlete dál.</p>
     <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:22px 0 0;">
       <tr><td style="padding:14px 16px;background:${PAPER};border:1px solid ${LINE};border-radius:12px;font-size:14px;line-height:1.6;">
         <strong>V příloze je poukaz k vytištění</strong> — hezky vysázený, s kódem a v našich barvách.
         Hodí se, když chcete dárek předat na papíře.
       </td></tr>
     </table>
     <p style="margin:18px 0 0;font-size:13px;color:${INK_SOFT};">Uložte si prosím tenhle e-mail. Kdyby se kód ztratil, napište nám a najdeme ho.</p>`,
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
    "JAK SI VYBRAT TERMÍN",
    "1. Na https://www.jogaskralicky.cz/rezervace.html vyberte termín.",
    "2. Ve formuláři rozklikněte „Mám dárkový poukaz“ a vepište kód výš.",
    "3. Odešlete. Nic se neplatí — poukaz je vstupné.",
    "",
    "Potvrzení rezervace pak přijde e-mailem i s QR kódem. Ten se ukazuje",
    "ve studiu — tenhle e-mail s sebou brát nemusíte.",
    "",
    `Poukaz platí ${PLATNOST_TEXT} od zakoupení a může ho uplatnit kdokoliv.`,
    "",
    "Uložte si prosím tenhle e-mail. Kdyby se kód ztratil, napište nám a najdeme ho.",
    "",
    "Jóga s králíčky, Fit&Fun Studio, Tovární 486/7, Ostrava-Mariánské Hory",
    "info@jogaskralicky.cz, +420 603 340 860",
  ].filter((l) => l !== null).join("\n");

  return { subject: `Dárkový poukaz ${p.code || ""}`.trim(), html, text };
}

// ---------------------------------------------------------------------
//  SVOLÁVACÍ E-MAIL — ZMĚNA V UPLATŇOVÁNÍ POUKAZU
//  params: pocet ('1' pro jeden poukaz, jinak se mluví v množném čísle)
//
//  Posílá se jednorázově, ručně, jen držitelům poukazů vystavených PŘED
//  zavedením online uplatnění (supabase/poukaz-rezervace.sql) — ti dostali
//  původní e-mail s pokynem ukázat QR kód u dveří, a to teď neplatí.
//  Kód poukazu ani jeho platnost se tímto e-mailem nemění; jde čistě o to
//  říct DOPŘEDU, že další e-mail (přeposlaný `voucherMail`) přinese totéž,
//  jen s novým způsobem uplatnění — ať host neváhá otevřít podezřelý druhý
//  e-mail od stejného odesílatele týž den.
// ---------------------------------------------------------------------
export function poukazZmenaMail(p: Record<string, string>): MailOut {
  // Čeština skloňuje přídavná jména, zájmena i slovesa podle čísla, takže
  // se jednotné a množné číslo nedá poskládat prohozením jednoho slova —
  // je to dvakrát celá věta, ne šablona s ternary uprostřed.
  const vice = String(p.pocet || "1") !== "1";
  const uvod = vice
    ? "máte u nás dárkové poukazy na jógu s králíčky a chceme vás upozornit na jednu změnu."
    : "máte u nás dárkový poukaz na jógu s králíčky a chceme vás upozornit na jednu změnu.";
  const zmena = vice
    ? "<strong>Dárkové poukazy se teď uplatňují jinak.</strong> Dřív se ukazovaly u dveří na místě. Nově je uplatníte přímo v rezervačním formuláři na webu, když si vybíráte termín."
    : "<strong>Dárkový poukaz se teď uplatňuje jinak.</strong> Dřív se ukazoval u dveří na místě. Nově ho uplatníte přímo v rezervačním formuláři na webu, když si vybíráte termín.";
  const nepropada = vice
    ? "<strong>Vaše poukazy nepropadají a jejich hodnota se nemění</strong> — mění se jen způsob, jak je použijete."
    : "<strong>Váš poukaz nepropadá a jeho hodnota se nemění</strong> — mění se jen způsob, jak ho použijete.";
  const znovu = vice
    ? "V dalším e-mailu, který přijde za chvíli, vám poukazy pošleme znovu i s kódy a s novým vzhledem k vytištění."
    : "V dalším e-mailu, který přijde za chvíli, vám poukaz pošleme znovu i s kódem a s novým vzhledem k vytištění.";

  const html = shell(
    vice
      ? "Vaše dárkové poukazy platí dál — jen se změnilo, jak se uplatňují."
      : "Váš dárkový poukaz platí dál — jen se změnilo, jak se uplatňuje.",
    `<p style="margin:0 0 14px;">Dobrý den,</p>
     <p style="margin:0 0 22px;">${uvod}</p>
     <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 22px;">
       <tr><td style="padding:16px 18px;background:${PAPER};border:1px solid ${LINE};border-radius:12px;font-size:14px;line-height:1.6;">
         ${zmena}
       </td></tr>
     </table>
     <p style="margin:0 0 14px;">${nepropada}</p>
     <p style="margin:0 0 22px;">${znovu}</p>
     <p style="margin:0;">Kapacita lekcí je omezená, takže s výběrem termínu doporučujeme nečekat na poslední chvíli —
       volné termíny najdete na <a href="https://www.jogaskralicky.cz/rezervace.html" style="color:${FOREST};font-weight:600;">jogaskralicky.cz/rezervace</a>.</p>
     <p style="margin:26px 0 0;font-size:13px;color:${INK_SOFT};">Kdyby cokoliv nebylo jasné, stačí odepsat na tenhle e-mail.</p>`,
  );

  const text = vice
    ? [
        "Dobrý den,",
        "",
        uvod,
        "",
        "DÁRKOVÉ POUKAZY SE TEĎ UPLATŇUJÍ JINAK.",
        "Dřív se ukazovaly u dveří na místě. Nově je uplatníte přímo",
        "v rezervačním formuláři na webu, když si vybíráte termín.",
        "",
        "Vaše poukazy nepropadají a jejich hodnota se nemění — mění se jen",
        "způsob, jak je použijete.",
        "",
        "V dalším e-mailu, který přijde za chvíli, vám poukazy pošleme znovu",
        "i s kódy a s novým vzhledem k vytištění.",
        "",
        "Kapacita lekcí je omezená, takže s výběrem termínu doporučujeme nečekat",
        "na poslední chvíli: https://www.jogaskralicky.cz/rezervace.html",
        "",
        "Kdyby cokoliv nebylo jasné, stačí odepsat na tenhle e-mail.",
        "",
        "Jóga s králíčky, Fit&Fun Studio, Tovární 486/7, Ostrava-Mariánské Hory",
        "info@jogaskralicky.cz, +420 603 340 860",
      ].join("\n")
    : [
        "Dobrý den,",
        "",
        uvod,
        "",
        "DÁRKOVÝ POUKAZ SE TEĎ UPLATŇUJE JINAK.",
        "Dřív se ukazoval u dveří na místě. Nově ho uplatníte přímo",
        "v rezervačním formuláři na webu, když si vybíráte termín.",
        "",
        "Váš poukaz nepropadá a jeho hodnota se nemění — mění se jen způsob,",
        "jak ho použijete.",
        "",
        "V dalším e-mailu, který přijde za chvíli, vám poukaz pošleme znovu",
        "i s kódem a s novým vzhledem k vytištění.",
        "",
        "Kapacita lekcí je omezená, takže s výběrem termínu doporučujeme nečekat",
        "na poslední chvíli: https://www.jogaskralicky.cz/rezervace.html",
        "",
        "Kdyby cokoliv nebylo jasné, stačí odepsat na tenhle e-mail.",
        "",
        "Jóga s králíčky, Fit&Fun Studio, Tovární 486/7, Ostrava-Mariánské Hory",
        "info@jogaskralicky.cz, +420 603 340 860",
      ].join("\n");

  return { subject: "Změna v uplatňování dárkového poukazu", html, text };
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
//  PŘESUN NA JINÝ TERMÍN
//  params: name, lesson, datetime, old_lesson, old_datetime, spots, price,
//          location, ticket_url, qr_url
//
//  Posílá ho public.presun_rezervaci (supabase/presun-rezervace.sql), když
//  majitelka ve správě přesune rezervaci na jinou lekci — typicky proto, že
//  host onemocněl a napsal si o náhradní termín.
//
//  Starý termín je v e-mailu schválně taky, a to nahoře: host většinou píše
//  o přesun několik dní dopředu a do doručení e-mailu si nepamatuje, ze
//  kterého termínu se vlastně přesouval. Bez toho nejde poznat, jestli
//  studio přesunulo to, co mělo.
//
//  Nic se tu neslibuje o penězích: přesun je za stejnou cenu, žádná platba
//  se nekoná a doplatky se řeší ručně, ne e-mailem.
// ---------------------------------------------------------------------
export function presunMail(p: Record<string, string>): MailOut {
  const firstName = String(p.name || "").trim().split(/\s+/)[0] || "";
  const greeting = firstName ? `Dobrý den, ${esc(firstName)},` : "Dobrý den,";

  const html = shell(
    `Nový termín: ${p.datetime || ""}. Původní rezervace platí dál.`,
    `<p style="margin:0 0 14px;">${greeting}</p>
     <p style="margin:0 0 22px;">termín jsme vám přesunuli. <strong>Nic dalšího dělat nemusíte</strong> — rezervace i platba zůstávají v platnosti, mění se jen datum.</p>
     ${p.old_datetime ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 4px;">
       <tr><td style="padding:12px 16px;background:${PAPER};border:1px solid ${LINE};border-radius:12px;font-size:14px;color:${INK_SOFT};">
         Původně: <span style="text-decoration:line-through;">${esc(p.old_datetime)}</span>
       </td></tr>
     </table>
     <div style="text-align:center;font-size:19px;line-height:1;color:${INK_SOFT};padding:6px 0 2px;">&darr;</div>` : ""}
     <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
       <tr><td bgcolor="${FOREST}" style="background:${FOREST};border-radius:14px;padding:22px 18px;text-align:center;">
         <div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:rgba(247,244,236,0.7);">Nový termín</div>
         <div style="margin-top:9px;font-size:19px;font-weight:700;color:${CREAM};line-height:1.4;">${esc(p.datetime)}</div>
       </td></tr>
     </table>
     <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:22px;border-top:1px solid ${LINE};border-bottom:1px solid ${LINE};padding:4px 0;">
       ${row("Lekce", p.lesson)}
       ${row("Míst", p.spots)}
       ${row("Zaplaceno", p.price)}
       ${row("Kde", p.location)}
     </table>
     ${p.qr_url ? qrBlock(p.qr_url, "Tenhle kód platí dál — je to pořád tatáž rezervace.<br>Ve studiu stačí ukázat, nic tisknout nemusíte.") : ""}
     ${p.ticket_url ? `<p style="margin:22px 0 0;text-align:center;">
       <a href="${esc(p.ticket_url)}" style="display:inline-block;background:${FOREST};color:${CREAM};text-decoration:none;font-weight:600;font-size:15px;padding:13px 26px;border-radius:999px;">Stav rezervace</a>
     </p>
     <p style="margin:14px 0 0;text-align:center;font-size:12px;color:${INK_SOFT};word-break:break-all;">${esc(p.ticket_url)}</p>` : ""}
     <p style="margin:26px 0 0;font-size:13px;color:${INK_SOFT};">Kdyby vám nový termín nevyhovoval, stačí odepsat na tenhle e-mail a najdeme jiný.</p>`,
  );

  // Prázdné řetězce jsou záměrné mezery mezi odstavci, `null` je „tenhle
  // údaj nemáme" — filtruje se jen to druhé.
  const text = [
    firstName ? `Dobrý den, ${firstName},` : "Dobrý den,",
    "",
    "termín jsme vám přesunuli. Nic dalšího dělat nemusíte — rezervace i platba zůstávají v platnosti, mění se jen datum.",
    "",
    p.old_datetime ? `Původně: ${p.old_datetime}` : null,
    `NOVÝ TERMÍN: ${p.datetime || ""}`,
    "",
    p.lesson ? `Lekce: ${p.lesson}` : null,
    p.spots ? `Míst: ${p.spots}` : null,
    p.price ? `Zaplaceno: ${p.price}` : null,
    p.location ? `Kde: ${p.location}` : null,
    "",
    p.ticket_url ? `Stav rezervace a QR kód: ${p.ticket_url}` : null,
    p.ticket_url ? "Kód z původního potvrzení platí dál — je to tatáž rezervace." : null,
    p.ticket_url ? "" : null,
    "Kdyby vám nový termín nevyhovoval, stačí odepsat na tenhle e-mail a najdeme jiný.",
    "",
    "Jóga s králíčky, Fit&Fun Studio, Tovární 486/7, Ostrava-Mariánské Hory",
    "info@jogaskralicky.cz, +420 603 340 860",
  ].filter((l) => l !== null).join("\n");

  return {
    subject: p.datetime ? `Nový termín — ${p.datetime}` : "Nový termín lekce",
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

// ---------------------------------------------------------------------
//  VLASTNÍ E-MAIL
//  params: subject, name (nepovinné).
//  intro/closing: prostý text (prázdný řádek = nový odstavec) — `message`
//  je starší alias pro `intro`, kvůli řádkům už ve frontě.
//  lesson/datetime/spots/entry/location: nepovinná tabulka s tučnými
//  hodnotami, stejný vzhled (padding, dělicí linky) jako v bookingMail.
//  Nepovinně až dvě vstupenky: qr_url/ticket_url a qr_url2/ticket_url2
//  (druhá dvojice pro druhé místo, kdyby zpráva pokrývala dvě ruční
//  rezervace najednou). qr_caption/qr_caption2 přebijí výchozí text.
//
//  Pro jednorázové ruční zprávy, které nesedí do žádné z šablon výš
//  (např. pozvánka novináři) — proto žádná domněnka o platbě ani
//  o rezervaci, jen to, co pošleme jako parametry.
// ---------------------------------------------------------------------
export function customMail(p: Record<string, string>): MailOut {
  const firstName = String(p.name || "").trim().split(/\s+/)[0] || "";
  const greeting = firstName ? `Dobrý den, ${esc(firstName)},` : "Dobrý den,";

  const intro = String(p.intro || p.message || "").trim();
  const introHtml = intro
    .split(/\n{2,}/)
    .map((par) => par.trim())
    .filter(Boolean)
    .map((par) => `<p style="margin:0 0 22px;">${esc(par).replace(/\n/g, "<br>")}</p>`)
    .join("");

  const hasTable = Boolean(p.lesson || p.datetime || p.spots || p.entry || p.location);
  const table = hasTable
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid ${LINE};border-bottom:1px solid ${LINE};padding:4px 0;">
       ${row("Lekce", p.lesson)}
       ${row("Kdy", p.datetime)}
       ${row("Míst", p.spots)}
       ${row("Vstup", p.entry)}
       ${row("Kde", p.location)}
     </table>`
    : "";

  const tickets = [
    { qr: p.qr_url, url: p.ticket_url, caption: p.qr_caption },
    { qr: p.qr_url2, url: p.ticket_url2, caption: p.qr_caption2 },
  ].filter((t): t is { qr: string; url: string; caption?: string } => Boolean(t.qr));

  const qrHtml = tickets
    .map((t) => qrBlock(t.qr, t.caption || "Ve studiu stačí ukázat tenhle kód.<br>Nemusíte nic tisknout."))
    .join("");

  const closing = String(p.closing || "").trim();
  const closingHtml = closing
    ? `<p style="margin:26px 0 0;font-size:13px;color:${INK_SOFT};">${esc(closing)}</p>`
    : "";

  const html = shell(
    p.subject || "Jóga s králíčky",
    `<p style="margin:0 0 14px;">${greeting}</p>${introHtml}${table}${qrHtml}${closingHtml}`,
  );

  const text = [
    firstName ? `Dobrý den, ${firstName},` : "Dobrý den,",
    "",
    intro,
    hasTable ? "" : null,
    p.lesson ? `Lekce: ${p.lesson}` : null,
    p.datetime ? `Kdy: ${p.datetime}` : null,
    p.spots ? `Míst: ${p.spots}` : null,
    p.entry ? `Vstup: ${p.entry}` : null,
    p.location ? `Kde: ${p.location}` : null,
    tickets.length ? "" : null,
    ...tickets.map((t, i) => `Vstupenka${tickets.length > 1 ? ` ${i + 1}` : ""}: ${t.url || t.qr}`),
    closing ? "" : null,
    closing || null,
    "",
    "Jóga s králíčky, Fit&Fun Studio, Tovární 486/7, Ostrava-Mariánské Hory",
    "info@jogaskralicky.cz, +420 603 340 860",
  ].filter((l) => l !== null).join("\n");

  return { subject: p.subject || "Jóga s králíčky", html, text };
}

// Fronta nese u každého řádku `kind`, takže se podle něj vybírá šablona.
// Neznámý druh raději shodí odeslání, než aby poslal prázdný e-mail —
// řádek zůstane ve frontě a je vidět, že se s ním něco děje.
export function renderMail(kind: string, params: Record<string, string>): MailOut | null {
  if (kind === "booking") return bookingMail(params);
  if (kind === "voucher") return voucherMail(params);
  if (kind === "poukaz_zmena") return poukazZmenaMail(params);
  if (kind === "cancel") return cancelMail(params);
  if (kind === "presun") return presunMail(params);
  if (kind === "welcome") return welcomeMail(params);
  if (kind === "custom") return customMail(params);
  return null;
}
