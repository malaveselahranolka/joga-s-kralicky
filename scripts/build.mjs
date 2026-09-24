import {copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {obsahDoHtml} from './obsah-do-html.mjs'

const root = process.cwd()
const output = join(root, 'public')

rmSync(output, {recursive: true, force: true})
mkdirSync(output, {recursive: true})

const files = [
  'index.html',
  '404.html',
  '410.html',
  'admin.html',
  'business.html',
  'rezervace.html',
  'darkovy-poukaz.html',
  'skupinove-lekce.html',
  'o-nas.html',
  'joga-pro-deti-ostrava.html',
  'joga-se-zviraty.html',
  'robots.txt',
  'sitemap.xml',
  'favicon.ico',
  'vstupenka.html',
  'obchodni-podminky.html',
  'zasady-osobnich-udaju.html',
  'payment-config.js',
  'supabase-config.js',
  'datum.js',
  'souhlas.js',
  'speed-insights.js',
  'google8760dad4313e888f.html',
  'llms.txt',
]

for (const file of files) {
  if (existsSync(join(root, file))) copyFileSync(join(root, file), join(output, file))
}
cpSync(join(root, 'assets'), join(output, 'assets'), {recursive: true})
cpSync(join(root, 'business'), join(output, 'business'), {recursive: true})

// ---------------------------------------------------------------------
//  OBSAH ZE SPRÁVY
//
//  content/obsah.json edituje majitelka ve správě (admin.html → Obsah).
//  Uložení commitne soubor na GitHub, Vercel nasadí a tady se obsah
//  vsadí do HTML. Když soubor chybí, build pokračuje s texty, které
//  jsou v index.html — nasazení kvůli obsahu nikdy nespadne.
// ---------------------------------------------------------------------
const obsahPath = join(root, 'content', 'obsah.json')
const indexPath = join(output, 'index.html')
if (existsSync(obsahPath) && existsSync(indexPath)) {
  try {
    const obsah = JSON.parse(readFileSync(obsahPath, 'utf8'))
    writeFileSync(indexPath, obsahDoHtml(readFileSync(indexPath, 'utf8'), obsah))
    console.log('Obsah: content/obsah.json vsazen do index.html.')
  } catch (e) {
    console.warn(`Obsah se nepodařilo vsadit (${e.message}) — jede se s texty z index.html.`)
  }
}

// ---------------------------------------------------------------------
//  FOTKY PRO TELEFON: srcset s 768px variantou
//
//  80–90 % návštěv přichází z reklam na Instagramu a Facebooku, tedy
//  z telefonu. Fotky v kartách, panelech a článcích přitom měly 1260 až
//  1500 px a jedna JPG z CMS vážila 206 KB — telefon je stahoval celé,
//  i když je vykreslil na šířku kolem 390 px.
//
//  Když vedle fotky leží soubor se stejným jménem a koncovkou -768.webp,
//  doplní se sem srcset a prohlížeč si vybere menší verzi sám. Varianty
//  se generují ručně (sharp) a commitují; bez varianty zůstane <img>
//  beze změny, takže nová fotka z CMS nic nerozbije, jen je větší.
//
//  Vynechané jsou: hlavní fotka úvodu (fetchpriority="high", má vlastní
//  <picture>) a fotky v galerii (button.rshot), kde se náhled a plná
//  verze pro lightbox řídí vlastní logikou.
// ---------------------------------------------------------------------
function rozmerObrazku(soubor) {
  try {
    const b = readFileSync(soubor)
    if (b.toString('ascii', 0, 4) === 'RIFF') {
      const typ = b.toString('ascii', 12, 16)
      if (typ === 'VP8X') return 1 + b.readUIntLE(24, 3)
      if (typ === 'VP8 ') return b.readUInt16LE(26) & 0x3fff
      if (typ === 'VP8L') return (b.readUInt32LE(21) & 0x3fff) + 1
      return null
    }
    if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2
      while (i < b.length) {
        const znacka = b[i + 1]
        if (znacka >= 0xc0 && znacka <= 0xc3) return b.readUInt16BE(i + 7)
        i += 2 + b.readUInt16BE(i + 2)
      }
    }
  } catch (_e) { /* neznámý formát = bez srcsetu */ }
  return null
}

let doplnenoSrcset = 0
for (const file of files.filter((f) => f.endsWith('.html'))) {
  const cesta = join(output, file)
  if (!existsSync(cesta)) continue
  const html = readFileSync(cesta, 'utf8')
  const nove = html.replace(/<img\b[^>]*>/g, (tag, index) => {
    if (/\ssrcset=/.test(tag) || /fetchpriority="high"/.test(tag)) return tag
    if (/<button[^>]*class="rshot"[^>]*>\s*$/.test(html.slice(Math.max(0, index - 200), index))) return tag
    const src = (tag.match(/\ssrc="(assets\/photos\/[^"]+\.(?:webp|jpe?g))"/) || [])[1]
    if (!src) return tag
    const varianta = src.replace(/\.(?:webp|jpe?g)$/, '-768.webp')
    if (!existsSync(join(root, varianta))) return tag
    const sirka = rozmerObrazku(join(root, src))
    if (!sirka || sirka <= 768) return tag
    doplnenoSrcset += 1
    return tag.replace(/\ssrc="/, ` srcset="${varianta} 768w, ${src} ${sirka}w" sizes="(max-width: 860px) 100vw, 50vw" src="`)
  })
  if (nove !== html) writeFileSync(cesta, nove)
}
console.log(`Fotky: srcset s mobilní variantou doplněn u ${doplnenoSrcset} obrázků.`)

// ---------------------------------------------------------------------
//  SDÍLENÉ CSS INLINE
//
//  Podstránky a články načítaly styl jako samostatný soubor. Na mobilní
//  síti to je další cesta k serveru, než se cokoliv vykreslí — Lighthouse
//  u podstránek počítal 0,3–0,5 s zdržení. Homepage má styly inline už
//  dávno, tak to sjednocujeme: v repu zůstává jeden sdílený soubor
//  (snadno se edituje), do nasazeného HTML se vloží jeho obsah.
// ---------------------------------------------------------------------
let vlozenoCss = 0
for (const file of files.filter((f) => f.endsWith('.html'))) {
  const cesta = join(output, file)
  if (!existsSync(cesta)) continue
  const html = readFileSync(cesta, 'utf8')
  const nove = html.replace(
    /<link rel="stylesheet" href="\/?(assets\/(?:article|podstranka)\.css)(?:\?[^"]*)?"\s*\/?>/g,
    (tag, soubor) => {
      if (!existsSync(join(root, soubor))) return tag
      vlozenoCss += 1
      return `<style>\n${readFileSync(join(root, soubor), 'utf8').replace(/<\/style/gi, '<\\/style')}\n</style>`
    },
  )
  if (nove !== html) writeFileSync(cesta, nove)
}
console.log(`CSS: sdílený styl vložen inline do ${vlozenoCss} stránek.`)

// ---------------------------------------------------------------------
//  SITEMAP: lastmod podle poslední změny v gitu
//
//  Datumy v sitemap.xml byly napsané ručně, takže se po každé úpravě
//  rozešly se skutečností — všech osm adres hlásilo tentýž den, i když
//  se soubory měnily později. Vyhledávač tomu pak přestane věřit
//  a datum ignoruje. Bereme ho radši z commitu, který se souboru
//  naposledy dotkl.
//
//  Kdyby git nebyl po ruce (stažený archiv, jiné CI), necháme datum
//  tak, jak je v souboru — build kvůli tomu nikdy nespadne.
// ---------------------------------------------------------------------
function lastCommitDate(file) {
  try {
    const r = spawnSync('git', ['log', '-1', '--format=%cs', '--', file], {cwd: root, encoding: 'utf8'})
    const out = (r.stdout || '').trim()
    return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : null
  } catch (_e) {
    return null
  }
}

// ---------------------------------------------------------------------
//  TERMÍNY DO HTML
//
//  Kalendář se dotahuje ze Supabase až v prohlížeči, takže v odeslaném
//  HTML nebylo ani jedno datum. Ověřeno stažením stránky jako Googlebot:
//  hledání data, měsíce i času vrátilo nula výskytů. Vyhledávače ani AI
//  asistenti tedy nevěděli, kdy se cvičí — u rezervačního webu ta
//  nejdražší mezera, jakou může mít.
//
//  Sem se proto při buildu dosadí nejbližší termíny jako obyčejné HTML
//  plus strukturovaná data typu Event. Klientský JS ten obsah po načtení
//  přepíše živými daty, takže návštěvník vidí aktuální obsazenost a
//  robot vidí aspoň termíny.
//
//  Pozor na jednu věc: tohle je stav k okamžiku nasazení. Aby termíny
//  nezestárly, musí se web nasadit po každé změně rozvrhu — na to slouží
//  deploy hook ve Vercelu.
//
//  Když se Supabase nedovolá, build POKRAČUJE bez termínů. Rozbité
//  nasazení je horší než nasazení bez pár řádků navíc.
// ---------------------------------------------------------------------
const TZ = 'Europe/Prague'
const den = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota']
const dva = (n) => String(n).padStart(2, '0')

function prazskeCasti(iso) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const o = {}
  for (const p of f.formatToParts(new Date(iso))) o[p.type] = p.value
  if (o.hour === '24') o.hour = '00'
  return o
}

const escHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => (
  {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]))

// Musí vracet totéž co thumbFor() v rezervace.html, jinak by se po načtení
// JS vyměnil obrázek za jiný a stránka by kvůli tomu problikla.
function nahled(l) {
  if (l && l.image_url) return l.image_url
  const t = String((l && l.title) || '').toLowerCase()
  if (t.includes('ranní')) return 'assets/photos/yoga-7.webp'
  if (t.includes('děti')) return 'assets/photos/rabbit-6.webp'
  if (t.includes('soumrak') || t.includes('restorativ')) return 'assets/photos/yoga-4.webp'
  if (t.includes('hatha')) return 'assets/photos/yoga-11.webp'
  return 'assets/photos/rabbit-1.webp'
}

async function nactiTerminy() {
  const cfg = readFileSync(join(root, 'supabase-config.js'), 'utf8')
  const url = (cfg.match(/SUPABASE_URL\s*=\s*'([^']+)'/) || [])[1]
  const key = (cfg.match(/SUPABASE_ANON_KEY\s*=\s*'([^']+)'/) || [])[1]
  if (!url || !key) return []
  const r = await fetch(`${url}/rest/v1/public_lessons?select=*&order=starts_at.asc&limit=12`, {
    headers: {apikey: key, Authorization: `Bearer ${key}`},
    signal: AbortSignal.timeout(8000),
  })
  if (!r.ok) throw new Error(`Supabase vrátil ${r.status}`)
  return await r.json()
}

const rezervacePath = join(output, 'rezervace.html')
if (existsSync(rezervacePath)) {
  let terminy = []
  try {
    terminy = await nactiTerminy()
  } catch (e) {
    console.warn(`Termíny se nepodařilo načíst (${e.message}) — stránka půjde ven bez nich.`)
  }

  if (terminy.length) {
    const misto = 'Fit&Fun Studio Ostrava, Tovární 486/7, 709 00 Ostrava-Mariánské Hory'
    const cena = 499

    // MARKUP SE SCHVÁLNĚ SHODUJE S TÍM, CO VYKRESLÍ renderDays() V PROHLÍŽEČI.
    //
    // Dřív tu byl obyčejný <ul> se dvěma řádky. Klientský JS ho po načtení
    // nahradil plnými kartami s fotkami, které jsou několikanásobně vyšší —
    // takže se celá stránka pod seznamem posunula dolů. Dokud byl skript
    // parser-blocking, stihlo se to před prvním vykreslením a nikomu to
    // nevadilo; s `defer` se to děje až po něm a Lighthouse to měřil jako
    // posun rozvržení 0,47 na stránce, kde se platí.
    //
    // Když má statický seznam stejný tvar, je výměna výškově neutrální na
    // jakékoli šířce okna — žádné dopočítávání min-height, které by se
    // rozešlo s realitou při první změně stylů.
    //
    // Obsazenost a stav „Obsazeno" se sem ZÁMĚRNĚ nepíšou: tohle je snímek
    // k okamžiku nasazení a přesně tuhle větu si přečte Google i AI asistent.
    // Místo čísel drží výšku nezlomitelná mezera; živá čísla dosadí JS.
    // `data-id` tu je proto, aby tlačítko fungovalo hned, jak se JS načte —
    // obsluha kliknutí visí na #dayList, ne na jednotlivých tlačítkách.
    const skupiny = new Map()
    for (const l of terminy) {
      const c = prazskeCasti(l.starts_at)
      const klic = `${c.year}-${c.month}-${c.day}`
      if (!skupiny.has(klic)) skupiny.set(klic, [])
      skupiny.get(klic).push(l)
    }

    const html = [...skupiny.values()].map((items) => {
      const c0 = prazskeCasti(items[0].starts_at)
      const dow = den[new Date(`${c0.year}-${c0.month}-${c0.day}T12:00:00Z`).getUTCDay()]
      const sloty = items.map((l) => {
        const c = prazskeCasti(l.starts_at)
        const konec = prazskeCasti(new Date(new Date(l.starts_at).getTime() + (l.duration_min || 60) * 60000))
        return `<div class="slot">`
          + `<div class="time"><span class="rng">${c.hour}:${c.minute} – ${konec.hour}:${konec.minute}</span>`
          + `<span class="dur">${l.duration_min || 60} min</span></div>`
          + `<div class="info"><img class="thumb" src="${escHtml(nahled(l))}" alt="" loading="lazy" />`
          + `<div class="meta"><div class="lbl">Lekce</div><div class="val">${escHtml(l.title)}</div>`
          + `<div class="place"><div class="lbl">Místo</div><div class="val">${escHtml(misto)}</div></div></div></div>`
          + `<div class="book"><div class="cap">&nbsp;</div>`
          + `<button class="btn btn-primary" data-id="${escHtml(l.id)}">Rezervovat</button></div></div>`
      }).join('')
      return `<div class="day-group"><div class="day-head">`
        + `<span class="date">${c0.day}. ${c0.month}. ${c0.year}</span>`
        + `<span class="dow">${dow}</span></div>${sloty}</div>`
    }).join('')

    const udalosti = terminy.map((l) => ({
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: l.title,
      description: `${l.title} ve Fit&Fun Studiu v Ostravě-Mariánských Horách. `
        + `${l.duration_min || 60} minut jemné hatha jógy, při které mezi cvičícími `
        + `volně pobíhá sedm domácích králíků. Vstup ${cena} Kč, platí se online při rezervaci.`,
      startDate: new Date(l.starts_at).toISOString(),
      endDate: new Date(new Date(l.starts_at).getTime() + (l.duration_min || 60) * 60000).toISOString(),
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      inLanguage: 'cs-CZ',
      maximumAttendeeCapacity: Number(l.capacity) || undefined,
      remainingAttendeeCapacity: Number(l.remaining) || 0,
      location: {
        '@type': 'Place',
        name: 'Fit&Fun Studio Ostrava',
        address: {
          '@type': 'PostalAddress',
          streetAddress: 'Tovární 486/7',
          addressLocality: 'Ostrava-Mariánské Hory',
          postalCode: '709 00',
          addressCountry: 'CZ',
        },
      },
      organizer: {'@type': 'Organization', name: 'Jóga s králíčky', url: 'https://www.jogaskralicky.cz/'},
      image: ['https://www.jogaskralicky.cz/assets/og-jogaskralicky.png'],
      offers: {
        '@type': 'Offer',
        price: String(cena),
        priceCurrency: 'CZK',
        availability: Number(l.remaining) > 0
          ? 'https://schema.org/InStock'
          : 'https://schema.org/SoldOut',
        url: 'https://www.jogaskralicky.cz/rezervace.html',
        validFrom: new Date().toISOString(),
      },
    }))

    const ldTag = `<script type="application/ld+json">\n${JSON.stringify(udalosti, null, 2)}\n</script>`

    let stranka = readFileSync(rezervacePath, 'utf8')
    stranka = stranka.replace('<!--TERMINY-->', html)
    stranka = stranka.replace('</head>', `${ldTag}\n</head>`)
    writeFileSync(rezervacePath, stranka)
    console.log(`Termíny: do rezervace.html vloženo ${terminy.length} termínů a Event schema.`)
  }
}

const sitemapPath = join(output, 'sitemap.xml')
if (existsSync(sitemapPath)) {
  const origin = 'https://www.jogaskralicky.cz'
  let xml = readFileSync(sitemapPath, 'utf8')
  let touched = 0
  let zaloha = 0
  xml = xml.replace(
    /<loc>([^<]+)<\/loc>(\s*)<lastmod>[^<]*<\/lastmod>/g,
    (whole, loc, gap) => {
      // adresa → soubor v repozitáři ('/' je index.html)
      const rel = loc.replace(origin, '').replace(/^\//, '') || 'index.html'
      const soubor = join(root, rel)
      if (!existsSync(soubor)) return whole
      // Na Vercelu se zdroják rozbaluje z archivu, ne z gitu — `git log` tam
      // nemá co číst a vrací prázdno. Tichým důsledkem bylo, že se v produkci
      // nikdy nepřepsalo ani jedno datum a sitemapa tvrdila 2026-08-20,
      // zatímco stránky se měnily o dva týdny později. Proto ten záložní
      // údaj z data souboru: po rozbalení archivu odpovídá nasazení, což je
      // pravdivější než datum zamrzlé v repozitáři.
      const zGitu = lastCommitDate(rel)
      const date = zGitu || statSync(soubor).mtime.toISOString().slice(0, 10)
      if (zGitu) touched += 1
      else zaloha += 1
      return `<loc>${loc}</loc>${gap}<lastmod>${date}</lastmod>`
    },
  )
  writeFileSync(sitemapPath, xml)
  console.log(`Sitemap: lastmod z gitu u ${touched} adres, ze souboru u ${zaloha}.`)
}

console.log('Hotovo: veřejný web je v public/.')
