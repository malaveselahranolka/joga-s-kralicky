// ---------------------------------------------------------------------
//  OBSAH → HTML (při buildu, ne v prohlížeči)
//
//  Dřív se obsah dotahoval ze Sanity až v prohlížeči a přepisoval text
//  z HTML. Vyhledávače a náhledy na sítích proto viděly jinou verzi než
//  návštěvník a obě verze se tiše rozcházely.
//
//  Teď je zdroj pravdy content/obsah.json v repozitáři. Vsadí se sem
//  při buildu, takže odeslané HTML už je finální — pro člověka, robota
//  i pro prohlížeč bez JS je to totéž.
// ---------------------------------------------------------------------
import {parse} from 'node-html-parser'

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Nezlomitelná mezera před „Kč" se v JSON nedrží (je to obyčejná mezera),
// ale v sazbě ji chceme — jinak cena spadne na další řádek sama.
const sazba = (s) => esc(s).replace(/(\d)\s(Kč)/g, '$1&nbsp;$2')

function text(root, selector, value) {
  if (value == null) return
  const el = root.querySelector(selector)
  if (el) el.set_content(sazba(value))
}

// Prvky, kde za textem následuje ještě šipka nebo odkaz: měníme jen
// úvodní textový uzel, zbytek značek zůstane nedotčený.
function leadingText(root, selector, value) {
  if (value == null) return
  const el = root.querySelector(selector)
  if (!el) return
  const node = el.childNodes.find((n) => n.nodeType === 3 && n.rawText.trim())
  if (node) node.rawText = `${esc(value)} `
}

function image(root, selector, src, alt) {
  const el = root.querySelector(selector)
  if (!el) return
  if (src) el.setAttribute('src', src)
  if (alt != null) el.setAttribute('alt', esc(alt))
}

export function obsahDoHtml(html, o) {
  const root = parse(html, {comment: true})

  text(root, 'title', o.pageTitle)
  const meta = (sel, value) => {
    const el = root.querySelector(sel)
    if (el && value != null) el.setAttribute('content', esc(value))
  }
  meta('meta[name="description"]', o.pageDescription)
  meta('meta[property="og:title"]', o.pageTitle)
  meta('meta[property="og:description"]', o.shareDescription)
  meta('meta[name="twitter:description"]', o.shareDescription)

  text(root, '.hero-eyebrow', o.heroLocation)
  text(root, '[data-cms="hero-title-start"]', o.heroTitleStart)
  text(root, '[data-cms="hero-title-end"]', o.heroTitleEnd)
  text(root, '.hero-sub', o.heroSubtitle)
  image(root, '.hero-bg img', o.heroImage, o.heroImageAlt)
  const heroPreload = root.querySelector('link[rel="preload"][media="(min-width: 641px)"]')
  if (heroPreload && o.heroImage) heroPreload.setAttribute('href', o.heroImage)

  // Fotka na telefon má vlastní <source>. Menší varianta je nepovinná —
  // po výměně ve správě přijde jen jeden soubor a použije se na obě šířky.
  if (o.heroImageMobile) {
    const maly = o.heroImageMobileSmall
    const srcset = maly
      ? `${maly} 750w, ${o.heroImageMobile} 1100w`
      : o.heroImageMobile
    const zdroj = root.querySelector('.hero-bg source')
    if (zdroj) zdroj.setAttribute('srcset', srcset)
    const mobilPreload = root.querySelector('link[rel="preload"][media="(max-width: 640px)"]')
    if (mobilPreload) {
      mobilPreload.setAttribute('href', maly || o.heroImageMobile)
      mobilPreload.setAttribute('imagesrcset', srcset)
    }
  }

  root.querySelectorAll('.hero-deck img').forEach((img, i) => {
    const item = o.heroDeck?.[i]
    if (!item) return
    if (item.image) img.setAttribute('src', item.image)
    if (item.alt != null) img.setAttribute('alt', esc(item.alt))
  })

  text(root, '.reasons .section-head .eyebrow', o.reasonsEyebrow)
  text(root, '.reasons .section-head h2', o.reasonsTitle)
  text(root, '.reasons .section-head .lead', o.reasonsLead)
  root.querySelectorAll('.rpanel').forEach((panel, i) => {
    const item = o.reasons?.[i]
    if (!item) return
    const label = panel.querySelector('.rp-label')
    if (label && item.label != null) label.set_content(esc(item.label))
    const title = panel.querySelector('h3')
    if (title && item.title != null) title.set_content(esc(item.title))
    const body = panel.querySelector('.rp-text p')
    if (body && item.body != null) body.set_content(sazba(item.body))
    const img = panel.querySelector('.rp-pic img')
    if (img) {
      if (item.image) img.setAttribute('src', item.image)
      if (item.alt != null) img.setAttribute('alt', esc(item.alt))
    }
  })

  text(root, '.lessons .section-head h2', o.lessonsTitle)
  text(root, '.lessons .section-head .lead', o.lessonsLead)
  root.querySelectorAll('.lesson').forEach((card, i) => {
    const item = o.lessons?.[i]
    if (!item) return
    const tag = card.querySelector('.l-tag')
    if (tag && item.tag != null) tag.set_content(esc(item.tag))
    const title = card.querySelector('.l-top h3')
    if (title && item.title != null) title.set_content(esc(item.title))
    const price = card.querySelector('.l-price')
    if (price && item.price != null) price.set_content(sazba(item.price))
    card.querySelectorAll('.l-meta li').forEach((li, mi) => {
      if (item.meta?.[mi] != null) li.set_content(esc(item.meta[mi]))
    })
    const desc = card.querySelector('.l-desc')
    if (desc && item.description != null) desc.set_content(sazba(item.description))
    card.querySelectorAll('.l-run > div').forEach((row, ri) => {
      const t = item.timeline?.[ri]
      if (!t) return
      const time = row.querySelector('b')
      if (time && t.time != null) time.set_content(esc(t.time))
      const span = row.querySelector('span')
      if (span && t.text != null) span.set_content(esc(t.text))
    })
    const cta = card.querySelector('.l-cta a')
    if (cta && item.buttonLabel != null) {
      const node = cta.childNodes.find((n) => n.nodeType === 3 && n.rawText.trim())
      if (node) node.rawText = `${esc(item.buttonLabel)} `
    }
    const img = card.querySelector('.l-pic img')
    if (img) {
      if (item.image) img.setAttribute('src', item.image)
      if (item.alt != null) img.setAttribute('alt', esc(item.alt))
    }
  })

  image(root, '.gift-photo', o.giftImage, o.giftImageAlt)

  text(root, '.gal-intro h2', o.galleryTitle)
  text(root, '.gal-intro .lead', o.galleryLead)
  text(root, '.gal-hint', o.galleryHint)
  leadingText(root, '.gal-foot .btn', o.galleryButtonLabel)

  // Náhled v pásu a fotka v lightboxu jsou dva různé soubory (menší a plná
  // verze). Když se v CMS vymění fotka, přijde jen jeden soubor — použije se
  // na obojí, takže se lightbox nikdy neotevře s cizí fotkou.
  root.querySelectorAll('.gal-track .rshot').forEach((button, i) => {
    const item = o.galleryItems?.[i]
    if (!item) return
    const img = button.querySelector('img')
    if (img) {
      if (item.image) img.setAttribute('src', item.image)
      if (item.alt != null) img.setAttribute('alt', esc(item.alt))
    }
    const plna = item.full || item.image
    if (plna) button.setAttribute('data-full', plna)
  })

  text(root, '.community .eyebrow', o.communityEyebrow)
  text(root, '.community h2', o.communityTitle)
  text(root, '.community .wrap > p:not(.community-note):not(.cta-nudge)', o.communityBody)
  text(root, '.community-note', o.communityNote)
  root.querySelectorAll('.community-faces img').forEach((img, i) => {
    const item = o.communityFaces?.[i]
    if (item?.image) img.setAttribute('src', item.image)
  })
  leadingText(root, '.cta-nudge', o.communityNudge)
  text(root, '.cta-nudge a', o.communityNudgeLink)

  text(root, '.faq .section-head h2', o.faqTitle)
  text(root, '[data-cms="faq-intro"]', o.faqIntro)
  root.querySelectorAll('.faq-item').forEach((item, i) => {
    const faq = o.faqs?.[i]
    if (!faq) return
    const q = item.querySelector('.faq-q')
    if (q && faq.question != null) {
      const node = q.childNodes.find((n) => n.nodeType === 3 && n.rawText.trim())
      if (node) node.rawText = esc(faq.question)
    }
    const a = item.querySelector('.faq-a p')
    if (a && faq.answer != null) a.set_content(sazba(faq.answer))
  })

  text(root, '.visit .section-head h2', o.contactTitle)
  text(root, '.visit .section-head .lead', o.contactLead)
  const addr = root.querySelector('.visit-addr')
  if (addr && o.studioName != null) {
    const node = addr.childNodes.find((n) => n.nodeType === 3 && n.rawText.trim())
    if (node) node.rawText = esc(o.studioName)
  }
  text(root, '.visit-addr span', o.studioAddress)
  if (o.contactSchedule != null) {
    const plain = root.querySelector('.contact-list .plain')
    if (plain) {
      const node = plain.childNodes.find((n) => n.nodeType === 3 && n.rawText.trim())
      if (node) node.rawText = ` ${esc(o.contactSchedule)}`
    }
  }
  if (o.contactEmail) {
    root.querySelectorAll('a[href^="mailto:"]').forEach((a) => {
      a.setAttribute('href', `mailto:${o.contactEmail}`)
      if (a.classList.contains('foot-contact') || a.closest('.contact-list')) {
        const node = a.childNodes.find((n) => n.nodeType === 3 && n.rawText.trim())
        if (node) node.rawText = `\n              ${esc(o.contactEmail)}\n            `
      }
    })
  }
  if (o.contactPhone) {
    root.querySelectorAll('a[href^="tel:"]').forEach((a) => {
      a.setAttribute('href', `tel:${o.contactPhone.replace(/\s+/g, '')}`)
      if (a.classList.contains('foot-contact') || a.closest('.contact-list')) {
        const node = a.childNodes.find((n) => n.nodeType === 3 && n.rawText.trim())
        if (node) node.rawText = `\n              ${esc(o.contactPhone)}\n            `
      }
    })
  }

  text(root, '.ftag', o.footerTagline)
  text(root, '.fn-text h3', o.newsletterTitle)
  text(root, '[data-cms="newsletter-text"]', o.newsletterText)
  text(root, '.foot-bottom > span:first-child', o.copyright)

  return root.toString()
}
