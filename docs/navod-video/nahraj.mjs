// =====================================================================
//  Návodová videa: nahrávka ŽIVÉHO webu v mobilním zobrazení.
//
//    node --experimental-strip-types docs/navod-video/nahraj.mjs rezervace
//    node --experimental-strip-types docs/navod-video/nahraj.mjs poukaz
//
//  Prohlížeč jde na https://www.jogaskralicky.cz a proklikává se jako host.
//  Nic se přitom nezapíše: rezervaci (rpc create_booking), platební funkce
//  (stripe-create, stripe-voucher, stripe-confirm) a stav vstupenky
//  zachytí page.route() a odpoví ukázkovými daty. Čtení termínů jde na
//  ostrá data, takže video ukazuje skutečnou nabídku.
//
//  Platební brána je kopie (stripe.html) — skutečná Checkout session by
//  v ostrém Stripu znamenala skutečnou rezervaci nebo platbu. Když je po
//  ruce Stripe sandbox, dá se místo kopie podstrčit její URL: STRIPE_URL=…
//
//  E-mail na konci je skutečný výstup šablon (templates.ts) v posta.html.
//
//  Výstup: out/<scéna>/f000001.jpg… + udalosti.json. Video z toho složí
//  slozit.mjs.
// =====================================================================
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright')
globalThis.Deno = { env: { get: () => undefined } }   // templates.ts sahá na Deno.env jen u ceníku
const { bookingMail, voucherMail } = await import('../../supabase/functions/_shared/templates.ts')

const SCENA = process.argv[2] || 'rezervace'
const WEB = 'https://www.jogaskralicky.cz'
const POSTA = 'https://posta.example/'
const CHECKOUT = 'https://checkout.stripe.com/c/pay/'
const OUT = join(here, 'out', SCENA)
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

// ukázkové údaje
const JANA = { first: 'Jana', last: 'Nováková', tel: '777 123 456', email: 'jana.novakova@email.cz' }
const PETR = { email: 'petr.dvorak@email.cz' }
const BOOKING_ID = '3f6c2a1e-8b4d-4c7a-9e21-5d0b7a9c4e10'
const SID_REZ = 'cs_live_a1Xq7Zp2Lm9Kd4Rt6Wy8Bn3Vc5Hj0Gf'
const SID_POUKAZ = 'cs_live_b2Yr8Aq3Mn0Le5Su7Xz9CoKRALICEK'   // → kód DK-KRALICEK (stejný jako na ukázkovém PDF)
const MIST = 2

// ---- čas a události pro popisky ---------------------------------------
const udalosti = []
const ted = () => Date.now() / 1000
const krok = (n) => udalosti.push({ t: ted(), typ: 'krok', n })
const adresa = (v) => udalosti.push({ t: ted(), typ: 'adresa', v })
const pauza = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- prst (kreslí se přímo do stránky, takže je v nahrávce) -------------
const PRST = `(() => {
  if (window.top !== window) return;
  const el = () => {
    let f = document.getElementById('__prst');
    if (!f && document.documentElement) {
      f = document.createElement('div'); f.id = '__prst';
      f.style.cssText = 'position:fixed;left:-60px;top:-60px;width:42px;height:42px;margin:-21px 0 0 -21px;border-radius:50%;background:rgba(210,133,74,.32);border:2.5px solid #D2854A;z-index:2147483647;pointer-events:none;opacity:0;box-shadow:0 4px 12px rgba(30,35,28,.22);transition:opacity .25s';
      const r = document.createElement('div'); r.id = '__vlna';
      r.style.cssText = 'position:fixed;width:42px;height:42px;margin:-21px 0 0 -21px;border-radius:50%;border:3px solid #D2854A;z-index:2147483646;pointer-events:none;opacity:0';
      document.documentElement.append(f, r);
    }
    return f;
  };
  const ease = (p) => p < .5 ? 4*p*p*p : 1 - Math.pow(-2*p + 2, 3) / 2;
  window.__prst = {
    x: -60, y: -60,
    ukaz(x, y) { const f = el(); this.x = x; this.y = y; f.style.left = x + 'px'; f.style.top = y + 'px'; f.style.opacity = 1; },
    skryj() { const f = el(); if (f) f.style.opacity = 0; },
    jed(x, y, ms) {
      const f = el(), x0 = this.x, y0 = this.y, t0 = performance.now();
      const bow = Math.min(36, Math.hypot(x - x0, y - y0) * .12);
      this.x = x; this.y = y;
      return new Promise((res) => {
        const krok = (t) => {
          const p = Math.min(1, (t - t0) / ms), e = ease(p);
          f.style.left = (x0 + (x - x0) * e) + 'px';
          f.style.top = (y0 + (y - y0) * e - Math.sin(Math.PI * e) * bow) + 'px';
          p < 1 ? requestAnimationFrame(krok) : res();
        };
        requestAnimationFrame(krok);
      });
    },
    tuk() {
      const f = el(), r = document.getElementById('__vlna');
      r.style.left = this.x + 'px'; r.style.top = this.y + 'px';
      f.animate([{ transform: 'scale(1)' }, { transform: 'scale(.78)' }, { transform: 'scale(1)' }], { duration: 300 });
      r.animate([{ opacity: .85, transform: 'scale(.6)' }, { opacity: 0, transform: 'scale(2)' }], { duration: 560, easing: 'ease-out' });
    },
    scroll(y, ms) {
      const y0 = window.scrollY, t0 = performance.now();
      return new Promise((res) => {
        const krok = (t) => {
          const p = Math.min(1, (t - t0) / ms);
          window.scrollTo(0, y0 + (y - y0) * ease(p));
          p < 1 ? requestAnimationFrame(krok) : res();
        };
        requestAnimationFrame(krok);
      });
    },
  };
  // Skript dává fokus nadpisu nového kroku (tabindex=-1). Chrome pod
  // automatizací kolem něj kreslí rámeček, telefon při dotyku ne.
  document.addEventListener('DOMContentLoaded', () => {
    const st = document.createElement('style');
    st.textContent = '[tabindex="-1"]:focus{outline:none!important;box-shadow:none}';
    document.head.append(st);
  });
  // Lištu se souhlasem s měřením vynecháme (a do Analytics nic neposíláme).
  try { if (location.hostname.endsWith('jogaskralicky.cz')) localStorage.setItem('jsk-souhlas', JSON.stringify({ stav: 'ne', verze: 1, datum: new Date().toISOString() })); } catch (e) {}
})();`

// ---- prohlížeč -----------------------------------------------------------
const browser = await chromium.launch({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined })
const ctx = await browser.newContext({
  viewport: { width: 390, height: 700 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  locale: 'cs-CZ', timezoneId: 'Europe/Prague',
})
await ctx.addInitScript(PRST)

// ---- zachycené zápisy -----------------------------------------------------
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' }
const json = (route, body, status = 200) => route.request().method() === 'OPTIONS'
  ? route.fulfill({ status: 204, headers: CORS })
  : route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })

let lekce = []
let zvolena = null
await ctx.route(/googletagmanager|google-analytics|\/_vercel\/(insights|speed-insights)|connect\.facebook/, (r) => r.fulfill({ status: 204, body: '' }))
await ctx.route('**/rest/v1/public_lessons*', async (route) => {
  const res = await route.fetch()
  lekce = await res.json().catch(() => [])
  route.fulfill({ response: res })
})
await ctx.route('**/rest/v1/rpc/create_booking', (r) => json(r, { ok: true, booking_id: BOOKING_ID }))
await ctx.route('**/rest/v1/booking_sources*', (r) => json(r, null, 201))
await ctx.route('**/rest/v1/rpc/get_ticket', (r) => json(r, { id: BOOKING_ID, payment_status: 'paid', status: 'confirmed' }))
await ctx.route('**/functions/v1/stripe-create', (r) => json(r, { ok: true, url: process.env.STRIPE_URL || CHECKOUT + SID_REZ }))
await ctx.route('**/functions/v1/stripe-voucher', (r) => json(r, { ok: true, url: process.env.STRIPE_URL || CHECKOUT + SID_POUKAZ }))
await ctx.route('**/functions/v1/stripe-confirm', (r) => json(r, SCENA === 'poukaz'
  ? { ok: true, codes: ['DK-KRALICEK'], serverEmail: true }
  : { ok: true, paid: true, serverEmail: true }))

const czk = (n) => Number(n).toLocaleString('cs-CZ') + ' Kč'
const czkStripe = (n) => Number(n).toLocaleString('cs-CZ', { minimumFractionDigits: 2 }) + ' Kč'
const stripeStranka = () => {
  const o = SCENA === 'poukaz'
    ? { name: 'Jóga s králíčky', amount: czkStripe(499), qty: '1 × 499 Kč', email: PETR.email,
        msg: 'Kódy poukazů dostanete hned po zaplacení e-mailem.',
        success: `${WEB}/koupit-poukaz.html?voucher=ok&session_id=${SID_POUKAZ}` }
    : { name: `${zvolena?.title || 'Jóga s králíčky'} — vstup (Jóga s králíčky)`, amount: czkStripe(499 * MIST), qty: `Množství: ${MIST}`,
        email: JANA.email, msg: 'Místo na lekci držíme 35 minut, než platbu dokončíte.',
        success: `${WEB}/rezervace.html?platba=ok&session_id=${SID_REZ}` }
  return readFileSync(join(here, 'stripe.html'), 'utf8').replace('<head>', `<head><script>window.OBJ=${JSON.stringify(o)}</script>`)
}
if (!process.env.STRIPE_URL) {
  await ctx.route(CHECKOUT + '**', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: stripeStranka() }))
}

// e-mail přesně podle šablon
const TZ = 'Europe/Prague'
const kdy = (iso, min) => {
  const d = new Date(iso), e = new Date(d.getTime() + min * 60000)
  const dow = new Intl.DateTimeFormat('cs-CZ', { timeZone: TZ, weekday: 'long' }).format(d)
  const dat = new Intl.DateTimeFormat('cs-CZ', { timeZone: TZ, day: 'numeric', month: 'numeric', year: 'numeric' }).format(d).replace(/\s/g, ' ')
  const cas = (x) => new Intl.DateTimeFormat('cs-CZ', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(x)
  return `${dow.charAt(0).toUpperCase() + dow.slice(1)} ${dat} · ${cas(d)}–${cas(e)}`
}
const mail = () => {
  if (SCENA === 'poukaz') {
    const m = voucherMail({ code: 'DK-KRALICEK', amount: czk(499), druh: 'klasik', deti: '1' })
    return { ...m, to: PETR.email, attachment: 'darkovy-poukaz-dk-kralicek.pdf' }
  }
  const ticket = `${WEB}/vstupenka.html#${BOOKING_ID}`
  const m = bookingMail({
    name: `${JANA.first} ${JANA.last}`, lesson: zvolena.title, datetime: kdy(zvolena.starts_at, zvolena.duration_min),
    spots: `${MIST} místa`, price: czk(499 * MIST), druh: 'klasik',
    location: 'Fit&Fun Studio Ostrava, Tovární 486/7, 709 00 Ostrava-Mariánské Hory', ticket_url: ticket,
    qr_url: 'https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=8&data=' + encodeURIComponent(ticket),
  })
  return { ...m, to: JANA.email }
}
await ctx.route(POSTA + '**', (r) => r.fulfill({
  status: 200, contentType: 'text/html; charset=utf-8',
  body: readFileSync(join(here, 'posta.html'), 'utf8').replace('<head>', `<head><script>window.MAIL=${JSON.stringify(mail())}</script>`),
}))

const page = await ctx.newPage()

// zahřátí cache, ať první načtení ve videu netrvá věčnost
await page.goto(WEB + '/', { waitUntil: 'networkidle' })
await page.goto(WEB + (SCENA === 'poukaz' ? '/koupit-poukaz.html' : '/rezervace.html'), { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.removeItem('pendingBooking'))
await page.goto('about:blank')

// ---- nahrávání (CDP screencast) -------------------------------------------
const cdp = await ctx.newCDPSession(page)
const snimky = []
cdp.on('Page.screencastFrame', async (f) => {
  const i = snimky.length + 1
  const soubor = `f${String(i).padStart(6, '0')}.jpg`
  writeFileSync(join(OUT, soubor), Buffer.from(f.data, 'base64'))
  snimky.push({ soubor, t: f.metadata.timestamp })
  cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
})
const start = () => cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 780, maxHeight: 1400, everyNthFrame: 1 }).catch(() => {})
await start()
// po přechodu na jinou doménu se screencast umí zastavit — pustíme ho znovu
page.on('framenavigated', (fr) => { if (fr === page.mainFrame()) start() })

// ---- ovládání ---------------------------------------------------------------
let px = 300, py = 560
const vyska = 700
const ukazPrst = () => page.evaluate(([x, y]) => window.__prst && window.__prst.ukaz(x, y), [px, py])
async function nactena(url) {
  await page.waitForLoadState('domcontentloaded')
  if (url) adresa(url)
  await page.waitForLoadState('networkidle', { timeout: url === 'checkout.stripe.com' ? 1500 : 8000 }).catch(() => {})
}
async function dojed(loc, pomer = .5, ms = 1000) {
  const box = await loc.boundingBox()
  const sy = await page.evaluate(() => window.scrollY)
  const max = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)
  const cil = Math.max(0, Math.min(max, Math.round(sy + box.y + box.height / 2 - vyska * pomer)))
  if (Math.abs(cil - sy) > 4) await page.evaluate(([y, ms]) => window.__prst.scroll(y, ms), [cil, ms])
}
async function tukni(loc, { ms = 700, dojet = true, pomer = .5, nav = false } = {}) {
  await loc.waitFor({ state: 'visible' })
  if (dojet) {
    const box = await loc.boundingBox()
    if (box.y < 60 || box.y + box.height > vyska - 60) { await dojed(loc, pomer); await pauza(250) }
  }
  const b = await loc.boundingBox()
  const x = b.x + b.width / 2, y = b.y + b.height / 2
  await ukazPrst()
  await page.evaluate(([x, y, ms]) => window.__prst.jed(x, y, ms), [x, y, ms])
  px = x; py = y
  await page.evaluate(() => window.__prst.tuk())
  await pauza(120)
  if (nav) await Promise.all([page.waitForNavigation(), page.mouse.click(x, y)])
  else await page.mouse.click(x, y)
}
async function napis(loc, text, zpozdeni = 85) {
  await tukni(loc, { ms: 550 })
  await pauza(200)
  await page.keyboard.type(text, { delay: zpozdeni })
  await pauza(350)
}
async function oznameni(predmet) {
  await page.evaluate((predmet) => {
    const n = document.createElement('div')
    n.id = '__notif'
    n.innerHTML = '<div style="flex:none;width:38px;height:38px;border-radius:9px;background:#0A6CFF;display:flex;align-items:center;justify-content:center"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg></div>' +
      '<div style="flex:1;min-width:0"><div style="display:flex;justify-content:space-between;font-size:12px;color:#6B6B6B"><span>POŠTA</span><span>teď</span></div>' +
      '<div style="font-weight:700;font-size:14.5px;margin-top:1px">Jóga s králíčky</div><div style="font-size:13.5px;line-height:1.35">' + predmet + '</div></div>'
    n.style.cssText = 'position:fixed;left:10px;right:10px;top:10px;z-index:2147483600;display:flex;gap:11px;padding:12px 14px;border-radius:20px;background:rgba(246,246,246,.97);box-shadow:0 12px 32px rgba(0,0,0,.22);font-family:-apple-system,Inter,Helvetica,sans-serif;color:#111;transform:translateY(-140%);transition:transform .55s cubic-bezier(.2,.9,.3,1.1)'
    document.body.append(n)
    requestAnimationFrame(() => requestAnimationFrame(() => { n.style.transform = 'none' }))
  }, predmet)
  await pauza(1900)
}

// ---- scénáře -----------------------------------------------------------------
async function rezervace() {
  krok(1)
  adresa('jogaskralicky.cz')
  await page.goto(WEB + '/', { waitUntil: 'domcontentloaded' })
  await nactena()
  await pauza(2200)
  await ukazPrst()
  await pauza(700)

  krok(2)
  await pauza(900)
  await tukni(page.locator('.hero-actions a.btn-light').first(), { nav: true })
  await nactena('jogaskralicky.cz/rezervace')
  await page.locator('#dayList button[data-id]').first().waitFor()

  krok(3)
  zvolena = lekce.find((l) => l.druh !== 'deti' && l.remaining >= MIST) || lekce.find((l) => l.remaining >= MIST)
  const tl = page.locator(`#dayList button[data-id="${zvolena.id}"]`)
  await pauza(1500)
  await dojed(tl, .55, 1600)
  await pauza(1200)
  await tukni(tl)
  await page.locator('#stepForm').waitFor({ state: 'visible' })
  await pauza(1300)

  krok(4)
  await pauza(600)
  await napis(page.locator('#f-first'), JANA.first)
  await napis(page.locator('#f-last'), JANA.last)
  await napis(page.locator('#f-tel'), JANA.tel)
  await napis(page.locator('#f-email'), JANA.email, 60)
  await page.evaluate(() => document.activeElement && document.activeElement.blur())

  krok(5)
  await pauza(700)
  await dojed(page.locator('#spInc'), .5, 900)
  await pauza(500)
  for (let i = 1; i < MIST; i++) { await tukni(page.locator('#spInc')); await pauza(500) }
  await pauza(1300)

  krok(6)
  await pauza(600)
  await dojed(page.locator('#submitBtn'), .62, 1000)
  await pauza(400)
  await tukni(page.locator('#f-consent'))
  await pauza(900)
  await tukni(page.locator('#submitBtn'), { nav: true })
  await nactena('checkout.stripe.com')

  await platba(`${JANA.first} ${JANA.last}`, 'jogaskralicky.cz/rezervace', 7, 8)
  await page.getByText('Zaplaceno').first().waitFor({ timeout: 15000 })
  await page.evaluate(() => document.activeElement && document.activeElement.blur())
  await pauza(3200)

  krok(9)
  await oznameni(`Rezervace potvrzena — ${kdy(zvolena.starts_at, zvolena.duration_min)}`)
  await tukni(page.locator('#__notif'), { dojet: false })
  await page.goto(POSTA + SCENA)
  await nactena('posta')
  await ukazPrst()
  await pauza(2000)
  await dojed(page.locator('img[alt="QR kód"]'), .5, 2600)
  await pauza(3500)
}

async function platba(jmeno, zpet, nPlatba, nHotovo) {
  krok(nPlatba)
  // skutečná Stripe Checkout (sandbox) má pole #cardNumber… ; kopie stripe.html #cn…
  const S = process.env.STRIPE_URL
    ? { cislo: '#cardNumber', plat: '#cardExpiry', cvc: '#cardCvc', jmeno: '#billingName', zeme: '#billingCountry', zaplatit: 'button[type=submit]' }
    : { cislo: '#cn', plat: '#ce', cvc: '#cc', jmeno: '#nm', zeme: null, zaplatit: '#pay' }
  await page.locator(S.cislo).waitFor({ timeout: 30000 })
  await pauza(1800)
  await napis(page.locator(S.cislo), '4242424242424242', 70)
  await napis(page.locator(S.plat), '1228', 110)
  await napis(page.locator(S.cvc), '123', 110)
  await napis(page.locator(S.jmeno), jmeno, 70)
  if (S.zeme) {
    await tukni(page.locator(S.zeme))
    await pauza(300)
    await page.locator(S.zeme).selectOption('CZ')
    await pauza(900)
  }
  await page.evaluate(() => document.activeElement && document.activeElement.blur())
  await pauza(400)
  await tukni(page.locator(S.zaplatit).first())
  await page.waitForURL(/jogaskralicky\.cz/, { timeout: 40000 })
  await nactena(zpet)
  krok(nHotovo)
  await ukazPrst()
}

async function poukaz() {
  krok(1)
  adresa('jogaskralicky.cz')
  await page.goto(WEB + '/', { waitUntil: 'domcontentloaded' })
  await nactena()
  await pauza(2200)
  await ukazPrst()
  await pauza(700)

  krok(2)
  await pauza(900)
  await tukni(page.locator('.hero-actions a.hero-gift').first(), { nav: true })
  await nactena('jogaskralicky.cz/koupit-poukaz')

  krok(3)
  await pauza(1600)
  const klasik = page.locator('#druhy label.druh').first()
  await dojed(page.locator('#druhBox'), .45, 1300)
  await pauza(800)
  await tukni(klasik)
  await pauza(1500)

  krok(4)
  await pauza(500)
  await napis(page.locator('#email'), PETR.email, 65)
  await page.evaluate(() => document.activeElement && document.activeElement.blur())
  await pauza(900)

  krok(5)
  await pauza(900)
  await tukni(page.locator('#zaplatit'), { nav: true, pomer: .6 })
  await nactena('checkout.stripe.com')

  await platba('Petr Dvořák', 'jogaskralicky.cz/koupit-poukaz', 6, 7)
  await page.locator('.code-box').first().waitFor({ timeout: 15000 })
  await page.evaluate(() => document.activeElement && document.activeElement.blur())
  await pauza(3600)

  krok(8)
  await oznameni('Dárkový poukaz DK-KRALICEK')
  await tukni(page.locator('#__notif'), { dojet: false })
  await page.goto(POSTA + SCENA)
  await nactena('posta')
  await ukazPrst()
  await pauza(1800)
  await dojed(page.locator('#body table').nth(2), .45, 2200)
  await pauza(2400)
  await dojed(page.locator('#att'), .6, 1400)
  await pauza(500)
  await tukni(page.locator('#att'))
  await pauza(600)
  await page.evaluate(() => window.__prst.skryj())
  await pauza(4000)
}

await pauza(400)
udalosti.push({ t: ted(), typ: 'start' })
await (SCENA === 'poukaz' ? poukaz() : rezervace())
udalosti.push({ t: ted(), typ: 'konec' })
await pauza(300)
await cdp.send('Page.stopScreencast').catch(() => {})
await browser.close()

writeFileSync(join(OUT, 'udalosti.json'), JSON.stringify({ scena: SCENA, snimky, udalosti }, null, 1))
console.log(`${SCENA}: ${snimky.length} snímků, ${(udalosti.at(-1).t - udalosti[0].t).toFixed(1)} s`)
