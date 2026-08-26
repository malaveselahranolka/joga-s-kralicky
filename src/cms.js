
const params = new URLSearchParams(window.location.search)

// Editační režim (vizuální editace + časté dotazování na /api/content) se smí
// zapnout jen ve vlastním Studiu. Dřív stačilo, že je stránka v JAKÉMKOLI
// iframu — takže libovolný cizí web nás mohl vložit k sobě a rozjet nám
// dotaz na /api/content každou 1,5 s (~40 volání funkce za minutu na každý
// otevřený iframe), plus si nechat vykreslit editační atributy.
//
// Rámuje-li nás vlastní Studio, přijde same-origin referrer. Cizí web má
// jiný origin (a od zavedení X-Frame-Options: SAMEORIGIN nás vůbec nevloží).
function framedByOwnStudio() {
  if (window.self === window.top) return false
  try {
    return !!document.referrer &&
      new URL(document.referrer).origin === window.location.origin
  } catch (_e) {
    return false
  }
}

const editing = framedByOwnStudio() || params.has('visual-editing') || params.has('sanity-preview')
const studioUrl = `${window.location.origin}/studio`

const select = (selector, root = document) => root.querySelector(selector)
const selectAll = (selector, root = document) => [...root.querySelectorAll(selector)]
const clean = (value) => (value == null ? '' : String(value))

// Editor se natahuje AŽ V REŽIMU ÚPRAV a dynamickým importem, takže ho
// esbuild odloží do vlastního souboru. Veřejná návštěva si o něj nikdy
// neřekne — dřív ho stahoval každý (231 KB po síti, prakticky nevyužitých).
let editor = null

async function loadEditor() {
  try {
    editor = await import('@sanity/visual-editing')
    editor.enableVisualEditing({zIndex: 9999})
  } catch (error) {
    console.warn('Vizuální editaci se nepodařilo zapnout.', error)
    editor = null
  }
}

// data-sanity atributy jsou jen pro klikací překryv ve Studiu. Návštěvníkovi
// k ničemu nejsou, takže mu je do stránky nepíšeme.
function annotate(element, path) {
  if (!editing || !editor || !element || !path) return
  element.setAttribute('data-sanity', editor.createDataAttribute({
    id: 'siteContent',
    type: 'siteContent',
    path,
    baseUrl: studioUrl,
  }).toString())
}

function setText(target, value, path) {
  const element = typeof target === 'string' ? select(target) : target
  if (!element || value == null) return
  const nextValue = clean(value)
  if (element.textContent !== nextValue) element.textContent = nextValue
  annotate(element, path)
}

function setLeadingText(element, value, path) {
  if (!element || value == null) return
  const node = [...element.childNodes].find(
    (child) => child.nodeType === Node.TEXT_NODE && child.nodeValue.trim()
  )
  if (node) node.nodeValue = value
  else element.prepend(document.createTextNode(value))
  annotate(element, path)
}

// ---------------------------------------------------------------------
//  OBRÁZKY ZE SANITY
//  asset.url je originál tak, jak ho někdo nahrál — klidně 1536×2048.
//  Vykreslí se ale jako 48px ikona nebo 360px náhled. Sanity CDN umí
//  zmenšit, snížit kvalitu i vybrat formát (auto=format → WebP/AVIF)
//  přímo v adrese, takže ke každému obrázku dopíšeme žebříček šířek
//  a prohlížeč si podle sizes vezme jen tu, kterou fakt potřebuje.
//
//  fit=max = nikdy nezvětšovat nad originál a nezasahovat do ořezu.
// ---------------------------------------------------------------------
const SANITY_CDN = 'https://cdn.sanity.io/'
const isSanity = (url) => typeof url === 'string' && url.startsWith(SANITY_CDN)

function sizedUrl(url, width) {
  if (!isSanity(url)) return url
  return `${url}?w=${width}&q=62&auto=format&fit=max`
}

function srcsetFor(url, widths) {
  if (!isSanity(url)) return ''
  return widths.map((w) => `${sizedUrl(url, w)} ${w}w`).join(', ')
}

// Kdyby přišel obrázek odjinud než ze Sanity, srcset se nenastaví a chová
// se to přesně jako dřív — jen se nic nezmenší.
//  VÝMĚNA AŽ PO DEKÓDOVÁNÍ
//
//  Dřív se `element.src` přepsalo rovnou. Prohlížeč tím dostal obrázek,
//  který ještě nemá vykreslený, a na okamžik nechal na jeho místě prázdno.
//  U hlavní fotky na domovské stránce to Chrome počítal jako posun
//  rozvržení a vyrobilo to CLS 0,65 při limitu 0,10 — tedy propadlé
//  Core Web Vitals na celém webu.
//
//  Naměřeno: /api/content dorazilo v 506 ms, fotka ze Sanity v 586 ms,
//  posun nastal v 617 ms. Přímá souvislost.
//
//  Teď se nová fotka natáhne a dekóduje mimo stránku a do DOM se dosadí
//  až hotová. Do té doby v layoutu zůstává ta z HTML, takže není co
//  posunout. Když dekódování selže (starý prohlížeč, chyba sítě),
//  dosadíme ji stejně — horší je žádná fotka než posun.
function setImage(element, image, alt, path, opts = {}) {
  const url = image?.asset?.url
  if (!element || !url) return
  const widths = opts.widths || [400, 800, 1200]
  const src = sizedUrl(url, widths[widths.length - 1])
  const set = srcsetFor(url, widths)
  const sizes = opts.sizes || '100vw'

  if (alt != null) element.alt = clean(alt)
  annotate(element, path)

  // Stejná fotka už tam je — nesahat na ni.
  if (element.getAttribute('src') === src) return

  const dosadit = () => {
    element.src = src
    if (set) {
      element.srcset = set
      element.sizes = sizes
    }
  }

  // Čekáme na `onload`, ne na `decode()`.
  //
  // decode() vypadá jako správný nástroj, ale u obrázku, který není
  // v dokumentu, a k tomu se `srcset`, se v prohlížečích na Chromiu
  // nedočkáte — obrázek se stáhne (complete = true, naturalWidth sedí),
  // jenže slib nikdy nedoběhne ani neselže. Ověřeno na živém webu:
  // decode() vypršelo po 4 s, zatímco onload doběhl normálně.
  //
  // Stálo to za to zjistit: první verze téhle opravy na decode() čekala,
  // takže se ŽÁDNÁ fotka z CMS nedosadila. CLS sice spadlo na nulu, ale
  // jen proto, že se nic neměnilo.
  //
  // onload stačí: v tu chvíli je obrázek stažený a rozměry známé, takže
  // dosazení do stránky vykreslí rovnou z cache, bez prázdného okamžiku.
  let hotovo = false
  const dosaditJednou = () => {
    if (hotovo) return
    hotovo = true
    dosadit()
  }

  const predloha = new Image()
  if (set) {
    predloha.srcset = set
    predloha.sizes = sizes
  }
  predloha.onload = dosaditJednou
  predloha.onerror = dosaditJednou
  // Pojistka: kdyby se obrázek zasekl na síti, ať kvůli němu fotka z CMS
  // nezůstane nedosazená navždy. Posun rozvržení je pak menší zlo.
  setTimeout(dosaditJednou, 8000)
  predloha.src = src
}

function itemPath(field, item, child) {
  return `${field}[_key=="${item._key}"]${child ? `.${child}` : ''}`
}

function setMeta(selector, value, attribute = 'content') {
  const element = select(selector)
  if (element && value != null) element.setAttribute(attribute, clean(value))
}

// ---------------------------------------------------------------------
//  POZOR NA DVA ZDROJE TEXTU
//
//  Každý text níž je na webu dvakrát: jednou napsaný v index.html a jednou
//  uložený v Sanity. Prohlížeč nejdřív vykreslí HTML a pak ho přepíše tím,
//  co přijde z CMS. Když se ty dvě verze rozejdou, vyhraje CMS — ale jen
//  v prohlížeči. Vyhledávače a náhledy na sociálních sítích vidí HTML,
//  protože se k nim CMS vůbec nedostane.
//
//  V srpnu 2026 kvůli tomu web ukazoval 75 minut a max 12 míst, i když
//  v HTML už bylo správně 60 minut a max 10 míst.
//
//  Když měníš text v HTML, srovnej ho i v Sanity:
//      npm run sync-content              ukáže, co se rozešlo
//      npm run sync-content -- --write   srovná to
// ---------------------------------------------------------------------

function applyContent(data) {
  if (!data) return

  document.title = clean(data.pageTitle) || document.title
  setMeta('meta[name="description"]', data.pageDescription)
  setMeta('meta[property="og:title"]', data.pageTitle)
  setMeta('meta[property="og:description"]', data.shareDescription)
  setMeta('meta[property="og:image"]', data.shareImage?.asset?.url)

  setText('.hero-eyebrow', data.heroLocation, 'heroLocation')
  setText('[data-cms="hero-title-start"]', data.heroTitleStart, 'heroTitleStart')
  setText('[data-cms="hero-title-end"]', data.heroTitleEnd, 'heroTitleEnd')
  setText('.hero-sub', data.heroSubtitle, 'heroSubtitle')
  setImage(select('.hero-bg img'), data.heroImage, 'Hlavní fotografie lekce jógy', 'heroImage',
    {widths: [640, 960, 1280, 1920], sizes: '100vw'})
  selectAll('.hero-deck img').forEach((image, index) => {
    const item = data.heroDeck?.[index]
    if (item) setImage(image, item, '', itemPath('heroDeck', item, 'asset'),
      {widths: [150, 220, 320, 460], sizes: '(max-width: 980px) 130px, 152px'})
  })

  setText('.nav-cta', data.navReservationLabel, 'navReservationLabel')
  selectAll('.menu-cta, .community .btn-light, .visit-actions .btn-primary').forEach((button) =>
    setLeadingText(button, `${data.reservationLabel || 'Rezervovat lekci'} `, 'reservationLabel'),
  )

  selectAll('.proof .pstat').forEach((card, index) => {
    const item = data.stats?.[index]
    if (!item) return
    setText(select('.num', card), item.number, itemPath('stats', item, 'number'))
    setText(select('.lbl', card), item.label, itemPath('stats', item, 'label'))
  })
  setText('.proof-note', data.proofNote, 'proofNote')

  setText('.reasons .section-head .eyebrow', data.reasonsEyebrow, 'reasonsEyebrow')
  setText('.reasons .section-head h2', data.reasonsTitle, 'reasonsTitle')
  setText('.reasons .section-head .lead', data.reasonsLead, 'reasonsLead')
  selectAll('.rpanel').forEach((panel, index) => {
    const item = data.reasons?.[index]
    if (!item) return
    const base = itemPath('reasons', item)
    setText(select('.rp-label', panel), item.label, `${base}.label`)
    setText(select('h3', panel), item.title, `${base}.title`)
    setText(select('.rp-text p', panel), item.body, `${base}.body`)
    setImage(select('.rp-pic img', panel), item.image, item.alt, `${base}.image`,
      {widths: [420, 630, 840, 1260], sizes: '(max-width: 900px) 92vw, 440px'})
  })

  setText('.lessons .section-head h2', data.lessonsTitle, 'lessonsTitle')
  setText('.lessons .section-head .lead', data.lessonsLead, 'lessonsLead')
  selectAll('.lesson').forEach((card, index) => {
    const item = data.lessons?.[index]
    if (!item) return
    const base = itemPath('lessons', item)
    setText(select('.l-tag', card), item.tag, `${base}.tag`)
    setText(select('.l-top h3', card), item.title, `${base}.title`)
    setText(select('.l-price', card), item.price, `${base}.price`)
    selectAll('.l-meta li', card).forEach((element, metaIndex) => {
      if (item.meta?.[metaIndex] != null) setText(element, item.meta[metaIndex], `${base}.meta[${metaIndex}]`)
    })
    setText(select('.l-desc', card), item.description, `${base}.description`)
    selectAll('.l-run > div', card).forEach((row, rowIndex) => {
      const timeline = item.timeline?.[rowIndex]
      if (!timeline) return
      const rowBase = `${base}.timeline[_key=="${timeline._key}"]`
      setText(select('b', row), timeline.time, `${rowBase}.time`)
      setText(select('span', row), timeline.text, `${rowBase}.text`)
    })
    setLeadingText(select('.l-cta a', card), `${item.buttonLabel} `, `${base}.buttonLabel`)
    setImage(select('.l-pic img', card), item.image, item.alt, `${base}.image`,
      {widths: [440, 660, 880, 1320], sizes: '(max-width: 900px) 92vw, 460px'})
  })

  setText('.gal-intro h2', data.galleryTitle, 'galleryTitle')
  setText('.gal-intro .lead', data.galleryLead, 'galleryLead')
  setText('.gal-hint', data.galleryHint, 'galleryHint')
  setLeadingText(select('.gal-foot .btn'), `${data.galleryButtonLabel || 'Chci je poznat'} `, 'galleryButtonLabel')
  selectAll('.gal-track .rshot').forEach((button, index) => {
    const item = data.galleryItems?.[index]
    if (!item) return
    const base = itemPath('galleryItems', item)
    const image = select('img', button)
    setImage(image, item.image, item.alt, `${base}.image`,
      {widths: [400, 560, 800, 1200], sizes: '(max-width: 720px) 70vw, 400px'})
    // lightbox ukazuje fotku přes celou obrazovku, ale 1600 px stačí i na
    // retinu — originál 1536×2048 by byl jen zbytečně těžký
    button.dataset.full = clean(sizedUrl(item.image?.asset?.url, 1600))
    annotate(button, `${base}.image`)
    const note = button.closest('.gal-big')?.querySelector('.bun-note')
    if (note && item.note) setText(note, item.note, `${base}.note`)
  })

  setText('.reference .section-head h2', data.referencesTitle, 'referencesTitle')
  setText('.reference .section-head .lead', data.referencesLead, 'referencesLead')
  selectAll('.tcard').forEach((card, index) => {
    const item = data.testimonials?.[index]
    if (!item) return
    const base = itemPath('testimonials', item)
    setText(select('.quote', card), item.quote, `${base}.quote`)
    const who = select('.who', card)
    setLeadingText(who, item.name, `${base}.name`)
    setText(select('.who span', card), item.detail, `${base}.detail`)
    if (item.image) setImage(select('.pic img', card), item.image, item.alt, `${base}.image`,
      {widths: [160, 320, 480], sizes: '160px'})
  })

  setText('.community .eyebrow', data.communityEyebrow, 'communityEyebrow')
  setText('.community h2', data.communityTitle, 'communityTitle')
  setText('.community .wrap > p:not(.community-note):not(.cta-nudge)', data.communityBody, 'communityBody')
  setText('.community-note', data.communityNote, 'communityNote')
  selectAll('.community-faces img').forEach((image, index) => {
    const item = data.communityFaces?.[index]
    if (item) setImage(image, item, '', itemPath('communityFaces', item, 'asset'),
      {widths: [48, 96, 144], sizes: '48px'})
  })
  const nudge = select('.cta-nudge')
  if (nudge) {
    setLeadingText(nudge, `${data.communityNudge || 'Ještě otázky?'} `, 'communityNudge')
    setText(select('a', nudge), data.communityNudgeLink, 'communityNudgeLink')
  }

  setText('.faq .section-head h2', data.faqTitle, 'faqTitle')
  setText('[data-cms="faq-intro"]', data.faqIntro, 'faqIntro')
  setLeadingText(select('.faq-cue'), ` ${data.faqCue || 'Rozklikněte kteroukoliv otázku'}`, 'faqCue')
  selectAll('.faq-item').forEach((itemElement, index) => {
    const item = data.faqs?.[index]
    if (!item) return
    const base = itemPath('faqs', item)
    setLeadingText(select('.faq-q', itemElement), item.question, `${base}.question`)
    setText(select('.faq-a p', itemElement), item.answer, `${base}.answer`)
  })

  setText('.visit .section-head h2', data.contactTitle, 'contactTitle')
  setText('.visit .section-head .lead', data.contactLead, 'contactLead')
  const address = select('.visit-addr')
  setLeadingText(address, data.studioName, 'studioName')
  setText(select('.visit-addr span'), data.studioAddress, 'studioAddress')
  const emailLinks = selectAll('a[href^="mailto:"]')
  emailLinks.forEach((link) => {
    link.href = `mailto:${clean(data.contactEmail)}`
    if (link.closest('.contact-list') || link.classList.contains('foot-contact')) setLeadingText(link, clean(data.contactEmail), 'contactEmail')
  })
  const phoneLinks = selectAll('a[href^="tel:"]')
  phoneLinks.forEach((link) => {
    const rawPhone = clean(data.contactPhone)
    link.href = `tel:${rawPhone.replace(/\s+/g, '')}`
    if (link.closest('.contact-list') || link.classList.contains('foot-contact')) setLeadingText(link, rawPhone, 'contactPhone')
  })
  setLeadingText(select('.contact-list .plain'), ` ${data.contactSchedule || ''}`, 'contactSchedule')

  setText('.ftag', data.footerTagline, 'footerTagline')
  setText('.fn-text h5', data.newsletterTitle, 'newsletterTitle')
  setText('[data-cms="newsletter-text"]', data.newsletterText, 'newsletterText')
  setText('.foot-bottom > span:first-child', data.copyright, 'copyright')

  document.documentElement.dataset.cmsReady = 'true'
  window.dispatchEvent(new CustomEvent('cms:loaded', {detail: data}))
}

async function loadContent() {
  try {
    // V editačním režimu chceme vždy čerstvá data, jinak si necháme
    // posloužit edge cache (viz Cache-Control v api/content.js).
    const response = await fetch(editing ? '/api/content?preview=1' : '/api/content', {
      cache: editing ? 'no-store' : 'default',
      credentials: 'same-origin',
    })
    if (!response.ok) throw new Error(`CMS API odpovědělo ${response.status}`)
    const data = await response.json()
    applyContent(data)
  } catch (error) {
    console.warn('CMS obsah se nepodařilo načíst; zůstává bezpečný obsah z HTML.', error)
  }
}

// V režimu úprav musí být editor načtený DŘÍV, než se obsah vykreslí —
// jinak by prvky z prvního průchodu zůstaly bez data-sanity a nešly by
// ve Studiu naklikat.
if (editing) {
  loadEditor().then(() => {
    loadContent()
    window.setInterval(() => {
      if (document.visibilityState === 'visible') loadContent()
    }, 1500)
  })
} else {
  loadContent()
}
