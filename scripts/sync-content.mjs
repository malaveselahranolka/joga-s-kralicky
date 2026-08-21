// ---------------------------------------------------------------------
//  Srovná texty v Sanity s tím, co je v index.html
//
//  K čemu to je: obsah se z CMS dotahuje až v prohlížeči a přepisuje jím
//  text z HTML. Když se ty dva rozejdou, vyhraje CMS — a návštěvník uvidí
//  starou verzi. V srpnu 2026 kvůli tomu web ukazoval 75 minut a max 12
//  míst, i když v HTML už bylo správně 60 minut a max 10 míst.
//
//  Tenhle skript ten rozchod srovná: přepíše v Sanity jen ta pole, která
//  se rozešla, a nic jiného. Je bezpečné ho pustit i opakovaně — když
//  všechno sedí, jen vypíše, že není co dělat.
//
//  Spuštění:
//      npm run sync-content            (jen ukáže, co by změnil)
//      npm run sync-content -- --write (opravdu zapíše)
//
//  Potřebuje .env.local s:
//      SANITY_API_WRITE_TOKEN=...   token s oprávněním Editor
//      SANITY_API_PROJECT_ID=...
//      SANITY_API_DATASET=production
// ---------------------------------------------------------------------
import {createClient} from '@sanity/client'

const projectId = process.env.SANITY_API_PROJECT_ID || process.env.SANITY_STUDIO_PROJECT_ID
const dataset = process.env.SANITY_API_DATASET || process.env.SANITY_STUDIO_DATASET || 'production'
const token = process.env.SANITY_API_WRITE_TOKEN
const zapsat = process.argv.includes('--write')

if (!projectId) throw new Error('Chybí SANITY_API_PROJECT_ID.')
if (!token) throw new Error('Chybí SANITY_API_WRITE_TOKEN (token s oprávněním Editor).')

const client = createClient({projectId, dataset, token, apiVersion: '2026-07-01', useCdn: false})

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
  const s = Array.isArray(v) ? v.join(' · ') : String(v ?? '')
  return s.length > 70 ? s.slice(0, 67) + '…' : s
}

const doc = await client.fetch('*[_id == "siteContent"][0]')
if (!doc) throw new Error('Dokument siteContent v Sanity neexistuje.')

const zmeny = []
const patch = {}

for (const [pole, hodnota] of Object.entries(CIL)) {
  if (!stejne(doc[pole], hodnota)) {
    zmeny.push([pole, doc[pole], hodnota])
    patch[pole] = hodnota
  }
}

function srovnatPole(nazev, cile) {
  const puvodni = doc[nazev]
  if (!Array.isArray(puvodni)) return
  const nove = puvodni.map((polozka, i) => ({...polozka, ...(cile[i] ?? {})}))
  cile.forEach((cil, i) => {
    if (!puvodni[i]) return
    for (const [k, v] of Object.entries(cil)) {
      if (!stejne(puvodni[i][k], v)) zmeny.push([`${nazev}[${i}].${k}`, puvodni[i][k], v])
    }
  })
  if (!stejne(puvodni, nove)) patch[nazev] = nove
}

srovnatPole('lessons', CIL_LEKCE)
srovnatPole('reasons', CIL_DUVODY)

if (!zmeny.length) {
  console.log('Sanity už s HTML sedí, není co měnit.')
  process.exit(0)
}

console.log(`Rozešlo se ${zmeny.length} ${zmeny.length === 1 ? 'pole' : 'polí'}:\n`)
for (const [pole, ze, na] of zmeny) {
  console.log(`  ${pole}`)
  console.log(`    teď: ${zkratit(ze)}`)
  console.log(`    má:  ${zkratit(na)}\n`)
}

if (!zapsat) {
  console.log('Nic se nezapsalo. Chceš-li to opravdu provést:  npm run sync-content -- --write')
  process.exit(0)
}

await client.patch('siteContent').set(patch).commit()
console.log('Zapsáno do Sanity. Publikovanou verzi zkontroluj na /studio.')
