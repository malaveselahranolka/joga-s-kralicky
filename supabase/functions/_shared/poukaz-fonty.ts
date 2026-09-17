// =====================================================================
//  Fonty pro PDF dárkového poukazu
//
//  Jsou to ČTYŘI STATICKÉ ŘEZY vyrobené ze stejných variabilních fontů,
//  jaké má web (assets/fonts/*.woff2, licence OFL — assets/fonts/OFL.txt).
//  Názvy odpovídají rodině a váze, ať je z volání poznat, co se sází:
//
//    schibsted-600   nadpis „Dárkový poukaz"
//    schibsted-700   jméno studia, kód poukazu, platnost
//    hanken-400      perex a kontakty
//    hanken-600      popisky v kartě
//
//  PROČ SE STAHUJÍ, A NE ZAPÉKAJÍ DO KÓDU
//  Do balíčku edge funkce binární soubor nepřiložíš, takže by font musel
//  být v kódu jako base64 — skoro 100 kB zdrojáku (60 kB i po gzipu),
//  který nejde přečíst ani zkontrolovat v code review a při každé ruční
//  manipulaci hrozí, že se jeden znak rozbije a poukaz se tiše přestane
//  generovat. Jako soubory v assets/ je naopak vidět, versionují se
//  normálně a Vercel je servíruje s dlouhou cache.
//
//  Stahuje se JEDNOU za život isolátu a pak se drží v paměti, takže
//  běžný provoz do webu netrefí vůbec. Když se stažení nepovede, volající
//  (poukazPriloha v email.ts) pošle e-mail BEZ přílohy — kód poukazu je
//  v těle zprávy a ten je to podstatné.
//
//  PROČ JSOU SLITÉ
//  Web má každou rodinu rozdělenou na „latin" a „latin-ext" a ANI JEDEN
//  soubor sám o sobě češtinu nepokryje: latin umí á é í ó ú ý, latin-ext
//  umí č ď ě ň ř š ť ů ž. Tyhle jsou slité z obou půlek a oříznuté na
//  podmnožinu znaků (ASCII + celá česká abeceda + interpunkce). Postup,
//  jak je vyrobit znovu, je v README — na chybějícím glyfu pdf-lib spadne.
// =====================================================================

const ZAKLAD = (Deno.env.get("SITE_URL") ?? "https://www.jogaskralicky.cz/").replace(/\/$/, "");

export type Rez = "schibsted-600" | "schibsted-700" | "hanken-400" | "hanken-600";

// Cache na úrovni modulu: přežije jednotlivá volání v témže isolátu.
// Ukládá se slib, ne hotové bajty — dvě souběžná odeslání tak stahují
// jednou, ne dvakrát.
const cache = new Map<Rez, Promise<Uint8Array>>();

async function stahni(rez: Rez): Promise<Uint8Array> {
  const url = `${ZAKLAD}/assets/fonts/pdf/${rez}.ttf`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`font ${rez}: HTTP ${res.status}`);
  const bajty = new Uint8Array(await res.arrayBuffer());
  // Hrubá pojistka proti tomu, že místo fontu dorazí chybová stránka:
  // TTF/OTF začíná 0x00010000 nebo „OTTO".
  const magie = bajty[0] === 0x00 && bajty[1] === 0x01 && bajty[2] === 0x00 && bajty[3] === 0x00;
  const otto = bajty[0] === 0x4F && bajty[1] === 0x54 && bajty[2] === 0x54 && bajty[3] === 0x4F;
  if (bajty.length < 4000 || (!magie && !otto)) {
    throw new Error(`font ${rez}: nevypadá jako font (${bajty.length} B)`);
  }
  return bajty;
}

export function font(rez: Rez): Promise<Uint8Array> {
  let p = cache.get(rez);
  if (!p) {
    p = stahni(rez).catch((e) => {
      // Neúspěch se nesmí zacementovat do cache, ať to příští odeslání
      // zkusí znovu.
      cache.delete(rez);
      throw e;
    });
    cache.set(rez, p);
  }
  return p;
}
