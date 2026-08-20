import {build} from 'esbuild'
import {copyFileSync, cpSync, existsSync, mkdirSync, rmSync} from 'node:fs'
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

await build({
  absWorkingDir: root,
  entryPoints: ['./src/cms.js'],
  bundle: true,
  format: 'iife',
  minify: true,
  sourcemap: true,
  outfile: 'cms.js',
})
copyFileSync(join(root, 'cms.js'), join(output, 'cms.js'))
copyFileSync(join(root, 'cms.js.map'), join(output, 'cms.js.map'))

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
