import {build} from 'esbuild'
import {copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'

const root = process.cwd()
const output = join(root, 'public')
const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || process.env.SANITY_STUDIO_PROJECT_ID || process.env.SANITY_API_PROJECT_ID
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET || process.env.SANITY_STUDIO_DATASET || process.env.SANITY_API_DATASET || 'production'

if (!projectId) throw new Error('Chybí SANITY project ID. Spusť `vercel env pull .env.local`.')

rmSync(output, {recursive: true, force: true})
mkdirSync(output, {recursive: true})

const files = [
  'index.html',
  '404.html',
  'admin.html',
  'rezervace.html',
  'joga-se-zviraty.html',
  'darkovy-poukaz.html',
  'joga-pro-deti-ostrava.html',
  'joga-se-stenaty.html',
  'robots.txt',
  'sitemap.xml',
  'vstupenka.html',
  'obchodni-podminky.html',
  'zasady-osobnich-udaju.html',
  'payment-config.js',
  'supabase-config.js',
  'datum.js',
  'google8760dad4313e888f.html',
  'llms.txt',
]

for (const file of files) {
  if (existsSync(join(root, file))) copyFileSync(join(root, file), join(output, file))
}
cpSync(join(root, 'assets'), join(output, 'assets'), {recursive: true})

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

    const radky = terminy.map((l) => {
      const c = prazskeCasti(l.starts_at)
      const konec = prazskeCasti(new Date(new Date(l.starts_at).getTime() + (l.duration_min || 60) * 60000))
      const dow = den[new Date(`${c.year}-${c.month}-${c.day}T12:00:00Z`).getUTCDay()]
      const volno = Number(l.remaining) > 0
      return `        <li>
          <strong>${escHtml(l.title)}</strong> — ${dow} ${c.day}. ${c.month}. ${c.year},
          ${c.hour}:${c.minute}–${konec.hour}:${konec.minute} ·
          ${volno ? `volných míst: ${l.remaining} z ${l.capacity}` : 'obsazeno'} ·
          ${cena} Kč · ${escHtml(misto)}
        </li>`
    }).join('\n')

    const html = `
      <section class="terminy-staticke">
        <h2>Vypsané termíny</h2>
        <ul>
${radky}
        </ul>
        <p>Obsazenost se načte aktuální po otevření stránky. Vstup se platí online při rezervaci.</p>
      </section>`

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
  xml = xml.replace(
    /<loc>([^<]+)<\/loc>(\s*)<lastmod>[^<]*<\/lastmod>/g,
    (whole, loc, gap) => {
      // adresa → soubor v repozitáři ('/' je index.html)
      const rel = loc.replace(origin, '').replace(/^\//, '') || 'index.html'
      const date = existsSync(join(root, rel)) ? lastCommitDate(rel) : null
      if (!date) return whole
      touched += 1
      return `<loc>${loc}</loc>${gap}<lastmod>${date}</lastmod>`
    },
  )
  writeFileSync(sitemapPath, xml)
  console.log(`Sitemap: lastmod dopočítán z gitu u ${touched} adres.`)
}

// splitting + esm: vizuální editor se vejde do vlastního souboru, který si
// veřejná stránka nevyžádá. Bez toho by ho dynamický import jen vložil zpátky
// do hlavního balíku a nic bychom neušetřili.
// (index.html načítá cms.js jako <script type="module">, takže esm sedí.)
await build({
  absWorkingDir: root,
  entryPoints: ['./src/cms.js'],
  bundle: true,
  format: 'esm',
  splitting: true,
  minify: true,
  sourcemap: true,
  outdir: output,
  entryNames: '[name]',
  chunkNames: 'chunks/[name]-[hash]',
})

const bin = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'sanity.cmd' : 'sanity')
const result = spawnSync(bin, ['build', join(output, 'studio'), '--yes'], {
  cwd: root,
  env: process.env,
  shell: process.platform === 'win32',
  stdio: 'inherit',
})
if (result.status !== 0) process.exit(result.status || 1)

const localStudio = join(root, 'studio')
rmSync(localStudio, {recursive: true, force: true})
cpSync(join(output, 'studio'), localStudio, {recursive: true})

console.log('Hotovo: veřejný web + Sanity Studio jsou v public/.')
