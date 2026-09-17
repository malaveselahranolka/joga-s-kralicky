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
//  stažení obrázku při každém odeslání — a to by odeslání e-mailu
//  zezávislelo na dostupnosti webu.
//
//  Formát je A5 na šířku: vytiskne se na A4 bez ořezu a velikostí
//  odpovídá běžné dárkové poukázce.
// =====================================================================

import { PDFDocument, rgb, degrees, type PDFFont, type PDFPage } from "https://esm.sh/pdf-lib@1.17.1";
import fontkit from "https://esm.sh/@pdf-lib/fontkit@1.1.1";
import { NADPIS_B64, TEXT_B64, TEXT_BOLD_B64, bajty } from "./poukaz-fonty.ts";

// Barvy webu (index.html → :root). Musí sedět, jinak poukaz vypadá
// jako z jiné firmy než stránka, ze které přišel.
const FOREST = rgb(0x2C / 255, 0x3B / 255, 0x2E / 255);
const FOREST_DEEP = rgb(0x1E / 255, 0x29 / 255, 0x20 / 255);
const CLOVER = rgb(0x6E / 255, 0x8A / 255, 0x4E / 255);
const CREAM = rgb(0xF7 / 255, 0xF4 / 255, 0xEC / 255);
const PAPER = rgb(0xF1 / 255, 0xEE / 255, 0xE5 / 255);
const INK = rgb(0x1E / 255, 0x23 / 255, 0x1C / 255);
const INK_SOFT = rgb(0x5C / 255, 0x63 / 255, 0x57 / 255);
const CARROT = rgb(0xD2 / 255, 0x85 / 255, 0x4A / 255);

// A5 na šířku v bodech (1 bod = 1/72"). 210 × 148 mm.
const W = 595.28;
const H = 419.53;

export type PoukazData = {
  code: string;
  amount?: string;   // „499 Kč"
  expires?: string;  // „17. 10. 2027"
};

// Zaoblený obdélník. pdf-lib rohy zaoblit neumí, takže si cestu složíme
// sami.
//
// POZOR NA OSU Y: drawSvgPath čte cestu v SVG soustavě (y roste DOLŮ)
// a umisťuje ji od bodu `y`. Kdyby se sem poslaly rovnou PDF souřadnice,
// obdélník se svisle převrátí a sedne o (H − 2y − h) jinam — u symetrického
// tvaru to není vidět na tvaru, ale je to vidět na pozici. Proto se vstup
// bere v PDF souřadnicích (x, y = levý DOLNÍ roh) a tady se převede.
function zaoblenyObdelnik(
  page: PDFPage,
  x: number, y: number, w: number, h: number, r: number,
  opts: { color?: ReturnType<typeof rgb>; borderColor?: ReturnType<typeof rgb>; borderWidth?: number },
) {
  const t = H - (y + h);              // horní hrana v SVG soustavě
  const b = H - y;                    // dolní hrana v SVG soustavě
  const k = r * 0.5523;               // řídicí rameno pro kruhový oblouk
  const cesta =
    `M ${x + r} ${t} ` +
    `L ${x + w - r} ${t} C ${x + w - r + k} ${t} ${x + w} ${t + r - k} ${x + w} ${t + r} ` +
    `L ${x + w} ${b - r} C ${x + w} ${b - r + k} ${x + w - r + k} ${b} ${x + w - r} ${b} ` +
    `L ${x + r} ${b} C ${x + r - k} ${b} ${x} ${b - r + k} ${x} ${b - r} ` +
    `L ${x} ${t + r} C ${x} ${t + r - k} ${x + r - k} ${t} ${x + r} ${t} Z`;
  page.drawSvgPath(cesta, {
    x: 0, y: H,
    color: opts.color,
    borderColor: opts.borderColor,
    borderWidth: opts.borderWidth,
    scale: 1,
  });
}

// Ouška králíčka přesně podle assets/logo.svg, jen s předpočítaným
// natočením (v SVG jsou zapsaná jako rotate(∓7) kolem vlastního čepu —
// drawSvgPath transformace neumí, tak jsou body otočené napevno).
// Elipsy místo nich nestačily: ouška jsou špičatá a rozbíhavá, kdežto
// elipsy splynuly s hlavou v jednu kapku.
const UCHO_L = "M90.89 119.95 C 82.01 96.86 76.12 65.34 75.67 45.24 C 75.32 34.20 82.03 31.37 86.35 41.92 C 92.51 59.30 96.90 95.03 99.82 118.85 Z";
const UCHO_P = "M109.11 119.95 C 117.99 96.86 124.12 63.35 124.57 43.26 C 124.92 32.22 117.97 31.37 113.65 41.92 C 107.49 59.30 103.10 95.03 100.18 118.85 Z";

// Králíček v kolečku. Kreslí se do kruhu o poloměru r se středem (cx, cy);
// vnitřek je v původním viewBoxu 200 × 200.
function logo(page: PDFPage, cx: number, cy: number, r: number) {
  const s = r / 90;                    // 90 = poloměr kruhu v původním SVG
  const bila = rgb(0xF2 / 255, 0xEF / 255, 0xE6 / 255);
  const px = (sx: number) => cx + (sx - 100) * s;
  const py = (sy: number) => cy - (sy - 100) * s;

  page.drawCircle({ x: cx, y: cy, size: r, color: CLOVER });
  // Cesty jsou v SVG soustavě, takže se umístí tak, aby bod (100,100)
  // padl na střed kolečka.
  for (const cesta of [UCHO_L, UCHO_P]) {
    page.drawSvgPath(cesta, { x: cx - 100 * s, y: cy + 100 * s, scale: s, color: bila });
  }
  page.drawEllipse({ x: px(100), y: py(98), xScale: 27 * s, yScale: 29 * s, color: bila });
  page.drawEllipse({ x: px(100), y: py(146), xScale: 35 * s, yScale: 38 * s, color: bila });
}

// Text s proloženými znaky (letter-spacing). pdf-lib to neumí, takže
// se kreslí znak po znaku. Používá se jen na krátké popisky.
function prolozene(
  page: PDFPage, text: string, x: number, y: number,
  font: PDFFont, size: number, color: ReturnType<typeof rgb>, mezera: number,
) {
  let kurzor = x;
  for (const znak of text) {
    page.drawText(znak, { x: kurzor, y, font, size, color });
    kurzor += font.widthOfTextAtSize(znak, size) + mezera;
  }
  return kurzor - x - mezera;
}

function sirkaProlozene(text: string, font: PDFFont, size: number, mezera: number) {
  let w = 0;
  for (const znak of text) w += font.widthOfTextAtSize(znak, size) + mezera;
  return w - mezera;
}

export async function poukazPdf(data: PoukazData): Promise<Uint8Array> {
  const kod = String(data.code || "").trim().toUpperCase();

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`Dárkový poukaz ${kod}`);
  doc.setAuthor("Jóga s králíčky");
  doc.setSubject("Dárkový poukaz na lekci jógy s králíčky");
  doc.setProducer("jogaskralicky.cz");

  const fNadpis = await doc.embedFont(bajty(NADPIS_B64), { subset: true });
  const fText = await doc.embedFont(bajty(TEXT_B64), { subset: true });
  const fBold = await doc.embedFont(bajty(TEXT_BOLD_B64), { subset: true });

  const page = doc.addPage([W, H]);

  // --- pozadí -------------------------------------------------------
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: FOREST });
  // Dvě sotva znatelné kružnice, ať plocha není mrtvá. Tmavší odstín
  // téže zelené, takže při tisku načerno nezpůsobí šmouhu.
  page.drawCircle({ x: W - 26, y: -66, size: 140, color: FOREST_DEEP });
  page.drawCircle({ x: 18, y: H + 26, size: 96, color: FOREST_DEEP });

  const M = 34;   // okraj

  // --- hlavička: logo + značka --------------------------------------
  logo(page, M + 17, H - M - 17, 17);
  page.drawText("Jóga s králíčky", {
    x: M + 44, y: H - M - 23, font: fNadpis, size: 15, color: CREAM,
  });

  // Pravý horní roh nese adresu webu, ne zopakovaný nadpis: kdo poukaz
  // dostane vytištěný, potřebuje vědět, kam s ním jít.
  const web = "jogaskralicky.cz";
  const ww = sirkaProlozene(web, fBold, 8, 1.4);
  prolozene(page, web, W - M - ww, H - M - 20, fBold, 8, CLOVER, 1.4);

  // --- levý sloupec: co to je ---------------------------------------
  const L = M;
  page.drawText("Dárkový poukaz", { x: L, y: H - 148, font: fNadpis, size: 34, color: CREAM });
  page.drawText("na jednu lekci jógy s králíčky", {
    x: L, y: H - 172, font: fText, size: 13, color: rgb(0.85, 0.87, 0.83),
  });

  // Mrkvová linka — jediný teplý akcent, stejně jako na webu.
  page.drawRectangle({ x: L, y: H - 192, width: 46, height: 3, color: CARROT });

  // --- levý sloupec: jak se uplatní ---------------------------------
  page.drawText("Jak ho uplatnit", { x: L, y: H - 226, font: fBold, size: 10.5, color: CREAM });
  const kroky = [
    "1.  Na jogaskralicky.cz/rezervace vyberte termín.",
    "2.  Rozklikněte „Mám dárkový poukaz“ a vepište kód.",
    "3.  Odešlete. Nic se neplatí — poukaz je vstupné.",
  ];
  kroky.forEach((r, i) => {
    page.drawText(r, { x: L, y: H - 246 - i * 16, font: fText, size: 10, color: rgb(0.82, 0.84, 0.80) });
  });
  page.drawText("Potvrzení rezervace pak přijde e-mailem i s QR kódem.", {
    x: L, y: H - 246 - 3 * 16 - 8, font: fText, size: 9, color: rgb(0.62, 0.66, 0.60),
  });

  // --- pravý sloupec: karta s kódem ---------------------------------
  const kw = 218, kh = 172;
  const kx = W - M - kw;
  const ky = H - 110 - kh;
  zaoblenyObdelnik(page, kx, ky, kw, kh, 16, { color: CREAM });

  const stred = kx + kw / 2;
  const popisek = "KÓD POUKAZU";
  const pw = sirkaProlozene(popisek, fBold, 7.5, 1.5);
  prolozene(page, popisek, stred - pw / 2, ky + kh - 30, fBold, 7.5, INK_SOFT, 1.5);

  // Kód. Když je delší, písmo se zmenší, ať se vejde na jeden řádek —
  // zalomený kód by se špatně přepisoval.
  let kodSize = 25;
  while (fNadpis.widthOfTextAtSize(kod, kodSize) > kw - 28 && kodSize > 11) kodSize -= 0.5;
  const kodW = fNadpis.widthOfTextAtSize(kod, kodSize);
  page.drawText(kod, { x: stred - kodW / 2, y: ky + kh - 66, font: fNadpis, size: kodSize, color: FOREST });

  page.drawRectangle({ x: kx + 26, y: ky + kh - 86, width: kw - 52, height: 1, color: rgb(0.89, 0.87, 0.83) });

  // Hodnota a platnost pod sebou, popisek vlevo / údaj vpravo.
  const radky: Array<[string, string]> = [];
  if (data.amount) radky.push(["Hodnota", data.amount]);
  // Přesné datum známe jen tehdy, když ho odesílatel poslal. Bez něj se
  // neuvádí nic konkrétního — obecná lhůta je pravdivá vždycky.
  radky.push(data.expires ? ["Platí do", data.expires] : ["Platnost", "12 měsíců od koupě"]);
  radky.push(["Platí na", "kteroukoliv lekci"]);
  radky.forEach(([popis, hodnota], i) => {
    const ry = ky + kh - 108 - i * 19;
    page.drawText(popis, { x: kx + 26, y: ry, font: fText, size: 9.5, color: INK_SOFT });
    const hw = fBold.widthOfTextAtSize(hodnota, 9.5);
    page.drawText(hodnota, { x: kx + kw - 26 - hw, y: ry, font: fBold, size: 9.5, color: INK });
  });

  // --- patička ------------------------------------------------------
  page.drawRectangle({ x: M, y: 46, width: W - 2 * M, height: 1, color: rgb(0.31, 0.37, 0.32) });
  page.drawText("Fit&Fun Studio · Tovární 486/7 · 709 00 Ostrava-Mariánské Hory", {
    x: M, y: 30, font: fText, size: 8.5, color: rgb(0.68, 0.72, 0.66),
  });
  const kontakt = "info@jogaskralicky.cz · +420 603 340 860";
  const kw2 = fText.widthOfTextAtSize(kontakt, 8.5);
  page.drawText(kontakt, { x: W - M - kw2, y: 30, font: fText, size: 8.5, color: rgb(0.68, 0.72, 0.66) });

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
