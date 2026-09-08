// Kontrola hotového balíku v public/. Zdrojové soubory mohou být správně,
// ale build do nich ještě vsazuje obsah z content/obsah.json a termíny.
// Tahle kontrola proto běží až po buildu a hlídá to, co skutečně dostane
// návštěvník i vyhledávač.
import {existsSync, readFileSync} from 'node:fs'
import {dirname, join, normalize} from 'node:path'

const root = process.cwd()
const output = join(root, 'public')
const origin = 'https://www.jogaskralicky.cz'
const problems = []
const fail = (where, what) => problems.push(`${where}: ${what}`)
const read = (file) => readFileSync(join(output, file), 'utf8')

if (!existsSync(output)) {
  console.error('✗ public/ neexistuje — nejdřív spusť build.')
  process.exit(1)
}

const sitemap = read('sitemap.xml')
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])
const pages = locs.map((loc) => loc.replace(`${origin}/`, '') || 'index.html')

for (const [index, page] of pages.entries()) {
  if (!locs[index].startsWith(`${origin}/`)) {
    fail('sitemap.xml', `nekanonická adresa ${locs[index]}`)
    continue
  }
  if (!existsSync(join(output, page))) {
    fail('sitemap.xml', `${locs[index]} nemá soubor v public/`)
    continue
  }

  const html = read(page)
  const titleCount = [...html.matchAll(/<title>[^<]+<\/title>/gi)].length
  const descriptionCount = [...html.matchAll(/<meta[^>]+name="description"[^>]+content="[^"]+"/gi)].length
  const h1Count = [...html.matchAll(/<h1(?:\s[^>]*)?>[\s\S]*?<\/h1>/gi)].length
  const canonical = (html.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i) || [])[1]
  const expectedCanonical = page === 'index.html' ? `${origin}/` : `${origin}/${page}`
  const robots = (html.match(/<meta[^>]+name="robots"[^>]+content="([^"]+)"/i) || [])[1] || ''

  if (titleCount !== 1) fail(page, `má ${titleCount} elementů <title>`)
  if (descriptionCount !== 1) fail(page, `má ${descriptionCount} meta description`)
  if (h1Count !== 1) fail(page, `má ${h1Count} nadpisů H1`)
  if (canonical !== expectedCanonical) fail(page, `canonical je ${canonical || 'prázdný'}, čekáme ${expectedCanonical}`)
  if (!/(?:^|,)\s*index(?:\s*,|$)/i.test(robots)) fail(page, 'není indexovatelná podle meta robots')

  for (const [, attrs, body] of html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/ld\+json/i.test(attrs) || !body.trim()) continue
    try {
      JSON.parse(body)
    } catch (error) {
      fail(page, `build vytvořil nevalidní JSON-LD — ${error.message}`)
    }
  }
}

for (const page of ['obchodni-podminky.html', 'zasady-osobnich-udaju.html']) {
  if (!existsSync(join(output, page))) {
    fail(page, 'chybí v public/')
    continue
  }
  if (!/<meta[^>]+name="robots"[^>]+content="[^"]*noindex[^"]*"/i.test(read(page))) {
    fail(page, 'chybí noindex')
  }
}

for (const retired of ['joga-se-stenaty.html', 'joga-se-zviraty.html']) {
  if (existsSync(join(output, retired))) {
    fail(`public/${retired}`, 'zrušená SEO stránka se dostala do nasazení')
  }
}

// Lokální odkazy a soubory. Kontrolujeme celý veřejný balík, nejen sitemapu,
// aby neprošla třeba nefunkční fotka nebo odkaz z právní stránky.
const publicHtml = [...new Set([...pages, 'obchodni-podminky.html', 'zasady-osobnich-udaju.html', '404.html'])]
for (const page of publicHtml) {
  if (!existsSync(join(output, page))) continue
  const html = read(page)
  for (const [, attr, raw] of html.matchAll(/\s(href|src)="([^"]*)"/gi)) {
    if (!raw || /^(?:https?:|mailto:|tel:|data:|blob:|#)/i.test(raw)) continue
    if (/[+'`${}]/.test(raw)) continue
    const [withoutFragment, fragment = ''] = raw.split('#')
    const withoutQuery = withoutFragment.split('?')[0]
    if (/^\/(?:api|studio)(?:\/|$)/.test(withoutQuery)) continue

    let target
    if (!withoutQuery || withoutQuery === '/') target = 'index.html'
    else if (withoutQuery.startsWith('/')) target = withoutQuery.slice(1)
    else target = normalize(join(dirname(page), withoutQuery))
    if (target.endsWith('/')) target += 'index.html'

    if (!existsSync(join(output, target))) {
      fail(page, `${attr} odkazuje na chybějící ${raw}`)
      continue
    }
    if (fragment && /\.html$/i.test(target)) {
      const targetHtml = read(target)
      if (!new RegExp(`\\sid=["']${fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`).test(targetHtml)) {
        fail(page, `kotva ${raw} v cílové stránce neexistuje`)
      }
    }
  }
}

const content = JSON.parse(readFileSync(join(root, 'content', 'obsah.json'), 'utf8'))
const builtTitle = (read('index.html').match(/<title>([^<]+)<\/title>/i) || [])[1]
if (builtTitle !== content.pageTitle) {
  fail('public/index.html', `title po buildu neodpovídá content/obsah.json (${builtTitle})`)
}
const builtHome = read('index.html')
if (!builtTitle?.includes('Jóga se zvířaty Ostrava') || !builtTitle?.includes('Jóga s králíčky')) {
  fail('public/index.html', 'výsledný title nespojuje hlavní lokální dotaz se značkou')
}
for (const varianta of ['jóga se zvířátky', 'bunny yoga', 'pet yoga', 'králičí jóga']) {
  if (!builtHome.toLocaleLowerCase('cs-CZ').includes(varianta.toLocaleLowerCase('cs-CZ'))) {
    fail('public/index.html', `výsledná homepage neobsahuje variantu „${varianta}“`)
  }
}

if (problems.length) {
  console.error(`\n✗ Hotový web má ${problems.length} ${problems.length === 1 ? 'problém' : 'problémů'}:\n`)
  for (const problem of problems) console.error(`  • ${problem}`)
  console.error('')
  process.exit(1)
}

console.log(`✓ Hotový web prošel kontrolou: ${pages.length} indexovatelných adres, odkazy, soubory a JSON-LD sedí.`)
