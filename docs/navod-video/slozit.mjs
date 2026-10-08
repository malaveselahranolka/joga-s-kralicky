// =====================================================================
//  Složí nahrávku z nahraj.mjs do videa pro Instagram (1080 × 1350, 4:5).
//
//    node docs/navod-video/slozit.mjs rezervace
//
//  1) snímky ze screencastu (nestejné rozestupy) → obrazovka.mp4, 30 fps
//  2) ramecek.html se vykreslí snímek po snímku (seek(t)) jako PNG
//     s průhlednou dírou místo obrazovky telefonu
//  3) ffmpeg podloží nahrávku pod rámeček → out/<scéna>.mp4
// =====================================================================
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright')
const FFMPEG = process.env.FFMPEG || 'ffmpeg'
const FPS = 30
const SCENA = process.argv[2] || 'rezervace'
const DIR = join(here, 'out', SCENA)
const KONEC = 3.8   // závěrečná karta (s)

const TEXTY = {
  rezervace: {
    title: 'Jak si<br>rezervovat lekci',
    steps: [
      ['Otevřete jogaskralicky.cz'],
      ['Klepněte na Rezervovat lekci'],
      ['Vyberte si termín', 'U každého vidíte, kolik míst je obsazeno.'],
      ['Vyplňte jméno a e-mail', 'Telefon je nepovinný.'],
      ['Zvolte počet míst', 'Na jedno jméno až 4. Cena se přepočítá.'],
      ['Souhlas a Rezervovat a zaplatit', 'Místo vám po dobu platby držíme.'],
      ['Zaplaťte kartou', 'Nebo Apple Pay / Google Pay. Brána Stripe.'],
      ['Hotovo, místo je vaše'],
      ['Potvrzení přijde e-mailem', 'Ve studiu jen ukážete QR kód.'],
    ],
    end: { h: 'Těšíme se na vás<br>i s králíčky', p: 'Termíny, rezervace a platba na jednom místě.', u: 'jogaskralicky.cz/rezervace' },
  },
  poukaz: {
    title: 'Jak koupit<br>dárkový poukaz',
    steps: [
      ['Otevřete jogaskralicky.cz'],
      ['Klepněte na Koupit poukaz'],
      ['Vyberte druh poukazu', 'Jóga s králíčky, nebo Děti & králíčci.'],
      ['Napište e-mail pro kód'],
      ['Klepněte na Zaplatit'],
      ['Zaplaťte kartou', 'Nebo Apple Pay / Google Pay. Brána Stripe.'],
      ['Kód uvidíte hned', 'Poukaz platí 6 měsíců.'],
      ['Poukaz přijde e-mailem', 'I jako PDF k vytištění.'],
    ],
    end: { h: 'Dárek během<br>pár minut', p: 'Obdarovaný si v rezervaci rozklikne „Mám dárkový poukaz“ a vepíše kód.', u: 'jogaskralicky.cz/koupit-poukaz' },
  },
}
// obrazovka telefonu v rámečku (CSS px plátna 540 × 675; výstup je 2×)
const SCREEN = { x: 222, y: 104, w: 288, h: 517 }

const data = JSON.parse(readFileSync(join(DIR, 'udalosti.json'), 'utf8'))
const t0 = data.udalosti.find((e) => e.typ === 'start').t
const tEnd = data.udalosti.find((e) => e.typ === 'konec').t
const ffmpeg = (args, stdin) => new Promise((res, rej) => {
  const p = spawn(FFMPEG, ['-y', '-loglevel', 'error', ...args], { stdio: [stdin ? 'pipe' : 'ignore', 'inherit', 'inherit'] })
  p.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg ' + c))))
  if (stdin) stdin(p.stdin)
})

// Chvíle, kdy se na obrazovce nic nehýbe (Stripe zpracovává platbu, stránka
// se načítá), zkrátíme na nejvýš MAX_STOJI sekund. Posunou se i popisky.
const MAX_STOJI = 2.4
const snimky = data.snimky.filter((s) => s.t <= tEnd + .5)
let prvni = snimky.findIndex((s) => s.t >= t0) - 1
if (prvni < 0) prvni = 0
const body = []       // [původní čas, nový čas] na začátku každého snímku
let nove = 0
for (let i = prvni; i < snimky.length; i++) {
  const od = Math.max(snimky[i].t, t0)
  const doo = i + 1 < snimky.length ? Math.max(snimky[i + 1].t, t0) : tEnd
  body.push({ od, nove, soubor: snimky[i].soubor, delka: Math.min(Math.max(0, doo - od), MAX_STOJI) })
  nove += body.at(-1).delka
}
const prevod = (t) => {
  let b = body[0]
  for (const x of body) { if (x.od <= t) b = x; else break }
  return b.nove + Math.min(Math.max(0, t - b.od), b.delka)
}
const delka = prevod(tEnd)
const seznam = []
for (const b of body) if (b.delka > 0) seznam.push(`file '${b.soubor}'`, `duration ${b.delka.toFixed(4)}`)
seznam.push(`file '${body.at(-1).soubor}'`)
writeFileSync(join(DIR, 'seznam.txt'), seznam.join('\n'))
const obrazovka = join(DIR, 'obrazovka.mp4')
await ffmpeg(['-f', 'concat', '-safe', '0', '-i', join(DIR, 'seznam.txt'),
  '-vf', `fps=${FPS},scale=${SCREEN.w * 2}:${SCREEN.h * 2}:flags=lanczos,setsar=1,tpad=stop_mode=clone:stop_duration=${KONEC + 1}`,
  '-c:v', 'libx264', '-crf', '14', '-preset', 'medium', '-pix_fmt', 'yuv420p', obrazovka])

// 2) + 3) rámeček snímek po snímku rovnou do výsledného videa
const udalosti = data.udalosti.map((e) => ({ ...e, t: prevod(e.t) }))
const DATA = { ...TEXTY[SCENA], events: udalosti, endAt: delka + .2, screen: SCREEN }
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 540, height: 675 }, deviceScaleFactor: 2 })
await page.addInitScript((d) => { window.DATA = d }, DATA)
await page.goto(pathToFileURL(join(here, 'ramecek.html')).href)
await page.evaluate(() => document.fonts.ready)

const celkem = Math.ceil((delka + .2 + KONEC) * FPS)
const vystup = join(here, 'out', SCENA + '.mp4')
await ffmpeg(['-i', obrazovka, '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
  '-filter_complex', `[0:v]pad=1080:1350:${SCREEN.x * 2}:${SCREEN.y * 2}:color=0xF1EEE5[b];[b][1:v]overlay=0:0:shortest=1,setsar=1,format=yuv420p[v]`,
  '-map', '[v]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-r', String(FPS), '-movflags', '+faststart', vystup],
async (stdin) => {
  for (let f = 0; f < celkem; f++) {
    await page.evaluate((t) => window.seek(t), f / FPS)
    const png = await page.screenshot({ omitBackground: true })
    if (!stdin.write(png)) await new Promise((r) => stdin.once('drain', r))
    if (f % 300 === 0) process.stdout.write(`\r${SCENA}: rámeček ${f}/${celkem}`)
  }
  stdin.end()
})
await browser.close()
console.log(`\r${SCENA}: ${(celkem / FPS).toFixed(1)} s → ${vystup}`)
