// ---------------------------------------------------------------------
//  Srovná texty v Sanity s tím, co je v index.html
//
//  K čemu to je: obsah se z CMS dotahuje až v prohlížeči a přepisuje jím
//  text z HTML. Když se ty dva rozejdou, vyhraje CMS — a návštěvník uvidí
//  starou verzi. V srpnu 2026 kvůli tomu web ukazoval 75 minut a max 12
//  míst, i když v HTML už bylo správně 60 minut a max 10 míst.
//
//  Tenhle skript ten rozchod srovná: přepíše jen ta pole, která se
//  rozešla, a nic jiného. Je bezpečné ho pustit i opakovaně.
//
//  Sahá na publikovaný dokument i na rozpracovaný draft, pokud existuje —
//  jinak by se stará hodnota vrátila při nejbližším publikování.
//
//  Spuštění:
//      npm run sync-content              jen ukáže, co by změnil
//      npm run sync-content -- --write   opravdu zapíše
//
//  Nemá žádné závislosti, běží na holém Node (fetch je vestavěný).
//
//  Potřebuje v prostředí (typicky přes .env.local):
//      SANITY_API_WRITE_TOKEN=...   token s oprávněním Editor
//      SANITY_API_PROJECT_ID=...
//      SANITY_API_DATASET=production
// ---------------------------------------------------------------------

const projectId = process.env.SANITY_API_PROJECT_ID || process.env.SANITY_STUDIO_PROJECT_ID
const dataset = process.env.SANITY_API_DATASET || process.env.SANITY_STUDIO_DATASET || 'production'
const token = process.env.SANITY_API_WRITE_TOKEN
const apiVersion = 'v2026-07-01'
const zapsat = process.argv.includes('--write')

if (!projectId) throw new Error('Chybí SANITY_API_PROJECT_ID.')
if (!token) throw new Error('Chybí SANITY_API_WRITE_TOKEN (token s oprávněním Editor).')

const zaklad = `https://${projectId}.api.sanity.io/${apiVersion}/data`
const hlavicky = {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}

async function dotaz(groq) {
  const r = await fetch(`${zaklad}/query/${dataset}?query=${encodeURIComponent(groq)}`, {headers: hlavicky})
  if (!r.ok) throw new Error(`Sanity dotaz selhal (${r.status}): ${await r.text()}`)
  return (await r.json()).result
}

async function zapis(mutations) {
  const r = await fetch(`${zaklad}/mutate/${dataset}`, {
    method: 'POST', headers: hlavicky, body: JSON.stringify({mutations}),
  })
  if (!r.ok) throw new Error(`Sanity zápis selhal (${r.status}): ${await r.text()}`)
  return r.json()
}

// ---------------------------------------------------------------------
//  CÍLOVÝ STAV — musí sedět s index.html.
//  Měníš-li text na jednom místě, změň ho i na druhém.
// ---------------------------------------------------------------------
const CIL = {
  heroSubtitle: 'Hodina jemné jógy, po které se po sále volně rozeběhne deset roztomilých králíčků.',
  lessonsTitle: 'Dvě lekce. Obě končí králíčkem na podložce.',
  lessonsLead: 'Máme jednu lekci pro dospělé a jednu pro děti s rodičem. Vyberte si a rezervujte rovnou tady.',
  galleryTitle: 'Králíčci, kteří nikdy nespěchají',
}

// Položky polí se dohledávají podle pořadí, _key se zachovává.
const CIL_LEKCE = [
  {
    meta: ['60 minut', 'Út · Čt · So', 'max 10 míst', 'i pro úplné začátečníky'],
    description: 'Naše klasika. Pomalý pohyb a dech, u každé pozice se ukáže i jednodušší varianta.',
  },
  {
    meta: ['60 minut', 'Sobota 9:30', 'max 10 míst', 'dítě s rodičem'],
  },
]

const CIL_DUVODY = [
  {body: 'Králíček si klín vybere sám. Objednat se to nedá, a právě proto to sedne.'},
]

const stejne = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const zkratit = (v) => {
  const s = Array.isArray(v) ? v.join(' · ') : String(v ?? '(prázdné)')
  return s.length > 72 ? s.slice(0, 69) + '…' : s
}

function pripravit(doc) {
  const zmeny = []
  const set = {}

  for (const [pole, hodnota] of Object.entries(CIL)) {
    if (!stejne(doc[pole], hodnota)) {
      zmeny.push([pole, doc[pole], hodnota])
      set[pole] = hodnota
    }
  }

  for (const [nazev, cile] of [['lessons', CIL_LEKCE], ['reasons', CIL_DUVODY]]) {
    const puvodni = doc[nazev]
    if (!Array.isArray(puvodni)) continue
    const nove = puvodni.map((polozka, i) => ({...polozka, ...(cile[i] ?? {})}))
    cile.forEach((cil, i) => {
      if (!puvodni[i]) return
      for (const [k, v] of Object.entries(cil)) {
        if (!stejne(puvodni[i][k], v)) zmeny.push([`${nazev}[${i}].${k}`, puvodni[i][k], v])
      }
    })
    if (!stejne(puvodni, nove)) set[nazev] = nove
  }

  return {zmeny, set}
}

const docs = await dotaz('*[_id in ["siteContent", "drafts.siteContent"]]')
if (!docs?.length) throw new Error('Dokument siteContent v Sanity neexistuje.')

const mutations = []
let celkem = 0

for (const doc of docs) {
  const {zmeny, set} = pripravit(doc)
  const stitek = doc._id.startsWith('drafts.') ? 'rozpracovaný draft' : 'publikovaná verze'
  if (!zmeny.length) {
    console.log(`\n${stitek} (${doc._id}) — sedí, není co měnit.`)
    continue
  }
  celkem += zmeny.length
  console.log(`\n${stitek} (${doc._id}) — ${zmeny.length} ${zmeny.length === 1 ? 'pole' : 'polí'} se rozešlo:\n`)
  for (const [pole, ze, na] of zmeny) {
    console.log(`  ${pole}`)
    console.log(`    teď: ${zkratit(ze)}`)
    console.log(`    má:  ${zkratit(na)}\n`)
  }
  mutations.push({patch: {id: doc._id, set}})
}

if (!celkem) {
  console.log('\nSanity už s HTML sedí.')
  process.exit(0)
}

if (!zapsat) {
  console.log('Nic se nezapsalo. Chceš-li to opravdu provést:  npm run sync-content -- --write')
  process.exit(0)
}

await zapis(mutations)
console.log('\nZapsáno do Sanity.')
