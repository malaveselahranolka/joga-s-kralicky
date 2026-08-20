import {defineArrayMember, defineField, defineType} from 'sanity'

const requiredText = (rule) => rule.required().min(1)
const requiredImage = (rule) => rule.required()

const imageField = (name, title, group) =>
  defineField({
    name,
    title,
    type: 'image',
    group,
    options: {hotspot: true},
    validation: requiredImage,
  })

const textField = (name, title, group, rows = 1) =>
  defineField({
    name,
    title,
    type: rows > 1 ? 'text' : 'string',
    rows: rows > 1 ? rows : undefined,
    group,
    validation: requiredText,
  })

const timelineMember = defineArrayMember({
  name: 'timelineItem',
  title: 'Část lekce',
  type: 'object',
  fields: [
    defineField({name: 'time', title: 'Čas', type: 'string', validation: requiredText}),
    defineField({name: 'text', title: 'Popis', type: 'string', validation: requiredText}),
  ],
  preview: {select: {title: 'time', subtitle: 'text'}},
})

export const siteContent = defineType({
  name: 'siteContent',
  title: 'Obsah webu',
  type: 'document',
  groups: [
    {name: 'seo', title: 'SEO'},
    {name: 'hero', title: 'Úvod'},
    {name: 'proof', title: 'Čísla'},
    {name: 'reasons', title: 'Proč se vracejí'},
    {name: 'lessons', title: 'Lekce'},
    {name: 'gallery', title: 'Galerie'},
    {name: 'references', title: 'Reference'},
    {name: 'community', title: 'Výzva'},
    {name: 'faq', title: 'FAQ'},
    {name: 'contact', title: 'Kontakt'},
    {name: 'footer', title: 'Patička'},
  ],
  fields: [
    textField('pageTitle', 'Titulek stránky', 'seo'),
    textField('pageDescription', 'Popis pro vyhledávače', 'seo', 3),
    textField('shareDescription', 'Popis při sdílení', 'seo', 2),
    imageField('shareImage', 'Obrázek při sdílení', 'seo'),

    textField('navReservationLabel', 'Krátké tlačítko rezervace', 'hero'),
    textField('reservationLabel', 'Hlavní tlačítko rezervace', 'hero'),
    textField('heroLocation', 'Místo nad nadpisem', 'hero'),
    textField('heroTitleStart', 'Nadpis před pomlčkou', 'hero'),
    textField('heroTitleEnd', 'Nadpis za pomlčkou', 'hero'),
    textField('heroSubtitle', 'Úvodní text', 'hero', 3),
    imageField('heroImage', 'Hlavní fotografie', 'hero'),
    defineField({
      name: 'heroDeck',
      title: 'Tři fotografie králíčků',
      type: 'array',
      group: 'hero',
      of: [defineArrayMember({type: 'image', options: {hotspot: true}})],
      validation: (rule) => rule.required().length(3),
    }),

    defineField({
      name: 'stats',
      title: 'Čísla studia',
      type: 'array',
      group: 'proof',
      of: [
        defineArrayMember({
          type: 'object',
          fields: [
            defineField({name: 'number', title: 'Číslo', type: 'string', validation: requiredText}),
            defineField({name: 'label', title: 'Popisek', type: 'string', validation: requiredText}),
          ],
          preview: {select: {title: 'number', subtitle: 'label'}},
        }),
      ],
      validation: (rule) => rule.required().length(4),
    }),
    textField('proofNote', 'Poznámka pod čísly', 'proof', 2),

    textField('reasonsEyebrow', 'Malý nadpis', 'reasons'),
    textField('reasonsTitle', 'Nadpis sekce', 'reasons', 2),
    textField('reasonsLead', 'Úvod sekce', 'reasons', 2),
    defineField({
      name: 'reasons',
      title: 'Čtyři důvody',
      type: 'array',
      group: 'reasons',
      of: [
        defineArrayMember({
          type: 'object',
          fields: [
            defineField({name: 'label', title: 'Štítek', type: 'string', validation: requiredText}),
            defineField({name: 'title', title: 'Nadpis', type: 'string', validation: requiredText}),
            defineField({name: 'body', title: 'Text', type: 'text', rows: 3, validation: requiredText}),
            defineField({name: 'image', title: 'Fotografie', type: 'image', options: {hotspot: true}, validation: requiredImage}),
            defineField({name: 'alt', title: 'Popis fotografie', type: 'string', validation: requiredText}),
          ],
          preview: {select: {title: 'title', subtitle: 'label', media: 'image'}},
        }),
      ],
      validation: (rule) => rule.required().length(4),
    }),

    textField('lessonsTitle', 'Nadpis sekce', 'lessons', 2),
    textField('lessonsLead', 'Úvod sekce', 'lessons', 3),
    defineField({
      name: 'lessons',
      title: 'Dvě lekce',
      type: 'array',
      group: 'lessons',
      of: [
        defineArrayMember({
          type: 'object',
          fields: [
            defineField({name: 'tag', title: 'Štítek', type: 'string', validation: requiredText}),
            defineField({name: 'title', title: 'Název', type: 'string', validation: requiredText}),
            defineField({name: 'price', title: 'Cena', type: 'string', validation: requiredText}),
            defineField({name: 'meta', title: 'Rychlé informace', type: 'array', of: [{type: 'string'}], validation: (rule) => rule.required().length(4)}),
            defineField({name: 'description', title: 'Popis', type: 'text', rows: 3, validation: requiredText}),
            defineField({name: 'timeline', title: 'Průběh', type: 'array', of: [timelineMember], validation: (rule) => rule.required().length(3)}),
            defineField({name: 'buttonLabel', title: 'Text tlačítka', type: 'string', validation: requiredText}),
            defineField({name: 'image', title: 'Fotografie', type: 'image', options: {hotspot: true}, validation: requiredImage}),
            defineField({name: 'alt', title: 'Popis fotografie', type: 'string', validation: requiredText}),
          ],
          preview: {select: {title: 'title', subtitle: 'tag', media: 'image'}},
        }),
      ],
      validation: (rule) => rule.required().length(2),
    }),

    textField('galleryTitle', 'Nadpis sekce', 'gallery'),
    textField('galleryLead', 'Úvod sekce', 'gallery', 2),
    textField('galleryHint', 'Nápověda ke scrollování', 'gallery'),
    textField('galleryButtonLabel', 'Tlačítko pod galerií', 'gallery'),
    defineField({
      name: 'galleryItems',
      title: 'Fotografie v galerii',
      type: 'array',
      group: 'gallery',
      of: [
        defineArrayMember({
          type: 'object',
          fields: [
            defineField({name: 'caption', title: 'Popisek v náhledu', type: 'string', validation: requiredText}),
            defineField({name: 'note', title: 'Text pod velkou fotografií', type: 'text', rows: 2}),
            defineField({name: 'image', title: 'Fotografie', type: 'image', options: {hotspot: true}, validation: requiredImage}),
            defineField({name: 'alt', title: 'Popis fotografie', type: 'string', validation: requiredText}),
          ],
          preview: {select: {title: 'caption', subtitle: 'note', media: 'image'}},
        }),
      ],
      validation: (rule) => rule.required().length(12),
    }),

    textField('referencesTitle', 'Nadpis sekce', 'references'),
    textField('referencesLead', 'Úvod sekce', 'references', 2),
    defineField({
      name: 'testimonials',
      title: 'Reference',
      type: 'array',
      group: 'references',
      of: [
        defineArrayMember({
          type: 'object',
          fields: [
            defineField({name: 'quote', title: 'Citace', type: 'text', rows: 3, validation: requiredText}),
            defineField({name: 'name', title: 'Jméno', type: 'string', validation: requiredText}),
            defineField({name: 'detail', title: 'Doplnění', type: 'string', validation: requiredText}),
            defineField({name: 'image', title: 'Fotografie (první karta ji nepotřebuje)', type: 'image', options: {hotspot: true}}),
            defineField({name: 'alt', title: 'Popis fotografie', type: 'string'}),
          ],
          preview: {select: {title: 'name', subtitle: 'detail', media: 'image'}},
        }),
      ],
      validation: (rule) => rule.required().length(5),
    }),

    textField('communityEyebrow', 'Malý nadpis', 'community'),
    textField('communityTitle', 'Nadpis', 'community', 2),
    textField('communityBody', 'Text', 'community', 3),
    textField('communityNote', 'Řádek pod fotografiemi', 'community'),
    textField('communityNudge', 'Text před odkazem na FAQ', 'community'),
    textField('communityNudgeLink', 'Text odkazu na FAQ', 'community'),
    defineField({
      name: 'communityFaces',
      title: 'Čtyři malé fotografie',
      type: 'array',
      group: 'community',
      of: [defineArrayMember({type: 'image', options: {hotspot: true}})],
      validation: (rule) => rule.required().length(4),
    }),

    textField('faqTitle', 'Nadpis sekce', 'faq'),
    textField('faqIntro', 'Úvod před e-mailem', 'faq', 2),
    textField('faqCue', 'Nápověda', 'faq'),
    defineField({
      name: 'faqs',
      title: 'Otázky a odpovědi',
      type: 'array',
      group: 'faq',
      of: [
        defineArrayMember({
          type: 'object',
          fields: [
            defineField({name: 'question', title: 'Otázka', type: 'string', validation: requiredText}),
            defineField({name: 'answer', title: 'Odpověď', type: 'text', rows: 4, validation: requiredText}),
          ],
          preview: {select: {title: 'question', subtitle: 'answer'}},
        }),
      ],
      validation: (rule) => rule.required().length(6),
    }),

    textField('contactTitle', 'Nadpis sekce', 'contact'),
    textField('contactLead', 'Úvod sekce', 'contact', 3),
    textField('studioName', 'Název studia', 'contact'),
    textField('studioAddress', 'Adresa', 'contact'),
    defineField({name: 'contactEmail', title: 'E-mail', type: 'string', group: 'contact', validation: (rule) => rule.required().email()}),
    textField('contactPhone', 'Telefon', 'contact'),
    textField('contactSchedule', 'Rozvrh v kontaktu', 'contact', 2),

    textField('footerTagline', 'Popis studia', 'footer', 3),
    textField('newsletterTitle', 'Nadpis newsletteru', 'footer'),
    textField('newsletterText', 'Text newsletteru před souhlasem', 'footer', 3),
    textField('copyright', 'Copyright', 'footer'),
  ],
  preview: {
    prepare: () => ({title: 'Jóga s králíčky', subtitle: 'Texty a fotografie veřejného webu'}),
  },
})

export const schemaTypes = [siteContent]
