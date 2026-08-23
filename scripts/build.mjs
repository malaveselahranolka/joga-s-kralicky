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
