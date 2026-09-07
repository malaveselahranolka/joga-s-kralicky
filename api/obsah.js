// ---------------------------------------------------------------------
//  OBSAH WEBU — čtení a ukládání ze správy
//
//  Ukládání = commit do GitHubu. Vercel na commit sám nasadí, takže se
//  změna objeví na webu bez zásahu programátora. Zdroj pravdy je tedy
//  repozitář, ne databáze: co je na webu, jde vždy dohledat v historii.
//
//  Kdo smí ukládat: přihlášená majitelka. Token ze Supabase (stejné
//  přihlášení jako do zbytku správy) se ověřuje na straně serveru —
//  z prohlížeče se sem nedá poslat nic, co by ověření obešlo.
//
//  Potřebné proměnné prostředí ve Vercelu:
//      GITHUB_TOKEN   fine-grained token, práva Contents: Read and write
//      GITHUB_REPO    např. malaveselahranolka/joga-s-kralicky
//      GITHUB_BRANCH  volitelně, výchozí main
//      OBSAH_EMAILY   volitelně, čárkou oddělené e-maily, které smí ukládat
// ---------------------------------------------------------------------

const REPO = process.env.GITHUB_REPO || 'malaveselahranolka/joga-s-kralicky'
const BRANCH = process.env.GITHUB_BRANCH || 'main'
const TOKEN = process.env.GITHUB_TOKEN
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mglopjlgpfpturvqtjcj.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_fSK0f_Mv-WFaKnvxwTu5BA_NxYV-U9_'

const CESTA_OBSAH = 'content/obsah.json'
const SLOZKA_FOTEK = 'assets/photos/nahrane'
const MAX_FOTKA = 4 * 1024 * 1024

const gh = (cesta, init = {}) => fetch(`https://api.github.com/repos/${REPO}/${cesta}`, {
  ...init,
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    ...init.headers,
  },
})

async function prihlaseny(request) {
  const hlavicka = request.headers.authorization || ''
  const token = hlavicka.startsWith('Bearer ') ? hlavicka.slice(7) : ''
  if (!token) return null
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY},
  })
  if (!r.ok) return null
  const user = await r.json()
  if (!user?.email) return null
  const povolene = (process.env.OBSAH_EMAILY || '')
    .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
  if (povolene.length && !povolene.includes(user.email.toLowerCase())) return null
  return user
}

async function nactiSoubor(cesta) {
  const r = await gh(`contents/${cesta}?ref=${BRANCH}`)
  if (r.status === 404) return {sha: null, text: null}
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${await r.text()}`)
  const data = await r.json()
  return {sha: data.sha, text: Buffer.from(data.content, 'base64').toString('utf8')}
}

async function ulozSoubor(cesta, base64, zprava, sha) {
  const r = await gh(`contents/${cesta}`, {
    method: 'PUT',
    body: JSON.stringify({message: zprava, content: base64, branch: BRANCH, ...(sha ? {sha} : {})}),
  })
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${await r.text()}`)
  return r.json()
}

// Název fotky od uživatele se nikdy nepoužije tak, jak přišel — jinak by
// šlo cestou ../ přepsat libovolný soubor v repozitáři.
function bezpecnyNazev(nazev) {
  const pripona = (String(nazev).match(/\.(jpe?g|png|webp)$/i) || [])[0] || '.jpg'
  const zaklad = String(nazev)
    .replace(/\.[^.]+$/, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'fotka'
  return `${zaklad}-${Date.now().toString(36)}${pripona.toLowerCase()}`
}

export default async function handler(request, response) {
  if (!TOKEN) {
    return response.status(503).json({error: 'Chybí GITHUB_TOKEN — správa obsahu není nastavená.'})
  }

  const user = await prihlaseny(request)
  if (!user) return response.status(401).json({error: 'Přihlaste se prosím znovu.'})

  try {
    if (request.method === 'GET') {
      const {text} = await nactiSoubor(CESTA_OBSAH)
      response.setHeader('Cache-Control', 'private, no-store, max-age=0')
      return response.status(200).json(text ? JSON.parse(text) : {})
    }

    if (request.method === 'POST') {
      const {nazev, data} = request.body || {}
      const base64 = String(data || '').replace(/^data:[^,]+,/, '')
      if (!base64) return response.status(400).json({error: 'Chybí soubor.'})
      if (Buffer.byteLength(base64, 'base64') > MAX_FOTKA) {
        return response.status(413).json({error: 'Fotka je větší než 4 MB. Zmenšete ji prosím.'})
      }
      const cesta = `${SLOZKA_FOTEK}/${bezpecnyNazev(nazev)}`
      await ulozSoubor(cesta, base64, `Nová fotka z administrace (${user.email})`, null)
      return response.status(200).json({cesta})
    }

    if (request.method === 'PUT') {
      const obsah = request.body?.obsah
      if (!obsah || typeof obsah !== 'object') {
        return response.status(400).json({error: 'Chybí obsah k uložení.'})
      }
      const {sha} = await nactiSoubor(CESTA_OBSAH)
      const text = `${JSON.stringify(obsah, null, 2)}\n`
      await ulozSoubor(
        CESTA_OBSAH,
        Buffer.from(text, 'utf8').toString('base64'),
        `Úprava obsahu webu ze správy (${user.email})`,
        sha,
      )
      return response.status(200).json({ok: true})
    }

    response.setHeader('Allow', 'GET, POST, PUT')
    return response.status(405).json({error: 'Nepodporovaná metoda.'})
  } catch (error) {
    console.error('obsah:', error)
    return response.status(502).json({error: 'Uložení se nepodařilo. Zkuste to prosím znovu.'})
  }
}
