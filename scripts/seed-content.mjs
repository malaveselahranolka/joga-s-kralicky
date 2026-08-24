import {createClient} from '@sanity/client'
import {createReadStream, existsSync} from 'node:fs'
import {basename, dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const projectId = process.env.SANITY_API_PROJECT_ID || process.env.SANITY_STUDIO_PROJECT_ID || process.env.NEXT_PUBLIC_SANITY_PROJECT_ID
const dataset = process.env.SANITY_API_DATASET || process.env.SANITY_STUDIO_DATASET || process.env.NEXT_PUBLIC_SANITY_DATASET || 'production'
const token = process.env.SANITY_API_WRITE_TOKEN

if (!projectId || !token) throw new Error('Chybí SANITY project ID nebo SANITY_API_WRITE_TOKEN.')

const client = createClient({projectId, dataset, token, apiVersion: '2026-07-01', useCdn: false})
const force = process.argv.includes('--force')
const existingDocument = await client.getDocument('siteContent')

if (existingDocument && !force) {
  console.log('Dokument siteContent už existuje. Seed vynechán; použij --force jen pro úplné přepsání.')
  process.exit(0)
}

const imageFiles = [
  'assets/photos/yoga-5.webp',
  'assets/photos/rabbit-1.webp',
  'assets/photos/rabbit-5.webp',
  'assets/photos/rabbit-4.webp',
  'assets/photos/rabbit-3.webp',
  'assets/photos/yoga-4.webp',
  'assets/photos/rabbit-6.webp',
  'assets/photos/rabbit-2.webp',
  'assets/photos/yoga-6.webp',
  'assets/photos/gal-brokolice.webp',
  'assets/photos/gal-tofu.webp',
  'assets/photos/gal-list.webp',
  'assets/photos/gal-pepa.webp',
  'assets/photos/yoga-3.webp',
  'assets/photos/yoga-12.webp',
  'assets/photos/gal-minka.webp',
  'assets/photos/gal-pauza.webp',
  'assets/photos/gal-chvilka.webp',
  'assets/photos/gal-rano.webp',
  'assets/photos/yoga-1.webp',
  'assets/photos/yoga-2.webp',
  'assets/photos/rabbit-7.webp',
]

const assets = new Map()
for (const relativePath of imageFiles) {
  const absolutePath = join(root, relativePath)
  if (!existsSync(absolutePath)) throw new Error(`Chybí obrázek ${relativePath}`)
  const filename = `site-${basename(relativePath)}`
  let assetId = await client.fetch('*[_type == "sanity.imageAsset" && originalFilename == $filename][0]._id', {filename})
  if (!assetId) {
    console.log(`Nahrávám ${relativePath}`)
    const asset = await client.assets.upload('image', createReadStream(absolutePath), {filename})
    assetId = asset._id
  } else {
    console.log(`Používám existující ${relativePath}`)
  }
  assets.set(relativePath, {_type: 'image', asset: {_type: 'reference', _ref: assetId}})
}

const image = (path, key) => ({...assets.get(path), ...(key ? {_key: key} : {})})
const keyed = (key, value) => ({_key: key, ...value})

const document = {
  _id: 'siteContent',
  _type: 'siteContent',
  pageTitle: 'Jóga s králíčky — jóga se sedmi králíky, Ostrava',
  pageDescription: 'Hodina jógy v Ostravě, při které vám mezi pozice hopsají domácí králíci. Bez výkonu, bez zrcadel — jen dech a sedm chlupatých rozptýlení. Vstup 499 Kč, Fit&Fun Studio Ostrava.',
  shareDescription: 'Hodina jógy, po které vám na klíně usne králík. Fit&Fun Studio Ostrava, vstup 499 Kč.',
  shareImage: image('assets/photos/yoga-1.webp'),

  navReservationLabel: 'Rezervovat',
  reservationLabel: 'Rezervovat lekci',
  heroLocation: 'Fit&Fun Studio Ostrava',
  heroTitleStart: 'Jóga s králíčky v Ostravě',
  heroTitleEnd: 'míň jógy, víc králíčků',
  heroSubtitle: 'Hodina jemné jógy, po které se po sále volně rozeběhne sedm chlupatých učitelů zpomalení.',
  heroImage: image('assets/photos/yoga-5.webp'),
  heroDeck: [
    image('assets/photos/rabbit-1.webp', 'hero-rabbit-1'),
    image('assets/photos/rabbit-5.webp', 'hero-rabbit-2'),
    image('assets/photos/rabbit-4.webp', 'hero-rabbit-3'),
  ],

  stats: [
    keyed('rabbits', {number: '10', label: 'králíčků-lektorů'}),
    keyed('duration', {number: '60′', label: 'délka jedné lekce'}),
    keyed('capacity', {number: 'max 10', label: 'míst v sále'}),
  ],
  proofNote: 'Malé skupiny, ať má klid každý host i každý králík.',

  reasonsEyebrow: 'Proč se lidi vracejí',
  reasonsTitle: 'Zeptali jsme se. Nikdo neřekl „kvůli protažení“.',
  reasonsLead: 'Jóga je záminka. Tohle jsou čtyři důvody, které nám lidi říkají doopravdy.',
  reasons: [
    keyed('closeness', {
      label: 'Blízkost',
      title: 'Protože si k vám někdo lehne',
      body: 'Brokolice si za lekci vybere jeden klín. Když je to ten váš, odcházíte jiní, než jste přišli.',
      image: image('assets/photos/rabbit-3.webp'),
      alt: 'Klopoušek s dlouhýma ušima zblízka',
    }),
    keyed('no-mirrors', {
      label: 'Bez zrcadel',
      title: 'Protože se nikdo nedívá, jak vám to jde',
      body: 'Žádná zrcadla, žádné opravování. Lektorka ukáže a nechá vás to dělat po svém.',
      image: image('assets/photos/yoga-4.webp'),
      alt: 'Žena sedí v klidu na podložce ve světlém sále',
    }),
    keyed('pace', {
      label: 'Tempo',
      title: 'Protože králík se nedá popohnat',
      body: 'Nemůžete uspíšit zvíře, které si dává na čas. Tak si ho nakonec dáte taky.',
      image: image('assets/photos/rabbit-6.webp'),
      alt: 'Šedý a hnědý králík odpočívají v chýši',
    }),
    keyed('crew', {
      label: 'Parta',
      title: 'Protože si zapamatujete jména dřív než pozice',
      body: 'Po měsíci znáte Pepu, Tofu i Mínku. Sanskrt počká, tahle hodina ne.',
      image: image('assets/photos/rabbit-2.webp'),
      alt: 'Dva králíci si spolu pochutnávají na trávě',
    }),
  ],

  lessonsTitle: 'Dvě lekce. Obě končí králíkem na podložce.',
  lessonsLead: 'Nemáme rozpis na tři strany. Máme jednu lekci pro dospělé a jednu pro děti s rodičem. Vyberte si a rezervujte rovnou tady.',
  lessons: [
    keyed('adult', {
      tag: 'Pro dospělé',
      title: 'Hatha s králíčky',
      price: '499 Kč',
      meta: ['60 minut', 'Út · Čt · So', 'max 10 míst', 'i pro úplné začátečníky'],
      description: 'Naše klasika. Pomalý pohyb a dech, u každé pozice se ukáže i jednodušší varianta. Nejde o to, jak hluboko se prohnete.',
      timeline: [
        keyed('adult-1', {time: '0–10 min', text: 'Přijdete, zujete se, dostanete čaj.'}),
        keyed('adult-2', {time: '10–40 min', text: 'Pomalá hatha. Lektorka vede, nikdo neopravuje.'}),
        keyed('adult-3', {time: '40–60 min', text: 'Savasana a sál se otevře králíkům. Vybírají si sami.'}),
      ],
      buttonLabel: 'Rezervovat Hathu',
      image: image('assets/photos/yoga-6.webp'),
      alt: 'Skupina cvičí v sále na podložkách',
    }),
    keyed('children', {
      tag: 'Pro děti od 5 let',
      title: 'Děti & králíci',
      price: '499 Kč',
      meta: ['60 minut', 'Sobota 9:30', 'max 10 míst', 'dítě s rodičem'],
      description: 'Víc her než ásan. Děti se učí jedinou věc: být tak klidné, aby k nim někdo přišel dobrovolně. Funguje to i na rodiče.',
      timeline: [
        keyed('children-1', {time: '0–10 min', text: 'Jak se ke králíkovi přiblížit, aby neutekl.'}),
        keyed('children-2', {time: '10–40 min', text: 'Pozice se zvířecími jmény, hry a hodně smíchu.'}),
        keyed('children-3', {time: '40–60 min', text: 'Klid na dece, mrkev a mazlení.'}),
      ],
      buttonLabel: 'Rezervovat sobotu',
      image: image('assets/photos/rabbit-4.webp'),
      alt: 'Dva bílí králíčci pohromadě',
    }),
  ],

  galleryTitle: 'Lektoři, kteří nikdy nespěchají',
  galleryLead: 'Každý ze sedmi má jméno, povahu i svůj oblíbený kout sálu. Čtyři z nich poznáte hned při první lekci.',
  galleryHint: 'Scrollujte, galerie jede do strany',
  galleryButtonLabel: 'Chci je poznat',
  galleryItems: [
    keyed('gallery-01', {caption: 'Brokolice, hlavní lektorka', note: 'Nejstarší a nejklidnější. Když si lehne vedle vás, děláte savasanu správně.', image: image('assets/photos/gal-brokolice.webp'), alt: 'Šedohnědý králík s klopenýma ušima zblízka'}),
    keyed('gallery-02', {caption: 'Ranní obhlídka sálu', image: image('assets/photos/gal-tofu.webp'), alt: 'Šedý králík odpočívá u dřevěné stěny chýše'}),
    keyed('gallery-03', {caption: 'Kdo si lehne, ten velí', image: image('assets/photos/gal-list.webp'), alt: 'Králík okusuje list na zahradě'}),
    keyed('gallery-04', {caption: 'Sál během Hathy', image: image('assets/photos/yoga-6.webp'), alt: 'Skupina cvičí v sále na podložkách'}),
    keyed('gallery-05', {caption: 'Pepa, specialista na klín', note: 'Floppy ouška, nulové zábrany. Najde si nejpohodlnější klín a zůstane do konce.', image: image('assets/photos/gal-pepa.webp'), alt: 'Černo-hnědý králík Pepa s postavenýma ušima'}),
    keyed('gallery-06', {caption: 'Rozcvička, než přijdou', image: image('assets/photos/yoga-3.webp'), alt: 'Cvičenka v pozici na podložce v sále'}),
    keyed('gallery-07', {caption: 'Poslední protažení', image: image('assets/photos/yoga-12.webp'), alt: 'Cvičenka v záklonu'}),
    keyed('gallery-08', {caption: 'Tofu, energie lekce', note: 'Mladý a hopsavý. Zahřeje atmosféru dřív než vy svaly. Děti ho milují.', image: image('assets/photos/gal-minka.webp'), alt: 'Hnědý králík Tofu okusuje trávu zblízka'}),
    keyed('gallery-09', {caption: 'Pauza na zahrádce', image: image('assets/photos/gal-pauza.webp'), alt: 'Dva králíci spolu okusují seno v chýši'}),
    keyed('gallery-10', {caption: 'Chvilka před lekcí', image: image('assets/photos/gal-chvilka.webp'), alt: 'Černý králík si čichá k chlebu nad miskou vody'}),
    keyed('gallery-11', {caption: 'Mínka, mistryně klidu', note: 'Sametový pohyb. Objeví se jako stín, chvíli je u vás a zase zmizí.', image: image('assets/photos/gal-rano.webp'), alt: 'Bílo-hnědý králík Mínka schoulený ve slámě'}),
    keyed('gallery-12', {caption: 'Konec lekce', image: image('assets/photos/yoga-1.webp'), alt: 'Silueta v sedu při západu slunce'}),
  ],

  referencesTitle: 'Klid od naší komunity',
  referencesLead: 'Od úplných začátečníků po stálé hosty. Jejich rána se s námi proměnila a králíci na tom mají svůj podíl.',
  testimonials: [
    keyed('testimonial-01', {quote: '„Po první lekci jsem brečela štěstím. Pepa mi usnul na klíně během savasany a já jsem konečně vypnula.“', name: 'Sofie R.', detail: 'chodí každý čtvrtek'}),
    keyed('testimonial-02', {quote: '„Nikdy jsem necvičila a bála se, že budu za vola. Lektorka i králíci mě uklidnili během minuty.“', name: 'Markéta H.', detail: 'první lekce', image: image('assets/photos/yoga-6.webp'), alt: 'Skupinová lekce v sále'}),
    keyed('testimonial-03', {quote: '„Vodím sem dceru na sobotní Děti a králíci. Je to nejhezčí hodina našeho týdne.“', name: 'Jana P.', detail: 'maminka', image: image('assets/photos/rabbit-3.webp'), alt: 'Klopoušek s dlouhýma ušima'}),
    keyed('testimonial-04', {quote: '„Chodím i dvakrát týdně a pokaždé odejdu lehčí. Nečekal jsem, že mě to chytne takhle.“', name: 'Tomáš K.', detail: 'chodí od jara', image: image('assets/photos/yoga-2.webp'), alt: 'Cvičenka v pozici při západu slunce'}),
    keyed('testimonial-05', {quote: '„Brokolice je lepší terapeut než leckterá appka na meditaci. Vážně.“', name: 'Eliška M.', detail: 'chodí ráno', image: image('assets/photos/yoga-12.webp'), alt: 'Cvičenka v záklonu'}),
  ],

  communityEyebrow: 'Přidejte se',
  communityTitle: 'Sedm králíků čeká, až zpomalíte i vy',
  communityBody: 'Vstup stojí 499 Kč a platí se online rovnou při rezervaci, takže máte místo jisté hned. Žádné čekání na potvrzení.',
  communityNote: 'Sedm králíčků · každý s vlastním jménem',
  communityNudge: 'Ještě otázky?',
  communityNudgeLink: 'Sjeďte o kousek níž',
  communityFaces: [
    image('assets/photos/rabbit-1.webp', 'face-1'),
    image('assets/photos/rabbit-5.webp', 'face-2'),
    image('assets/photos/rabbit-4.webp', 'face-3'),
    image('assets/photos/rabbit-7.webp', 'face-4'),
  ],

  faqTitle: 'Než přijdete poprvé',
  faqIntro: 'Šest věcí, na které se lidi ptají nejčastěji, než přijdou poprvé. Nenašli jste odpověď? Napište na',
  faqCue: 'Rozklikněte kteroukoliv otázku',
  faqs: [
    keyed('faq-01', {question: 'Musím už něco umět?', answer: 'Vůbec ne. Většina hostů přichází úplně bez zkušeností. Lektorka vše ukáže a nabídne jednodušší variantu každé polohy. Jde nám o klid, ne o dokonalý tvar.'}),
    keyed('faq-02', {question: 'Nevyruší mě králíci od cvičení?', answer: 'To je celý smysl. Králík nečeká, až dokončíte pozici, jde si po svém a vy se tím pádem taky přestanete honit. Když se k vám zrovna žádný nepřiblíží, není to nic proti vám. Je to jeho rozhodnutí.'}),
    keyed('faq-03', {question: 'Co když mám alergii na zvířata?', answer: 'Sál pečlivě větráme a čistíme, přesto při alergii na srst doporučujeme lekci zvážit nebo se poradit s lékařem. Rádi vám pomůžeme vybrat méně kontaktní termín.'}),
    keyed('faq-04', {question: 'Co si mám vzít s sebou?', answer: 'Jen pohodlné oblečení a ponožky. Podložky, dečky i polštáře máme. Cvičíme bez bot a doporučujeme nepoužívat silné parfémy, králíci mají citlivý čich.'}),
    keyed('faq-05', {question: 'Jak a kdy se platí?', answer: 'Výhradně online kartou při rezervaci, na místě se neplatí. Vstup stojí 499 Kč za osobu. Když rezervujete víc míst na jedno jméno, brána rovnou spočítá celou částku. Po zaplacení přijde e-mail s QR kódem, který ve studiu jen ukážete. Než platbu dokončíte, držíme vám místo 35 minut.'}),
    keyed('faq-06', {question: 'Jsou králíci v pořádku?', answer: 'Jejich pohoda je u nás na prvním místě. Mají vlastní klidové zóny, kam se kdykoliv mohou stáhnout, pravidelné pauzy a veterinární péči. Na lekci jdou jen odpočatí a dobrovolně.'}),
  ],

  contactTitle: 'Kde nás najdete',
  contactLead: 'Sídlíme ve Fit&Fun Studiu. Přijďte prosím o deset minut dřív, ať se stihnete v klidu zout a králíci si vás stihnou očichat.',
  studioName: 'Fit&Fun Studio Ostrava',
  studioAddress: 'Tovární 486/7, 709 00 Ostrava-Mariánské Hory',
  contactEmail: 'info@jogaskralicky.cz',
  contactPhone: '+420 603 340 860',
  contactSchedule: 'Lekce: úterý, čtvrtek a sobota. Děti v sobotu od 9:30.',

  footerTagline: 'Studio klidu, kde tempo udávají králíci. Fit&Fun Studio Ostrava, Tovární 486/7, Ostrava-Mariánské Hory.',
  newsletterTitle: 'Klidná pošta, žádný spam',
  newsletterText: 'Občas pošleme nové termíny, akce a pár fotek králíků. Odhlásíte se jedním kliknutím. Přihlášením souhlasíte se',
  copyright: '© 2026 Jóga s králíčky. Dýchejte pomalu.',
}

// POZOR: createOrReplace přepíše CELÝ dokument siteContent včetně toho,
// co majitelka mezitím změnila ve Studiu. Používej jen při zakládání
// prázdného datasetu. Na běžné změny je scripts/sync-content.mjs.
await client.createOrReplace(document)
console.log('Obsah webu uložen do Sanity jako dokument siteContent.')
