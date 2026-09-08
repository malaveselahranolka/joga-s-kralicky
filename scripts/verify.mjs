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
const fail = (where, what) => problems.push(`${where}: ${what}`)

// Veřejné stránky dělíme na ty, které mají soutěžit ve vyhledávání, a
// právní servisní stránky. Ty musí zůstat dostupné lidem, ale nemají
// zabírat místo v sitemapě ani ve výsledcích hledání.
const INDEXABLE_PAGES = [
  'index.html', 'rezervace.html', 'darkovy-poukaz.html',
  'joga-se-zviraty.html', 'joga-pro-deti-ostrava.html',
]
const NOINDEX_PAGES = [
  'obchodni-podminky.html', 'zasady-osobnich-udaju.html',
]
const PUBLIC_PAGES = [...INDEXABLE_PAGES, ...NOINDEX_PAGES]
const ALL_PAGES = [...PUBLIC_PAGES, 'admin.html', 'vstupenka.html', '404.html']

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
const FAKTA = {delkaMin: 60, kapacita: 10, cenaKc: 499, kraliku: 7, vekDeti: 5}

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
  [/(?:děti|dítě)[^.\n]{0,35}(?:od\s*)?7\s*(?:let|\+)/i, 'nesprávný minimální věk dětí (7 let)'],
  [/sobot(?:a|ní)[^.\n]{0,25}(?:od\s*)?9:30/i, 'neaktuální dětský čas (sobota 9:30)'],
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
if (!homeTitle.includes('Jóga s králíčky Ostrava')) {
  fail('index.html', 'homepage nevlastní značkový dotaz „Jóga s králíčky Ostrava“')
}
const animalHtml = read('joga-se-zviraty.html')
const animalTitle = (animalHtml.match(/<title>([^<]+)<\/title>/i) || [])[1] || ''
const animalH1 = (animalHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]?.replace(/<[^>]+>/g, '') || ''
if (!animalTitle.includes('Jóga se zvířaty v Ostravě')) {
  fail('joga-se-zviraty.html', 'title neobsahuje hlavní lokální dotaz „Jóga se zvířaty v Ostravě“')
}
if (!animalH1.includes('Jóga se zvířaty v Ostravě')) {
  fail('joga-se-zviraty.html', 'H1 neobsahuje hlavní lokální dotaz „Jóga se zvířaty v Ostravě“')
}
for (const varianta of ['jóga se zvířátky Ostrava', 'bunny yoga Ostrava', 'pet yoga Ostrava', 'králičí jóga']) {
  if (!animalHtml.toLocaleLowerCase('cs-CZ').includes(varianta.toLocaleLowerCase('cs-CZ'))) {
    fail('joga-se-zviraty.html', `chybí přirozená varianta dotazu „${varianta}“`)
  }
}

const obsah = JSON.parse(read('content/obsah.json'))
const detskaLekce = (obsah.lessons || []).find((lekce) => /děti/i.test(lekce.title || ''))
if (!detskaLekce || !new RegExp(`od ${FAKTA.vekDeti} let`, 'i').test(detskaLekce.tag || '')) {
  fail('content/obsah.json', `dětská lekce musí uvádět věk od ${FAKTA.vekDeti} let`)
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
    ['/joga-se-stenaty', '/joga-se-zviraty.html'],
    ['/joga-se-stenaty.html', '/joga-se-zviraty.html'],
    ['/joga-se-zviraty', '/joga-se-zviraty.html'],
    ['/joga-pro-deti-ostrava', '/joga-pro-deti-ostrava.html'],
    ['/darkovy-poukaz', '/darkovy-poukaz.html'],
    ['/rezervace', '/rezervace.html'],
  ])
  for (const [path, target] of requiredRedirects) {
    const actual = localRedirect(path)
    if (actual !== target) fail('vercel.json', `${path} se přesměrovává na ${actual || 'nic'}, čekáme ${target}`)
  }
} catch (e) {
  fail('vercel.json', `nejde přečíst jako JSON — ${e.message}`)
}

// Starý článek o štěňatech cílil na službu, kterou nenabízíme. Jeho URL
// musí zůstat jen jako redirect, ne jako znovu nasaditelná stránka.
if (existsSync(join(root, 'joga-se-stenaty.html'))) {
  fail('joga-se-stenaty.html', 'zrušená stránka se vrátila; ponech jen redirect ve vercel.json')
}
if (read('scripts/build.mjs').includes("'joga-se-stenaty.html'")) {
  fail('scripts/build.mjs', 'znovu kopíruje zrušenou stránku o štěňatech')
}
for (const page of PUBLIC_PAGES) {
  if (/href="\/?joga-se-stenaty(?:\.html)?(?:[#?"])/i.test(read(page))) {
    fail(page, 'interně odkazuje na zrušenou stránku o štěňatech')
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
