// =====================================================================
//  Vyrenderuje návodová videa snímek po snímku do MP4.
//
//    node docs/navod-video/record.mjs [rezervace] [poukaz]
//
//  Potřebuje Playwright (chromium) a ffmpeg s libx264. Cestu k ffmpeg jde
//  přebít proměnnou FFMPEG, k modulu playwright proměnnou PLAYWRIGHT.
//  Výstup: docs/navod-video/out/<scéna>.mp4 (1080 × 1920, 30 fps).
// =====================================================================
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright')
const FFMPEG = process.env.FFMPEG || 'ffmpeg'
const FPS = 30
const scenes = process.argv.slice(2).length ? process.argv.slice(2) : ['rezervace', 'poukaz']
const only = process.env.FRAMES ? process.env.FRAMES.split(',').map(Number) : null

mkdirSync(join(here, 'out'), { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 })

for (const scene of scenes) {
  await page.goto(pathToFileURL(join(here, scene + '.html')).href)
  await page.evaluate(() => document.fonts.ready)
  await page.waitForLoadState('networkidle')
  const dur = await page.evaluate(() => window.duration())
  const frames = Math.ceil(dur * FPS)

  // jen vybrané časy jako PNG (kontrola): FRAMES=1.5,10,22
  if (only) {
    for (const t of only) {
      await page.evaluate((t) => window.seek(t), t)
      await page.screenshot({ path: join(here, 'out', `${scene}-${t}s.png`) })
    }
    console.log(`${scene}: ${dur.toFixed(1)} s, kontrolní snímky uložené`)
    continue
  }

  const out = join(here, 'out', scene + '.mp4')
  const ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] })
  const done = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg ' + c)))))
  for (let f = 0; f <= frames; f++) {
    await page.evaluate((t) => window.seek(t), f / FPS)
    const buf = await page.screenshot({ type: 'jpeg', quality: 93 })
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r))
    if (f % 150 === 0) process.stdout.write(`\r${scene}: ${f}/${frames}`)
  }
  ff.stdin.end()
  await done
  console.log(`\r${scene}: ${dur.toFixed(1)} s → ${out}`)
}
await browser.close()
