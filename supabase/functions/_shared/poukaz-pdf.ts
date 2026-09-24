// =====================================================================
//  Dárkový poukaz jako PDF — příloha e-mailu s kódem
//
//  PROČ TO EXISTUJE
//  Poukaz se kupuje jako dárek, jenže dosud z něj byl jen e-mail s kódem.
//  Ten se nedá zabalit ani položit pod stromeček. Tohle je tatáž
//  informace ve formě, která se dá vytisknout a předat.
//
//  Kreslí se vektorově, ne z obrázku: text zůstává ostrý při jakémkoli
//  zvětšení, kód jde z PDF označit a zkopírovat a soubor má pár desítek
//  kilobajtů, takže nenafoukne přílohu e-mailu.
//
//  Logo se překresluje ručně podle assets/logo.svg (kruh, dvě ouška,
//  hlava, tělo). Vkládat PNG by znamenalo buď rozmazané logo, nebo
//  stažení obrázku při každém odeslání.
//
//  ROZVRŽENÍ
//  Předlohou je schválený návrh (210 × 99 mm, na šířku): vlevo velké
//  logo v kolečku se jménem studia pod ním, vpravo nadpis, krátký perex,
//  vlasová linka a smetanová karta rozdělená na dva sloupce — kód
//  poukazu a platnost. Dole kontakty s ikonami.
//
//  Míry níž jsou přepočtené z návrhu v milimetrech, proto pomocná
//  funkce mm(). Držet je v milimetrech je záměr: když se má něco
//  posunout, čte se to stejně jako v návrhu, ne v přepočtených bodech.
// =====================================================================

import { PDFDocument, rgb, type PDFPage } from "https://esm.sh/pdf-lib@1.17.1";
import fontkit from "https://esm.sh/@pdf-lib/fontkit@1.1.1";
import { font } from "./poukaz-fonty.ts";
import { PLATNOST_TEXT } from "./poukaz-platnost.ts";
import type { PoukazDruh } from "./poukaz-druh.ts";

// Barvy webu (index.html → :root). Musí sedět, jinak poukaz vypadá
// jako z jiné firmy než stránka, ze které přišel.
const FOREST = rgb(0x2C / 255, 0x3B / 255, 0x2E / 255);
const FOREST_DEEP = rgb(0x1E / 255, 0x29 / 255, 0x20 / 255);
const CLOVER = rgb(0x6E / 255, 0x8A / 255, 0x4E / 255);
const CREAM = rgb(0xF7 / 255, 0xF4 / 255, 0xEC / 255);
const INK_SOFT = rgb(0x5C / 255, 0x63 / 255, 0x57 / 255);
const CARROT = rgb(0xD2 / 255, 0x85 / 255, 0x4A / 255);
const LINE = rgb(0xE3 / 255, 0xDF / 255, 0xD3 / 255);

// Průsvitné odstíny smetanové na zeleném pozadí. Návrh je zapisuje jako
// rgba(…, .86); PDF průhlednost umí, ale kvůli třem textům by se kvůli ní
// zaváděl grafický stav navíc — proto jsou barvy předmíchané napevno.
const mix = (pomer: number) => rgb(
  (0xF7 * pomer + 0x2C * (1 - pomer)) / 255,
  (0xF4 * pomer + 0x3B * (1 - pomer)) / 255,
  (0xEC * pomer + 0x2E * (1 - pomer)) / 255,
);
const CREAM_86 = mix(0.86);   // perex
const CREAM_88 = mix(0.88);   // kontakty
const CREAM_18 = mix(0.18);   // vlasová linka

// Milimetry na body (1 bod = 1/72"). Návrh je v milimetrech.
const mm = (v: number) => v * 72 / 25.4;

const W = mm(210);
const H = mm(99);

export type PoukazData = {
  code: string;
  /** Text v poli „Platnost poukazu". Bez něj se sází obecná doba platnosti. */
  platnost?: string;
  /** Na jakou lekci poukaz platí (mění perex). Výchozí je klasická lekce. */
  druh?: PoukazDruh;
};

// ---------------------------------------------------------------------
//  POMOCNÍCI NA KRESLENÍ
// ---------------------------------------------------------------------

// Návrh je popsaný shora dolů (jako v CSS), PDF ale měří zdola nahoru.
// Tahle funkce převádí „kolik milimetrů od horního okraje" na PDF y.
const shora = (mmOdShora: number) => H - mm(mmOdShora);

// Zaoblený obdélník. pdf-lib rohy zaoblit neumí, takže si cestu složíme
// sami — rovnou v SVG soustavě (y roste dolů), protože drawSvgPath ji
// tak čte a umisťuje od bodu `y`.
function zaoblenyObdelnik(
  page: PDFPage,
  x: number, yShora: number, w: number, h: number, r: number,
  color: ReturnType<typeof rgb>,
) {
  const t = yShora, b = yShora + h;
  const k = r * 0.5523;               // řídicí rameno pro kruhový oblouk
  const cesta =
    `M ${x + r} ${t} ` +
    `L ${x + w - r} ${t} C ${x + w - r + k} ${t} ${x + w} ${t + r - k} ${x + w} ${t + r} ` +
    `L ${x + w} ${b - r} C ${x + w} ${b - r + k} ${x + w - r + k} ${b} ${x + w - r} ${b} ` +
    `L ${x + r} ${b} C ${x + r - k} ${b} ${x} ${b - r + k} ${x} ${b - r} ` +
    `L ${x} ${t + r} C ${x} ${t + r - k} ${x + r - k} ${t} ${x + r} ${t} Z`;
  page.drawSvgPath(cesta, { x: 0, y: H, color, scale: 1 });
}

// Ouška králíčka přesně podle assets/logo.svg, jen s předpočítaným
// natočením (v SVG jsou zapsaná jako rotate(∓7) kolem vlastního čepu —
// drawSvgPath transformace neumí, tak jsou body otočené napevno).
const UCHO_L = "M90.89 119.95 C 82.01 96.86 76.12 65.34 75.67 45.24 C 75.32 34.20 82.03 31.37 86.35 41.92 C 92.51 59.30 96.90 95.03 99.82 118.85 Z";
const UCHO_P = "M109.11 119.95 C 117.99 96.86 124.12 63.35 124.57 43.26 C 124.92 32.22 117.97 31.37 113.65 41.92 C 107.49 59.30 103.10 95.03 100.18 118.85 Z";

// Králíček v kolečku, vnitřek podle původního viewBoxu 200 × 200.
function logo(page: PDFPage, cx: number, cy: number, r: number) {
  const s = r / 90;                    // 90 = poloměr kruhu v původním SVG
  const bila = rgb(0xF2 / 255, 0xEF / 255, 0xE6 / 255);
  const px = (sx: number) => cx + (sx - 100) * s;
  const py = (sy: number) => cy - (sy - 100) * s;

  page.drawCircle({ x: cx, y: cy, size: r, color: CLOVER });
  for (const cesta of [UCHO_L, UCHO_P]) {
    page.drawSvgPath(cesta, { x: cx - 100 * s, y: cy + 100 * s, scale: s, color: bila });
  }
  page.drawEllipse({ x: px(100), y: py(98), xScale: 27 * s, yScale: 29 * s, color: bila });
  page.drawEllipse({ x: px(100), y: py(146), xScale: 35 * s, yScale: 38 * s, color: bila });
}

// Linkové ikonky ke kontaktům, v soustavě 24 × 24 jako v návrhu. Kreslí
// se obtahem, ne výplní. Tloušťka obtahu se se `scale` nepřepočítává,
// proto se násobí ručně.
const IKONA_WEB = [
  // Kruh složený ze čtyř oblouků: 'A' příkaz drawSvgPath spolehlivě
  // nezvládá, kubiky ano.
  "M3 12 C3 7.03 7.03 3 12 3 C16.97 3 21 7.03 21 12 C21 16.97 16.97 21 12 21 C7.03 21 3 16.97 3 12 Z",
  "M3 12 L21 12",
  // Poledníky — původní zkratka 'S' rozepsaná na plné kubiky.
  "M12 3 C14.5 5.6 15.8 8.6 15.8 12 C15.8 15.4 14.5 18.4 12 21",
  "M12 3 C9.5 5.6 8.2 8.6 8.2 12 C8.2 15.4 9.5 18.4 12 21",
];
const IKONA_MAIL = [
  "M5 5 L19 5 C20.1 5 21 5.9 21 7 L21 17 C21 18.1 20.1 19 19 19 L5 19 C3.9 19 3 18.1 3 17 L3 7 C3 5.9 3.9 5 5 5 Z",
  "M4 7 L12 13 L20 7",
];
const IKONA_TEL = [
  "M7.2 3.5 L10 7.1 L8.2 9.4 c1.3 2.6 3.8 5.1 6.4 6.4 l2.3 -1.8 l3.6 2.8 l-.9 3.1 c-.3 1 -1.3 1.6 -2.3 1.5 C10 20.3 3.7 14 2.6 6.7 c-.1 -1 .5 -2 1.5 -2.3 l3.1 -.9 Z",
];

function ikona(page: PDFPage, cesty: string[], x: number, yShora: number, velikost: number) {
  const s = velikost / 24;
  for (const cesta of cesty) {
    page.drawSvgPath(cesta, {
      x, y: H - yShora, scale: s,
      borderColor: CREAM, borderWidth: 1.8 * s,
    });
  }
}

// ---------------------------------------------------------------------
//  SAMOTNÝ POUKAZ
// ---------------------------------------------------------------------
export async function poukazPdf(data: PoukazData): Promise<Uint8Array> {
  const kod = String(data.code || "").trim().toUpperCase();
  const platnost = String(data.platnost || "").trim() || PLATNOST_TEXT;

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`Dárkový poukaz ${kod}`);
  doc.setAuthor("Jóga s králíčky");
  doc.setSubject("Dárkový poukaz na lekci jógy s králíčky");
  doc.setProducer("jogaskralicky.cz");

  // Fonty se stahují z webu a drží v paměti (viz poukaz-fonty.ts).
  // subset: true = do PDF jde jen to, co se opravdu vysází.
  const fNadpis = await doc.embedFont(await font("schibsted-600"), { subset: true });
  const fZnacka = await doc.embedFont(await font("schibsted-700"), { subset: true });
  const fText = await doc.embedFont(await font("hanken-400"), { subset: true });
  const fPopisek = await doc.embedFont(await font("hanken-600"), { subset: true });

  const page = doc.addPage([W, H]);

  // --- pozadí -------------------------------------------------------
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: FOREST });

  // --- levý sloupec: logo a jméno studia ----------------------------
  // Návrh: logo 54 mm široké, levý okraj 8,8 mm, horní 13,5 mm.
  logo(page, mm(8.8 + 27), shora(13.5 + 27), mm(27));
  page.drawText("Jóga s králíčky", {
    x: mm(11.5), y: shora(89), font: fZnacka, size: mm(4.6), color: CREAM,
  });

  // --- pravý sloupec ------------------------------------------------
  const L = mm(92.5);                  // levý okraj pravého sloupce

  page.drawText("Dárkový poukaz", {
    x: L, y: shora(19.2), font: fNadpis, size: mm(8.7), color: CREAM,
  });

  // Perex se láme na dva řádky přesně jako v návrhu. Dětský poukaz říká,
  // že platí na lekci Děti & králíčci pro zástupce s jedním dítětem.
  const perex = data.druh === "deti"
    ? [
      "Poukaz na lekci Děti & králíčci v Ostravě pro zákonného",
      "zástupce s jedním dítětem.",
    ]
    : [
      "Darujte hodinu klidu mezi králíčky. Poukaz na jednu lekci jógy v",
      "Ostravě.",
    ];
  perex.forEach((r, i) => {
    page.drawText(r, {
      x: L, y: shora(29.5 + i * 4.4), font: fText, size: mm(3.2), color: CREAM_86,
    });
  });

  // Vlasová linka nad kartou.
  page.drawRectangle({
    x: L, y: shora(42.5), width: mm(99), height: mm(0.25), color: CREAM_18,
  });

  // --- karta s údaji ------------------------------------------------
  const KARTA_Y = 51, KARTA_H = 23, SIRKA = 106, DELIC = 67;
  zaoblenyObdelnik(page, L, mm(KARTA_Y), mm(SIRKA), mm(KARTA_H), mm(4.5), CREAM);

  // Barevné proužky u horní hrany karty. Kreslí se až po ní, aby ležely
  // navrchu, a zkrácené o poloměr zaoblení, ať nepřečuhují přes oblouk.
  page.drawRectangle({
    x: L + mm(4.5), y: shora(KARTA_Y + 1), width: mm(DELIC - 4.5), height: mm(1), color: CARROT,
  });
  page.drawRectangle({
    x: L + mm(DELIC), y: shora(KARTA_Y + 1), width: mm(SIRKA - DELIC - 4.5), height: mm(1), color: CLOVER,
  });

  // Svislý předěl mezi sloupci.
  page.drawRectangle({
    x: L + mm(DELIC), y: shora(KARTA_Y + KARTA_H), width: mm(0.3), height: mm(KARTA_H), color: LINE,
  });

  // Dva sloupce: popisek nahoře, hodnota pod ním.
  const sloupec = (
    x: number, sirkaMm: number, label: string, hodnota: string, velikostMm: number,
  ) => {
    page.drawText(label, {
      x: x + mm(5.3), y: shora(KARTA_Y + 4.8 + 2.45), font: fPopisek, size: mm(2.45), color: INK_SOFT,
    });
    // Delší text se zmenší, ať zůstane na jednom řádku — zalomený kód
    // by se špatně přepisoval a do sloupce by se stejně nevešel.
    const maxSirka = mm(sirkaMm - 10.6);
    let velikost = mm(velikostMm);
    while (fZnacka.widthOfTextAtSize(hodnota, velikost) > maxSirka && velikost > mm(2.6)) {
      velikost -= 0.4;
    }
    page.drawText(hodnota, {
      x: x + mm(5.3), y: shora(KARTA_Y + 4.8 + 2.45 + 2.1 + velikostMm),
      font: fZnacka, size: velikost, color: FOREST_DEEP,
    });
  };
  sloupec(L, DELIC, "Kód poukazu", kod, 5);
  sloupec(L + mm(DELIC), SIRKA - DELIC, "Platnost poukazu", platnost, 4.4);

  // --- kontakty -----------------------------------------------------
  // Ikona a text vedle sebe, položky za sebou s mezerou 3,7 mm.
  const KONTAKT_Y = 89;                // účaří textu
  const IKONA_MM = 3.4;
  const kontakty: Array<[string[], string]> = [
    [IKONA_WEB, "jogaskralicky.cz"],
    [IKONA_MAIL, "info@jogaskralicky.cz"],
    [IKONA_TEL, "+420 603 340 860"],
  ];
  let kurzor = L;
  for (const [cesty, popis] of kontakty) {
    ikona(page, cesty, kurzor, mm(KONTAKT_Y - 2.6), mm(IKONA_MM));
    const tx = kurzor + mm(IKONA_MM + 1.2);
    page.drawText(popis, { x: tx, y: shora(KONTAKT_Y), font: fText, size: mm(2.15), color: CREAM_88 });
    kurzor = tx + fText.widthOfTextAtSize(popis, mm(2.15)) + mm(3.7);
  }

  return await doc.save();
}

// Base64 pro přílohu e-mailu. Brevo chce obsah jako base64 řetězec.
export function pdfBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;   // po částech, ať se nepřeteče zásobník volání
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
