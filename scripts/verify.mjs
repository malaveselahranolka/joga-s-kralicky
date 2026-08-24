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

const root = process.cwd()
const problems = []
const fail = (where, what) => problems.push(`${where}: ${what}`)

// Veřejné stránky. admin.html a vstupenka.html sem nepatří — jsou
// schválně mimo sitemapu a mimo vyhledávače.
const PUBLIC_PAGES = [
  'index.html', 'rezervace.html', 'darkovy-poukaz.html',
  'joga-se-zviraty.html', 'joga-se-stenaty.html', 'joga-pro-deti-ostrava.html',
  'obchodni-podminky.html', 'zasady-osobnich-udaju.html',
]
const ALL_PAGES = [...PUBLIC_PAGES, 'admin.html', 'vstupenka.html', '404.html']

const read = (f) => readFileSync(join(root, f), 'utf8')

// ---------------------------------------------------------------------
//  1) INLINE SKRIPTY A STRUKTUROVANÁ DATA SE MUSÍ DÁT PŘEČÍST
//     Celý web běží na inline JavaScriptu. Překlep v něm shodí rezervaci
//     a nikde se to neprojeví dřív než v prohlížeči návštěvníka.
// ---------------------------------------------------------------------
const SCRIPT_RE = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g

for (const page of ALL_PAGES) {
  if (!existsSync(join(root, page))) continue
  const html = read(page)
  for (const [, attrs, body] of html.matchAll(SCRIPT_RE)) {
    if (!body.trim()) continue
    if (/ld\+json/i.test(attrs)) {
      try {
        JSON.parse(body)
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
const FAKTA = {delkaMin: 60, kapacita: 10, cenaKc: 499, kraliku: 7}

// Zakázané formulace = staré hodnoty, které se nesmí vrátit.
// Články o štěňatech smí psát o obecném trhu ("60 až 75 minut"), proto
// hlídáme jen tvrzení o NAŠÍ lekci.
const ZAKAZANE = [
  [/Sedmdesát pět minut/i, 'stará délka lekce (75 min)'],
  [/(?<!60 až )\b75 minut\b/, 'stará délka lekce (75 min)'],
  // Chytá VŠECHNY tvary, ne jen „maximálně dvanácti". Presne tenhle
  // uzky vzor propasl popisek fotky u poukazu, kde stalo „Maximálně
  // dvanáct lidí" — o dvanácti u nás nikdy nemluvíme legitimně.
  [/dvanáct/i, 'stará kapacita (12 osob)'],
  [/max 12 míst/i, 'stará kapacita (12 míst)'],
  [/230\s*(\+|hodnocení|klidných)/i, 'nedoložená statistika (230 hostů/hodnocení)'],
  // Kapacita je deset MÍST, králíků je ale sedm. Obě desítky se v textu
  // potkávají, tak hlídáme jen tu, která patří ke králíkům — „deset lidí",
  // „deset míst" i „o deset minut dřív" musí projít.
  [/\b(deset|deseti|10)\s+králí/i, 'starý počet králíků (10)'],
  [/\bz\s+desítky\b/i, 'starý počet králíků (10)'],
]

for (const page of [...PUBLIC_PAGES, 'scripts/seed-content.mjs', 'llms.txt']) {
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
for (const page of PUBLIC_PAGES) {
  const expected = page === 'index.html' ? `${ORIGIN}/` : `${ORIGIN}/${page}`
  if (!locs.includes(expected)) fail('sitemap.xml', `chybí ${expected}`)
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
    const [file] = href.split('#')
    if (!file || file.startsWith('/')) continue          // kořenové cesty řeší Vercel
    // href skládaný v JavaScriptu (href="' + fn(x) + '") není cesta k souboru
    if (/[+'`${}]/.test(file)) continue
    // studio/ vzniká až při buildu (sanity build), v repozitáři není
    if (file.replace(/\/$/, '') === 'studio') continue
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
//  7) VIZUÁLNÍ EDITOR NESMÍ ZPÁTKY DO VEŘEJNÉHO BALÍKU
//     @sanity/visual-editing váží přes 800 kB a potřebuje ho jedině
//     Studio. Když se sem vrátí napevno psaný import, stahuje si ho
//     zase každý návštěvník — a nikdo si toho nevšimne, protože web
//     funguje dál, jen pomalu.
// ---------------------------------------------------------------------
const cms = read('src/cms.js')
if (/^\s*import\s[^\n]*@sanity\/visual-editing/m.test(cms)) {
  fail('src/cms.js', 'statický import @sanity/visual-editing — musí zůstat dynamický (await import(...))')
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
//  VÝSLEDEK
// ---------------------------------------------------------------------
if (problems.length) {
  console.error(`\n✗ ${problems.length} ${problems.length === 1 ? 'problém' : problems.length < 5 ? 'problémy' : 'problémů'}:\n`)
  for (const p of problems) console.error('  • ' + p)
  console.error('')
  process.exit(1)
}
console.log('✓ Kontrola prošla. Skripty, fakta, sitemapa, odkazy i robots sedí.')
