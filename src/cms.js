import {createDataAttribute, enableVisualEditing} from '@sanity/visual-editing'

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

function editAttribute(path) {
  return createDataAttribute({
    id: 'siteContent',
    type: 'siteContent',
    path,
    baseUrl: studioUrl,
  }).toString()
}

function annotate(element, path) {
  if (element && path) element.setAttribute('data-sanity', editAttribute(path))
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

function setImage(element, image, alt, path) {
  const url = image?.asset?.url
  if (!element || !url) return
  element.src = clean(url)
  if (alt != null) element.alt = clean(alt)
  annotate(element, path)
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
  setImage(select('.hero-bg img'), data.heroImage, 'Hlavní fotografie lekce jógy', 'heroImage')
  selectAll('.hero-deck img').forEach((image, index) => {
    const item = data.heroDeck?.[index]
    if (item) setImage(image, item, '', itemPath('heroDeck', item, 'asset'))
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
    setImage(select('.rp-pic img', panel), item.image, item.alt, `${base}.image`)
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
    setImage(select('.l-pic img', card), item.image, item.alt, `${base}.image`)
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
    setImage(image, item.image, item.alt, `${base}.image`)
    button.dataset.full = clean(item.image?.asset?.url)
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
    if (item.image) setImage(select('.pic img', card), item.image, item.alt, `${base}.image`)
  })

  setText('.community .eyebrow', data.communityEyebrow, 'communityEyebrow')
  setText('.community h2', data.communityTitle, 'communityTitle')
  setText('.community .wrap > p:not(.community-note):not(.cta-nudge)', data.communityBody, 'communityBody')
  setText('.community-note', data.communityNote, 'communityNote')
  selectAll('.community-faces img').forEach((image, index) => {
    const item = data.communityFaces?.[index]
    if (item) setImage(image, item, '', itemPath('communityFaces', item, 'asset'))
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
    const response = await fetch('/api/content', {cache: 'no-store', credentials: 'same-origin'})
    if (!response.ok) throw new Error(`CMS API odpovědělo ${response.status}`)
    const data = await response.json()
    applyContent(data)
  } catch (error) {
    console.warn('CMS obsah se nepodařilo načíst; zůstává bezpečný obsah z HTML.', error)
  }
}

loadContent()

if (editing) {
  window.setInterval(() => {
    if (document.visibilityState === 'visible') loadContent()
  }, 1500)
}

if (editing) {
  enableVisualEditing({zIndex: 9999})
}
