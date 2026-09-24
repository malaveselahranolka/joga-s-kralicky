// =====================================================================
//  npm run verify — kontrola, kterou musí web projít, než se nasadí
//
//  Proč to vzniklo: repozitář neměl žádný test, lint ani typecheck, takže
//  jediná kontrola před produkcí byl lidský pohled. Přesně proto se stalo,
//  že homepage slibovala 60 minut, časová osa u ní končila na 75. a články
//  psaly o dvanácti lidech — nikdo to nemohl chytit dřív než návštěvník.
//
//  Tohle NENÍ náhrada za testy plateb. Je to levná síť na chyby, které
//  se dají poznat ze samotných souborů: rozbitý JavaScript, nevalidní
//  strukturovaná data, mrtvý odkaz, adresa mimo sitemapu a hlavně
//  provozní údaje, které si navzájem odporují.
//
//  Spuštění:  npm run verify
//  Návratový kód 1 = něco neprošlo. Nasazuj až po nule.
// =====================================================================
import {readFileSync, existsSync} from 'node:fs'
import {join} from 'node:path'
import vm from 'node:vm'
import {parse} from 'node-html-parser'

const root = process.cwd()
const problems = []
const warnings = []
const fail = (where, what) => problems.push(`${where}: ${what}`)
const contentDriftAllowed = process.argv.includes('--allow-content-drift')
const contentProblem = (where, what) => (contentDriftAllowed ? warnings : problems).push(`${where}: ${what}`)

// Veřejné stránky dělíme na ty, které mají soutěžit ve vyhledávání, a
// právní servisní stránky. Ty musí zůstat dostupné lidem, ale nemají
// zabírat místo v sitemapě ani ve výsledcích hledání.
const INDEXABLE_PAGES = [
  'index.html', 'rezervace.html', 'darkovy-poukaz.html',
  'skupinove-lekce.html', 'o-nas.html',
  'joga-pro-deti-ostrava.html', 'joga-se-zviraty.html',
]
const NOINDEX_PAGES = [
  'obchodni-podminky.html', 'zasady-osobnich-udaju.html',
  'asistent.html', 'koupit-poukaz.html',
]
const PUBLIC_PAGES = [...INDEXABLE_PAGES, ...NOINDEX_PAGES]
const ALL_PAGES = [...PUBLIC_PAGES, 'admin.html', 'business.html', 'vstupenka.html', '404.html', '410.html']

const read = (f) => readFileSync(join(root, f), 'utf8')
const normalizujText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()

// ---------------------------------------------------------------------
//  1) INLINE SKRIPTY A STRUKTUROVANÁ DATA SE MUSÍ DÁT PŘEČÍST
//     Celý web běží na inline JavaScriptu. Překlep v něm shodí rezervaci
//     a nikde se to neprojeví dřív než v prohlížeči návštěvníka.
// ---------------------------------------------------------------------
const SCRIPT_RE = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g

for (const page of ALL_PAGES) {
  if (!existsSync(join(root, page))) continue
  const html = read(page)
  const dom = parse(html)
  dom.querySelectorAll('script, style').forEach((element) => element.remove())
  const visibleText = normalizujText(dom.text)
  for (const [, attrs, body] of html.matchAll(SCRIPT_RE)) {
    if (!body.trim()) continue
    if (/ld\+json/i.test(attrs)) {
      try {
        const data = JSON.parse(body)
        const roots = Array.isArray(data) ? data : [data]
        const nodes = roots.flatMap((item) => Array.isArray(item?.['@graph']) ? item['@graph'] : [item])
        for (const node of nodes) {
          const types = Array.isArray(node?.['@type']) ? node['@type'] : [node?.['@type']]
          if (!types.includes('FAQPage')) continue
          for (const question of node.mainEntity || []) {
            const q = normalizujText(question?.name)
            const a = normalizujText(question?.acceptedAnswer?.text)
            if (q && !visibleText.includes(q)) fail(page, `FAQ schema obsahuje neviditelnou otázku „${q}“`)
            if (a && !visibleText.includes(a)) fail(page, `FAQ schema obsahuje odpověď, která není vidět u otázky „${q}“`)
          }
        }
      } catch (e) {
        fail(page, `nevalidní JSON-LD — ${e.message}`)
      }
      continue
    }
    try {
      // zkompiluje, ale NEspustí
      new vm.Script(body, {filename: page})
    } catch (e) {
      fail(page, `nevalidní JavaScript — ${e.message}`)
    }
  }
}

// ---------------------------------------------------------------------
//  2) PROVOZNÍ ÚDAJE MUSÍ SEDĚT VŠUDE STEJNĚ
//     Cena, délka lekce a kapacita se objevují v textu, v meta popiscích,
//     ve strukturovaných datech, v CMS seedu i v generátoru rozvrhu.
//     Stačí je změnit na jednom místě a web začne lhát.
// ---------------------------------------------------------------------
const FAKTA = {delkaMin: 60, kapacita: 10, cenaKc: 499, kraliku: 10, vekDeti: 10, poukazPlatnostMesicu: 6}

// Zakázané formulace = staré hodnoty, které se nesmí vrátit.
// Články o štěňatech smí psát o obecném trhu ("60 až 75 minut"), proto
// hlídáme jen tvrzení o NAŠÍ lekci.
const ZAKAZANE = [
  [/Sedmdesát pět minut/i, 'stará délka lekce (75 min)'],
  [/(?<!60 až )\b75 minut\b/, 'stará délka lekce (75 min)'],
  // Chytá VŠECHNY tvary, ne jen „maximálně dvanácti". Presne tenhle
  // uzky vzor propasl popisek fotky u poukazu, kde stalo „Maximálně
  // dvanáct lidí". Klasická lekce má 10 míst. Dvanáct má jen dětská
  // lekce Děti & králíčci a ta se píše číslicí jako „12 osob"
  // (včetně doprovodu), nikdy slovem a nikdy jako „12 míst".
  [/dvanáct/i, 'stará kapacita (12 osob)'],
  [/max 12 míst/i, 'stará kapacita (12 míst)'],
  [/230\s*(\+|hodnocení|klidných)/i, 'nedoložená statistika (230 hostů/hodnocení)'],
  // Králíků je od 24. 9. 2026 deset (dřív sedm). Hlídáme jen číslovku,
  // která stojí u králíků — „Sedm věcí, na které se lidi ptají" v úvodu
  // FAQ je počet otázek a projít musí.
  [/\b(sedm|sedmi|7)\s+(?:domácí\w*\s+)?králí/i, 'starý počet králíků (7)'],
  [/\bze\s+sedmi\s+má\b/i, 'starý počet králíků (7)'],
  [/(?:děti|dítě)[^.\n]{0,35}(?:od\s*)?7\s*(?:let|\+)/i, 'nesprávný minimální věk dětí (7 let)'],
  [/sobot(?:a|ní)[^.\n]{0,25}(?:od\s*)?9:30/i, 'neaktuální dětský čas (sobota 9:30)'],
]

// Znalosti chatbota a popis termínů pro Google musí říkat totéž co web.
for (const page of [...PUBLIC_PAGES, 'content/obsah.json', 'llms.txt', 'api/_chat-znalosti.js', 'scripts/build.mjs']) {
  if (!existsSync(join(root, page))) continue
  const text = read(page)
  for (const [re, popis] of ZAKAZANE) {
    if (re.test(text)) fail(page, `obsahuje ${popis}`)
  }
}

// cena musí sedět mezi konfigurací pro prohlížeč a viditelným textem
const payCfg = read('payment-config.js')
const entry = Number((payCfg.match(/entryCzk:\s*(\d+)/) || [])[1])
if (entry !== FAKTA.cenaKc) {
  fail('payment-config.js', `entryCzk je ${entry}, čekáme ${FAKTA.cenaKc}`)
}
const voucher = Number((payCfg.match(/voucherCzk:\s*(\d+)/) || [])[1])
if (voucher !== FAKTA.cenaKc) {
  fail('payment-config.js', `voucherCzk je ${voucher}, čekáme ${FAKTA.cenaKc}`)
}

// Dětská lekce Děti & králíčci: zákonný zástupce + 1 dítě 1 090 Kč, každé
// další dítě 500 Kč, nejvýš 4 děti na zástupce, kapacita 12 osob. Cena
// a limity žijí v prohlížeči, v platební funkci i v databázi — musí sedět.
const DETI = {cenaKc: 1090, diteKc: 500, maxDeti: 4, kapacita: 12}
const cisloZ = (text, re) => Number((text.match(re) || [])[1])
if (cisloZ(payCfg, /detiCzk:\s*(\d+)/) !== DETI.cenaKc) fail('payment-config.js', `detiCzk musí být ${DETI.cenaKc}`)
if (cisloZ(payCfg, /detiDiteCzk:\s*(\d+)/) !== DETI.diteKc) fail('payment-config.js', `detiDiteCzk musí být ${DETI.diteKc}`)
if (cisloZ(payCfg, /detiMaxDeti:\s*(\d+)/) !== DETI.maxDeti) fail('payment-config.js', `detiMaxDeti musí být ${DETI.maxDeti}`)
{
  const fn = 'supabase/functions/stripe-create/index.ts'
  const kod = read(fn)
  if (cisloZ(kod, /"PAYMENT_DETI_CZK",\s*"(\d+)"/) !== DETI.cenaKc) fail(fn, `výchozí PAYMENT_DETI_CZK musí být ${DETI.cenaKc}`)
  if (cisloZ(kod, /"PAYMENT_DETI_DITE_CZK",\s*"(\d+)"/) !== DETI.diteKc) fail(fn, `výchozí PAYMENT_DETI_DITE_CZK musí být ${DETI.diteKc}`)
  if (!/dalsiDeti > 3/.test(kod)) fail(fn, `nehlídá nejvýš ${DETI.maxDeti - 1} další děti`)
  const sql = 'supabase/deti-a-kralici.sql'
  if (cisloZ(read(sql), /deti_max\s+constant int := (\d+)/) !== DETI.maxDeti + 1) fail(sql, `deti_max musí být ${DETI.maxDeti + 1} (zástupce + ${DETI.maxDeti} děti)`)
  // Dětský dárkový poukaz stojí stejně jako vstup zástupce s dítětem.
  if (!/id: 'deti'[\s\S]{0,300}cenaCzk:\s*1090/.test(payCfg)) fail('payment-config.js', `dětský poukaz musí stát ${DETI.cenaKc} Kč`)
  if (!/cenaEnv: "PAYMENT_DETI_CZK", cenaVychozi: "1090"/.test(read('supabase/functions/stripe-voucher/index.ts'))) {
    fail('supabase/functions/stripe-voucher/index.ts', `dětský poukaz musí mít výchozí cenu ${DETI.cenaKc} Kč`)
  }
  if (cisloZ(read('supabase/functions/_shared/poukaz-druh.ts'), /"PAYMENT_DETI_CZK",\s*"(\d+)"/) !== DETI.cenaKc) {
    fail('supabase/functions/_shared/poukaz-druh.ts', `dětský poukaz musí mít výchozí cenu ${DETI.cenaKc} Kč`)
  }
  // Dětský poukaz jde koupit i na víc dětí — cena za další dítě a strop
  // dětí musí sedět s rezervací (prohlížeč, stripe-voucher, webhook i DB).
  {
    const sv = read('supabase/functions/stripe-voucher/index.ts')
    if (!new RegExp(`diteEnv: "PAYMENT_DETI_DITE_CZK", diteVychozi: "${DETI.diteKc}", maxDeti: ${DETI.maxDeti}`).test(sv)) {
      fail('supabase/functions/stripe-voucher/index.ts', `dětský poukaz: další dítě ${DETI.diteKc} Kč, nejvýš ${DETI.maxDeti} děti`)
    }
    const pd = read('supabase/functions/_shared/poukaz-druh.ts')
    if (cisloZ(pd, /"PAYMENT_DETI_DITE_CZK",\s*"(\d+)"/) !== DETI.diteKc) fail('supabase/functions/_shared/poukaz-druh.ts', `další dítě na poukazu musí stát ${DETI.diteKc} Kč`)
    if (cisloZ(pd, /POUKAZ_MAX_DETI = (\d+)/) !== DETI.maxDeti) fail('supabase/functions/_shared/poukaz-druh.ts', `POUKAZ_MAX_DETI musí být ${DETI.maxDeti}`)
    const sqlP = 'supabase/poukaz-deti-pocet.sql'
    if (!new RegExp(`deti between 1 and ${DETI.maxDeti}`).test(read(sqlP))) fail(sqlP, `vouchers.deti musí být 1 až ${DETI.maxDeti}`)
  }
  if (!new RegExp(`\\$\\('lf-cap'\\)\\.value = ${DETI.kapacita}; \\$\\('lf-druh'\\)\\.value = 'deti'`).test(read('admin.html'))) {
    fail('admin.html', `šablona Děti & králíčci musí mít kapacitu ${DETI.kapacita}`)
  }
}

// ---------------------------------------------------------------------
//  PLATNOST POUKAZU MUSÍ SEDĚT VE VŠECH TŘECH VRSTVÁCH
//
//  Délka platnosti žije ve třech běhových prostředích, která si ji
//  nemůžou naimportovat jedno od druhého (Deno, Postgres, statické HTML).
//  Každé má proto vlastní deklaraci a tahle kontrola je drží v zákrytu —
//  přesně tohle se totiž dřív rozešlo: funkce zapisovaly 365 dní, výchozí
//  hodnota sloupce v produkci rok a texty slibovaly „12 měsíců", aniž by
//  to šlo poznat odjinud než z produkční databáze.
//
//  Změna platnosti = změnit číslo ve FAKTA výš a pak v místech, na která
//  tahle kontrola ukáže.
// ---------------------------------------------------------------------
const PLATNOST = FAKTA.poukazPlatnostMesicu

const mesicuSlovo = (n) => (n === 1 ? 'měsíc' : (n >= 2 && n <= 4 ? 'měsíce' : 'měsíců'))

// a) prohlížeč
const platnostCfg = Number((payCfg.match(/voucherValidityMonths:\s*(\d+)/) || [])[1])
if (platnostCfg !== PLATNOST) {
  fail('payment-config.js', `voucherValidityMonths je ${platnostCfg || '?'}, čekáme ${PLATNOST}`)
}

// b) Edge funkce (Deno)
const platnostTs = 'supabase/functions/_shared/poukaz-platnost.ts'
if (!existsSync(join(root, platnostTs))) {
  fail(platnostTs, 'soubor chybí — bez něj nemají Edge funkce odkud brát platnost poukazu')
} else {
  const ts = read(platnostTs)
  const mesicu = Number((ts.match(/PLATNOST_MESICU\s*=\s*(\d+)/) || [])[1])
  if (mesicu !== PLATNOST) {
    fail(platnostTs, `PLATNOST_MESICU je ${mesicu || '?'}, čekáme ${PLATNOST}`)
  }
}

// c) databáze
const lifecycle = read('supabase/vouchers-lifecycle.sql')
const sqlInterval = (lifecycle.match(/create or replace function public\.voucher_validity\(\)[\s\S]*?interval '(\d+) months?'/) || [])[1]
if (Number(sqlInterval) !== PLATNOST) {
  fail('supabase/vouchers-lifecycle.sql', `voucher_validity() vrací ${sqlInterval || '?'} měsíců, čekáme ${PLATNOST}`)
}

// Vystavení poukazu z rezervace si délku nesmí opisovat zvlášť — musí
// volat voucher_validity(), jinak se obě SQL místa zase rozejdou.
const zRezervace = read('supabase/rezervace-na-poukaz.sql')
if (/vstupenka_expires[^;]*interval '/.test(zRezervace)) {
  fail('supabase/rezervace-na-poukaz.sql', 'platnost poukazu je opsaná natvrdo — volej public.voucher_validity()')
}

// Edge funkce taky ne: dřív tam bylo 365 * 24 * 60 * 60 * 1000.
for (const fn of ['supabase/functions/stripe-confirm/index.ts', 'supabase/functions/stripe-webhook/index.ts']) {
  const kod = read(fn)
  if (/expires_?At\s*=\s*new Date\(Date\.now\(\)\s*\+/.test(kod)) {
    fail(fn, 'platnost poukazu se počítá na místě — použij platnostDoISO() z _shared/poukaz-platnost.ts')
  }
}

// d) texty, které platnost slibují návštěvníkovi
const SLIB_PLATNOSTI = ['index.html', 'darkovy-poukaz.html', 'obchodni-podminky.html', 'llms.txt', 'api/_chat-znalosti.js']
const spravnyText = `${PLATNOST} ${mesicuSlovo(PLATNOST)}`
for (const soubor of SLIB_PLATNOSTI) {
  if (!existsSync(join(root, soubor))) continue
  const text = read(soubor)
  for (const m of text.matchAll(/(\d+)\s+měsíc[ůe]?/g)) {
    if (Number(m[1]) !== PLATNOST) {
      contentProblem(soubor, `slibuje „${m[0]}", ale poukaz platí ${spravnyText}`)
    }
  }
  // „platí rok" je stará formulace téhož slibu
  const rokem = text.match(/plat[ní][^.<]{0,24}\brok\b/i)
  if (rokem) {
    contentProblem(soubor, `platnost poukazu popsaná v rocích („${rokem[0].trim()}") — má být ${spravnyText}`)
  }
}

// generátor rozvrhu v adminu nesmí vyrábět lekce, které web neprodává
for (const [, dur, cap] of read('admin.html').matchAll(/dur:\s*(\d+),\s*cap:\s*(\d+)/g)) {
  if (Number(dur) !== FAKTA.delkaMin) fail('admin.html', `generátor rozvrhu dělá lekci na ${dur} min, web slibuje ${FAKTA.delkaMin}`)
  if (Number(cap) !== FAKTA.kapacita) fail('admin.html', `generátor rozvrhu dělá kapacitu ${cap}, web slibuje ${FAKTA.kapacita}`)
}

// časová osa lekce na homepage musí končit přesně na délce lekce
const osa = [...read('index.html').matchAll(/<b>(\d+)–(\d+) min<\/b>/g)].map((m) => Number(m[2]))
for (const konec of osa) {
  if (konec > FAKTA.delkaMin) fail('index.html', `časová osa lekce jde do ${konec} min, lekce trvá ${FAKTA.delkaMin}`)
}

// ---------------------------------------------------------------------
//  3) SITEMAPA A SKUTEČNÉ SOUBORY
// ---------------------------------------------------------------------
const ORIGIN = 'https://www.jogaskralicky.cz'
const sitemap = read('sitemap.xml')
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])

for (const loc of locs) {
  const rel = loc.replace(ORIGIN, '').replace(/^\//, '') || 'index.html'
  if (!existsSync(join(root, rel))) fail('sitemap.xml', `${loc} neodpovídá žádnému souboru`)
}
for (const page of INDEXABLE_PAGES) {
  const expected = page === 'index.html' ? `${ORIGIN}/` : `${ORIGIN}/${page}`
  if (!locs.includes(expected)) fail('sitemap.xml', `chybí ${expected}`)
}
for (const page of NOINDEX_PAGES) {
  const forbidden = `${ORIGIN}/${page}`
  if (locs.includes(forbidden)) fail('sitemap.xml', `obsahuje noindex stránku ${forbidden}`)
}
if (new Set(locs).size !== locs.length) fail('sitemap.xml', 'obsahuje duplicitní adresu')
for (const loc of locs) {
  if (!loc.startsWith(`${ORIGIN}/`)) fail('sitemap.xml', `cizí nebo nekanonický host: ${loc}`)
}

// ---------------------------------------------------------------------
//  4) KANONICKÁ ADRESA NA KAŽDÉ VEŘEJNÉ STRÁNCE
// ---------------------------------------------------------------------
for (const page of PUBLIC_PAGES) {
  const html = read(page)
  const canonical = (html.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/) || [])[1]
  const expected = page === 'index.html' ? `${ORIGIN}/` : `${ORIGIN}/${page}`
  if (!canonical) fail(page, 'chybí canonical')
  else if (canonical !== expected) fail(page, `canonical je ${canonical}, čekáme ${expected}`)
}

// ---------------------------------------------------------------------
//  4b) INDEXACE A ZÁKLADNÍ ON-PAGE SEO
// ---------------------------------------------------------------------
const titleOwners = new Map()
const descriptionOwners = new Map()

for (const page of PUBLIC_PAGES) {
  const html = read(page)
  const robots = (html.match(/<meta[^>]+name="robots"[^>]+content="([^"]+)"/i) || [])[1] || ''
  const shouldIndex = INDEXABLE_PAGES.includes(page)
  if (shouldIndex && !/(?:^|,)\s*index(?:\s*,|$)/i.test(robots)) {
    fail(page, 'má být indexovatelná, ale meta robots neobsahuje index')
  }
  if (!shouldIndex && !/noindex/i.test(robots)) {
    fail(page, 'servisní stránka musí mít noindex, follow')
  }

  if (!shouldIndex) continue
  const titles = [...html.matchAll(/<title>([^<]+)<\/title>/gi)].map((m) => m[1].trim())
  const descriptions = [...html.matchAll(/<meta[^>]+name="description"[^>]+content="([^"]+)"/gi)].map((m) => m[1].trim())
  const h1s = [...html.matchAll(/<h1(?:\s[^>]*)?>([\s\S]*?)<\/h1>/gi)]
  if (titles.length !== 1) fail(page, `má ${titles.length} elementů <title>, očekáváme právě jeden`)
  if (descriptions.length !== 1) fail(page, `má ${descriptions.length} meta description, očekáváme právě jeden`)
  if (h1s.length !== 1) fail(page, `má ${h1s.length} nadpisů H1, očekáváme právě jeden`)

  const title = titles[0]
  const description = descriptions[0]
  if (title) {
    if (titleOwners.has(title)) fail(page, `duplikuje title stránky ${titleOwners.get(title)}`)
    else titleOwners.set(title, page)
  }
  if (description) {
    if (descriptionOwners.has(description)) fail(page, `duplikuje meta description stránky ${descriptionOwners.get(description)}`)
    else descriptionOwners.set(description, page)
  }
}

const homeTitle = (read('index.html').match(/<title>([^<]+)<\/title>/i) || [])[1] || ''
if (!homeTitle.includes('Jóga se zvířaty Ostrava')) {
  contentProblem('index.html', 'homepage nevlastní hlavní lokální dotaz „Jóga se zvířaty Ostrava“')
}
if (!homeTitle.toLocaleLowerCase('cs-CZ').includes('jóga s králíčky')) {
  contentProblem('index.html', 'title homepage neobsahuje značku „Jóga s králíčky“')
}
const homeHtml = read('index.html')
const homeH1 = (homeHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]?.replace(/<[^>]+>/g, '') || ''
if (!/Jóga s králíčky v Ostravě/i.test(homeH1)) {
  contentProblem('index.html', 'H1 homepage neobsahuje značku a lokalitu „Jóga s králíčky v Ostravě“')
}
for (const varianta of ['jóga se zvířátky', 'bunny yoga', 'pet yoga', 'králičí jóga']) {
  if (!homeHtml.toLocaleLowerCase('cs-CZ').includes(varianta.toLocaleLowerCase('cs-CZ'))) {
    contentProblem('index.html', `homepage neobsahuje přirozenou variantu dotazu „${varianta}“`)
  }
}

// Informační průvodce má odpovídat na obecný dotaz. Kdyby se mu do
// titulku nebo H1 vrátila Ostrava (v libovolném pádě), znovu by soutěžil
// s homepage o stejný lokální záměr. Nejde o obsah z administrace, proto
// je to tvrdá strukturální kontrola i při produkčním buildu.
const guideHtml = read('joga-se-zviraty.html')
const guideTitle = (guideHtml.match(/<title>([^<]+)<\/title>/i) || [])[1] || ''
const guideH1 = (guideHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]?.replace(/<[^>]+>/g, '') || ''
if (/ostrav/i.test(guideTitle)) {
  fail('joga-se-zviraty.html', 'title informačního průvodce nesmí obsahovat „Ostrava“ ani její skloňovaný tvar')
}
if (/ostrav/i.test(guideH1)) {
  fail('joga-se-zviraty.html', 'H1 informačního průvodce nesmí obsahovat „Ostrava“ ani její skloňovaný tvar')
}

// Studio nemá pevnou otevírací dobu; návštěvy probíhají jen podle
// vypsaných lekcí. Smyšlené hodiny ve strukturovaných datech by byly
// horší než jejich absence.
if (/"openingHoursSpecification"\s*:/.test(homeHtml)) {
  fail('index.html', 'LocalBusiness nesmí uvádět openingHoursSpecification; studio funguje podle vypsaných termínů')
}

// Veřejné firemní profily byly ověřené proti skutečným detailům firmy.
// Když někdo při úpravě JSON-LD jeden smaže nebo nahradí placeholderem,
// ztratí se explicitní propojení webu s lokálními zápisy.
const PROFILY = [
  'https://maps.app.goo.gl/Qm7YAJJRsvKyVLaF6',
  'https://mapy.com/en/zakladni?source=firm&id=14064344&x=18.2538681&y=49.8264650&z=17',
  'https://www.firmy.cz/detail/14064344-joga-s-kralicky-ostrava-marianske-hory.html',
]
try {
  const schemaBodies = [...homeHtml.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)]
  const schemaNodes = schemaBodies.flatMap((match) => {
    const root = JSON.parse(match[1])
    return Array.isArray(root?.['@graph']) ? root['@graph'] : [root]
  })
  const firma = schemaNodes.find((node) => {
    const types = Array.isArray(node?.['@type']) ? node['@type'] : [node?.['@type']]
    return types.includes('LocalBusiness')
  })
  if (!firma) {
    fail('index.html', 'JSON-LD neobsahuje LocalBusiness')
  } else {
    for (const profil of PROFILY) {
      if (!firma.sameAs?.includes(profil)) fail('index.html', `LocalBusiness.sameAs neobsahuje ověřený profil ${profil}`)
    }
    if (firma.hasMap !== PROFILY[0]) fail('index.html', 'LocalBusiness.hasMap nevede na ověřený Google Maps profil')
  }
} catch (error) {
  fail('index.html', `lokální profily v JSON-LD nejdou ověřit — ${error.message}`)
}

// Doprava se z homepage přestěhovala na stránku O nás (sekce Kde nás
// najdete). Ověřené údaje o MHD a parkování tam musí zůstat celé.
const oNasHtml = read('o-nas.html')
for (const fakt of ['Daliborova', '3, 4, 8, 18 a 19', '100 metrů', 'dvě minuty', 'bezplatné parkování']) {
  if (!oNasHtml.includes(fakt)) fail('o-nas.html', `sekce dopravy neobsahuje ověřený údaj „${fakt}“`)
}

let obsah = {}
try {
  if (!existsSync(join(root, 'content/obsah.json'))) throw new Error('soubor chybí')
  const parsed = JSON.parse(read('content/obsah.json'))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('kořen musí být objekt')
  obsah = parsed
} catch (error) {
  contentProblem('content/obsah.json', `obsah nejde použít (${error.message}); build použije bezpečný obsah z index.html`)
}
if (obsah.pageTitle !== homeTitle) {
  contentProblem('content/obsah.json', 'pageTitle se liší od title v index.html; build SEO titulek přepíše obsahem ze správy')
}
if (!String(obsah.pageDescription || '').toLocaleLowerCase('cs-CZ').includes('jóga se zvířaty v ostravě')) {
  contentProblem('content/obsah.json', 'pageDescription neobsahuje hlavní lokální dotaz „jóga se zvířaty v Ostravě“')
}
if (!/pravidelně v sobotu 10:30/i.test(String(obsah.contactSchedule || ''))) {
  contentProblem('content/obsah.json', 'contactSchedule neuvádí potvrzený pravidelný čas v sobotu 10:30')
}
const detskaLekce = (obsah.lessons || []).find((lekce) => /děti/i.test(lekce.title || ''))
if (!detskaLekce || !new RegExp(`od ${FAKTA.vekDeti} let`, 'i').test(detskaLekce.tag || '')) {
  contentProblem('content/obsah.json', `dětská lekce musí uvádět věk od ${FAKTA.vekDeti} let`)
}
if (detskaLekce && !/1\s?090\s*Kč/.test(String(detskaLekce.price || ''))) {
  contentProblem('content/obsah.json', `dětská lekce musí mít cenu ${DETI.cenaKc} Kč (zástupce + dítě)`)
}
if (detskaLekce && !/500\s*Kč/.test(String(detskaLekce.priceNote || ''))) {
  contentProblem('content/obsah.json', `u dětské lekce musí být vidět, že každé další dítě stojí ${DETI.diteKc} Kč`)
}

// ---------------------------------------------------------------------
//  5) ODKAZY NIKAM
//     Vnitřní odkazy na .html i kotvy uvnitř téže stránky.
// ---------------------------------------------------------------------
for (const page of ALL_PAGES) {
  if (!existsSync(join(root, page))) continue
  const html = read(page)
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))
  for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
    if (/^(https?:|mailto:|tel:|#$|data:)/.test(href)) continue
    if (href.startsWith('#')) {
      if (!ids.has(href.slice(1))) fail(page, `kotva ${href} nikam nevede`)
      continue
    }
    // ?parametry (např. koupit-poukaz.html?druh=deti) nejsou součást cesty
    const file = href.split('#')[0].split('?')[0]
    if (!file || file.startsWith('/')) continue          // kořenové cesty řeší Vercel
    // href skládaný v JavaScriptu (href="' + fn(x) + '") není cesta k souboru
    if (/[+'`${}]/.test(file)) continue
    if (!existsSync(join(root, file))) fail(page, `odkaz na ${file}, který neexistuje`)
  }
}

// ---------------------------------------------------------------------
//  6) ROBOTS — každá jmenovitá skupina musí mít vlastní zákazy
//     Robot se řídí jen tou nejpřesnější skupinou; pravidla z `*` pro něj
//     neplatí. Skupina s pouhým `Allow: /` tedy pouští i admin.
// ---------------------------------------------------------------------
const robots = read('robots.txt')
const ZAKAZ = ['/admin.html', '/vstupenka.html', '/api/']
const skupiny = robots.split(/\n(?=User-agent:)/i).filter((b) => /^User-agent:/i.test(b.trim()))
for (const blok of skupiny) {
  const ua = (blok.match(/User-agent:\s*(\S+)/i) || [])[1]
  for (const cesta of ZAKAZ) {
    if (!blok.includes(`Disallow: ${cesta}`)) fail('robots.txt', `skupina ${ua} nezakazuje ${cesta}`)
  }
}

// ---------------------------------------------------------------------
//  8) E-MAILY SE MUSÍ POSÍLAT ZE SERVERU
//     Odesílání z prohlížeče bylo příčinou zaplacených objednávek bez
//     vstupenky. Fronta i její volání musí zůstat na místě.
// ---------------------------------------------------------------------
for (const f of ['supabase/functions/_shared/email.ts',
                 'supabase/functions/email-dispatch/index.ts',
                 'supabase/email-outbox.sql',
                 'supabase/vouchers-lifecycle.sql']) {
  if (!existsSync(join(root, f))) fail(f, 'soubor chybí — bez něj se e-maily a poukazy rozbijí')
}
for (const f of ['supabase/functions/stripe-webhook/index.ts',
                 'supabase/functions/stripe-confirm/index.ts']) {
  if (!read(f).includes('enqueue(')) fail(f, 'nezařazuje e-mail do fronty')
}

// ---------------------------------------------------------------------
//  9) OBRÁZKY BEZ POPISU
//     Prázdný alt="" je v pořádku u dekorace, chybějící atribut ne.
// ---------------------------------------------------------------------
for (const page of PUBLIC_PAGES) {
  for (const [tag] of read(page).matchAll(/<img\b[^>]*>/g)) {
    if (!/\salt=/.test(tag)) fail(page, `<img> bez atributu alt: ${tag.slice(0, 90)}`)
  }
}

// ---------------------------------------------------------------------
//  10) ČAS LEKCE SE NESMÍ BRÁT Z PÁSMA PROHLÍŽEČE
//
//  Lekce se koná v Ostravě, takže její čas je pražský bez ohledu na to,
//  odkud se na web někdo dívá. Dřív se formátoval přes dt.getHours(),
//  což vrací hodinu podle počítače návštěvníka — prohlížeč v pásmu
//  Europe/London ukazoval „09:30" u lekce, která začíná v 10:30. Server
//  přitom posílá v e-mailu tvrdě pražský čas, takže hostovi chodily dva
//  různé časy pro tutéž rezervaci.
//
//  Převod žije jedině v datum.js (globální CAS). Tahle kontrola hlídá,
//  aby se místní čas nevrátil zadními vrátky.
//
//  Výjimka: vstupenka.html zobrazuje lhůtu na zaplacení („držíme do…“),
//  a ta je pro hosta záměrně v jeho vlastním čase. Je označená komentářem.
// ---------------------------------------------------------------------
const CAS_STRANKY = ['rezervace.html', 'vstupenka.html', 'admin.html']
const CAS_ZAKAZANE = /\.(getHours|getMinutes|getDate|getMonth|getFullYear|getDay)\(\)|toDateString\(\)/

for (const page of CAS_STRANKY) {
  if (!existsSync(join(root, page))) continue
  const html = read(page)
  if (!/src="datum\.js/.test(html)) fail(page, 'nenačítá datum.js, ale pracuje s časem lekce')

  html.split(/\r?\n/).forEach((radek, i) => {
    if (!CAS_ZAKAZANE.test(radek)) return
    if (/^\s*(\/\/|\*|<!--)/.test(radek)) return          // komentář
    if (/ZÁMĚRNĚ v místním čase|holdTxt/.test(radek)) return
    fail(page, `řádek ${i + 1}: čas z pásma prohlížeče — použij CAS z datum.js\n      ${radek.trim().slice(0, 96)}`)
  })
}

// datum.js musí zůstat v seznamu souborů, které build kopíruje ven —
// jinak by se stránky na produkci načetly bez něj a spadly na CAS undefined.
if (!read('scripts/build.mjs').includes("'datum.js'")) {
  fail('scripts/build.mjs', 'datum.js chybí v seznamu kopírovaných souborů')
}

// ---------------------------------------------------------------------
//  11) VERCEL.JSON MUSÍ PROJÍT JEJICH SCHÉMATEM
//
//  Vercel konfiguraci validuje přísně a neznámý klíč odmítne JEŠTĚ PŘED
//  buildem — nasazení skončí chybou bez jediného řádku v logu, takže se
//  špatně hledá. Přesně to se stalo, když sem někdo (já) přidal do routy
//  klíč "//" jako komentář:
//
//      The `vercel.json` schema validation failed with the following
//      message: `routes[1]` should NOT have additional property `//`
//
//  JSON komentáře nemá a Vercel je nesnese ani jako klíč. Vysvětlivky
//  proto patří sem do skriptu nebo do commitu, ne do konfigurace.
//
//  Kontrolujeme jen `routes`, protože tam se sahá nejčastěji. Seznam je
//  z dokumentace Vercelu k project configuration.
// ---------------------------------------------------------------------
const ROUTE_KLICE = new Set([
  'src', 'dest', 'headers', 'methods', 'continue', 'caseSensitive',
  'check', 'status', 'has', 'missing', 'locale', 'middlewarePath', 'handle',
])

try {
  const vercel = JSON.parse(read('vercel.json'))
  for (const [i, route] of (vercel.routes || []).entries()) {
    for (const klic of Object.keys(route)) {
      if (!ROUTE_KLICE.has(klic)) {
        fail('vercel.json', `routes[${i}] má klíč "${klic}", který Vercel neuznává — nasazení spadne ještě před buildem`)
      }
    }
  }
  // Přesměrování na kanonickou doménu nesmí chytat samo sebe, jinak
  // vznikne nekonečná smyčka a web přestane být dostupný.
  for (const [i, route] of (vercel.routes || []).entries()) {
    const cil = route.headers?.Location || ''
    if (!cil.includes('www.jogaskralicky.cz')) continue
    const hosty = (route.has || []).filter((h) => h.type === 'host')
    if (!hosty.length) {
      fail('vercel.json', `routes[${i}] přesměrovává na kanonickou doménu bez podmínky na host — hrozí smyčka`)
    } else if (hosty.some((h) => new RegExp(h.value).test('www.jogaskralicky.cz'))) {
      fail('vercel.json', `routes[${i}] přesměrovává na www.jogaskralicky.cz, ale jeho podmínka na host sedí i na www — smyčka`)
    }
  }

  const localRedirect = (path) => {
    for (const route of vercel.routes || []) {
      if (route.has?.length || !route.headers?.Location || ![301, 302, 307, 308].includes(route.status)) continue
      try {
        if (new RegExp(`^(?:${route.src})$`).test(path)) return route.headers.Location
      } catch (e) {
        fail('vercel.json', `neplatný regulární výraz routy ${route.src}: ${e.message}`)
      }
    }
    return null
  }

  const requiredRedirects = new Map([
    ['/kontakt', '/#kontakt'],
    ['/kontakt.html', '/#kontakt'],
    ['/joga-se-zviraty', '/joga-se-zviraty.html'],
    ['/joga-pro-deti-ostrava', '/joga-pro-deti-ostrava.html'],
    ['/darkovy-poukaz', '/darkovy-poukaz.html'],
    ['/skupinove-lekce', '/skupinove-lekce.html'],
    ['/o-nas', '/o-nas.html'],
    ['/rezervace', '/rezervace.html'],
  ])
  for (const [path, target] of requiredRedirects) {
    const actual = localRedirect(path)
    if (actual !== target) fail('vercel.json', `${path} se přesměrovává na ${actual || 'nic'}, čekáme ${target}`)
  }

  for (const path of ['/joga-se-stenaty', '/joga-se-stenaty.html']) {
    const route = (vercel.routes || []).find((candidate) => {
      if (candidate.has?.length || candidate.status !== 410) return false
      try { return new RegExp(`^(?:${candidate.src})$`).test(path) } catch (_e) { return false }
    })
    if (!route) fail('vercel.json', `${path} musí vracet stav 410 Gone`)
  }
} catch (e) {
  fail('vercel.json', `nejde přečíst jako JSON — ${e.message}`)
}

// Stránka o službě, kterou nenabízíme, se nesmí vrátit do veřejného webu.
for (const retired of ['joga-se-stenaty.html']) {
  if (existsSync(join(root, retired))) {
    fail(retired, 'zrušená stránka se vrátila; ponech jen redirect ve vercel.json')
  }
  if (read('scripts/build.mjs').includes(`'${retired}'`)) {
    fail('scripts/build.mjs', `znovu kopíruje zrušenou stránku ${retired}`)
  }
}
for (const page of PUBLIC_PAGES) {
  if (/href="\/?joga-se-stenaty(?:\.html)?(?:[#?"])/i.test(read(page))) {
    fail(page, 'interně odkazuje na zrušenou stránku o józe se štěňaty')
  }
}

// ---------------------------------------------------------------------
//  VÝSLEDEK
// ---------------------------------------------------------------------
if (warnings.length) {
  console.warn(`\n⚠ ${warnings.length} obsahové ${warnings.length === 1 ? 'upozornění' : 'upozornění'} (nasazení pokračuje):\n`)
  for (const warning of warnings) console.warn('  • ' + warning)
  console.warn('')
}
if (problems.length) {
  console.error(`\n✗ ${problems.length} ${problems.length === 1 ? 'problém' : problems.length < 5 ? 'problémy' : 'problémů'}:\n`)
  for (const p of problems) console.error('  • ' + p)
  console.error('')
  process.exit(1)
}
console.log('✓ Kontrola prošla. Skripty, fakta, sitemapa, odkazy i robots sedí.')
