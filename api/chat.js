// =====================================================================
//  CHAT NA WEBU — odpovědi na časté dotazy (GPT-6 Luna přes Vercel AI Gateway)
//
//  Proč: stejné otázky (cena, co si vzít, jak funguje poukaz, jak se
//  k nám dostat) chodily pořád dokola e-mailem. Bot na ně odpoví hned
//  a jen z toho, co je v api/_chat-znalosti.js. Co tam není, pošle na
//  e-mail — nevymýšlí.
//
//  Co se NEděje:
//    * konverzace se nikam neukládají — prohlížeč pošle historii,
//      my ji přepošleme modelu a po odpovědi zapomeneme
//    * obsah zpráv se nelogguje (jen stav a spotřeba tokenů)
//    * bot nerezervuje, neplatí a nemění rezervace
//
//  Potřebné ve Vercelu:
//      AI_GATEWAY_API_KEY  klíč z AI Gateway (Sensitive, Production + Preview).
//                          Strop útraty se nastavuje přímo na klíči.
//      Bez klíče se použije OIDC token nasazení; když chybí obojí,
//      endpoint vrátí 503 a bublina nabídne e-mail.
//
//  Volitelně:
//      CHAT_MODEL          výchozí openai/gpt-6-luna
//      CHAT_ZALOZNI_MODEL  výchozí openai/gpt-5.6-luna (když hlavní vypadne)
// =====================================================================
import {readFileSync} from 'node:fs'
import {ocistiZpravy, sestavPrompt, vytvorOmezovac} from './_chat-znalosti.js'

const MODEL = process.env.CHAT_MODEL || 'openai/gpt-6-luna'
const ZALOZNI = process.env.CHAT_ZALOZNI_MODEL || 'openai/gpt-5.6-luna'
const GATEWAY = 'https://ai-gateway.vercel.sh/v1/chat/completions'
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mglopjlgpfpturvqtjcj.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_fSK0f_Mv-WFaKnvxwTu5BA_NxYV-U9_'
const MAX_TELO = 16 * 1024
const KONTAKT = 'Napište nám prosím na info@jogaskralicky.cz nebo zavolejte na +420 603 340 860.'

// Obsah webu (lekce, FAQ, kontakt). vercel.json ho přibaluje k funkci
// přes includeFiles; když by přesto chyběl, bot jede jen s pevnými fakty.
let obsah = null
try {
  obsah = JSON.parse(readFileSync(new URL('../content/obsah.json', import.meta.url), 'utf8'))
} catch (_e) {
  console.warn('Chat: content/obsah.json se nenačetl, odpovídám jen z pevných faktů.')
}

const smi = vytvorOmezovac()

// Termíny se mění zřídka; stačí je načíst jednou za pět minut.
let terminyCache = {cas: 0, data: null}
async function nactiTerminy() {
  if (Date.now() - terminyCache.cas < 5 * 60 * 1000) return terminyCache.data
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/public_lessons?select=title,starts_at,duration_min,remaining&order=starts_at.asc&limit=12`,
      {headers: {apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`}, signal: AbortSignal.timeout(3000)},
    )
    if (!r.ok) throw new Error(`Supabase ${r.status}`)
    terminyCache = {cas: Date.now(), data: await r.json()}
  } catch (e) {
    console.warn(`Chat: termíny se nenačetly (${e.message})`)
    terminyCache = {cas: Date.now() - 4 * 60 * 1000, data: null}   // zkusit znovu za minutu
  }
  return terminyCache.data
}

// Dotazy přijímáme jen z vlastního webu (a z náhledů na Vercelu), ať se
// z endpointu nestane zdarma dostupný chatbot pro kohokoliv.
function povolenyPuvod(request) {
  const origin = request.headers.origin
  if (!origin) return false
  try {
    const host = new URL(origin).hostname
    return host === 'www.jogaskralicky.cz' || host === 'jogaskralicky.cz'
      || host === request.headers.host?.split(':')[0]
      || /^joga-s-kralicky(-[a-z0-9-]+)?\.vercel\.app$/.test(host)
      || host === 'localhost'
  } catch (_e) {
    return false
  }
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store')
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return response.status(405).json({chyba: 'Nepodporovaná metoda.'})
  }
  if (!povolenyPuvod(request)) return response.status(403).json({chyba: 'Nepovolený původ.'})

  const raw = typeof request.body === 'string' ? request.body : JSON.stringify(request.body ?? {})
  if (raw.length > MAX_TELO) return response.status(413).json({chyba: 'Zpráva je moc dlouhá.'})

  let telo
  try {
    telo = typeof request.body === 'string' ? JSON.parse(request.body) : request.body
  } catch (_e) {
    return response.status(400).json({chyba: 'Neplatný požadavek.'})
  }
  const zpravy = ocistiZpravy(telo?.zpravy)
  if (!zpravy) return response.status(400).json({chyba: 'Chybí dotaz.'})

  const ip = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'neznama'
  if (!smi(ip)) {
    return response.status(429).json({chyba: `Teď toho bylo trochu moc najednou. Zkuste to prosím za pár minut, nebo ${KONTAKT.charAt(0).toLowerCase()}${KONTAKT.slice(1)}`})
  }

  const klic = process.env.AI_GATEWAY_API_KEY || request.headers['x-vercel-oidc-token'] || process.env.VERCEL_OIDC_TOKEN
  if (!klic) {
    console.error('Chat: chybí AI_GATEWAY_API_KEY i OIDC token.')
    return response.status(503).json({chyba: `Pomocník teď nefunguje. ${KONTAKT}`})
  }

  const terminy = await nactiTerminy()
  const system = sestavPrompt({obsah, terminy})

  try {
    const r = await fetch(GATEWAY, {
      method: 'POST',
      headers: {Authorization: `Bearer ${klic}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({
        model: MODEL,
        models: [ZALOZNI],
        messages: [{role: 'system', content: system}, ...zpravy],
        // Nízké přemýšlení stačí na FAQ a zrychlí odpověď. Limit počítá
        // i tokeny přemýšlení, proto je vyšší, než by potřebovala odpověď.
        reasoning: {effort: 'low'},
        max_tokens: 1200,
        stream: false,
      }),
      signal: AbortSignal.timeout(25000),
    })
    if (!r.ok) {
      console.error(`Chat: AI Gateway vrátila ${r.status} ${(await r.text()).slice(0, 300)}`)
      return response.status(502).json({chyba: `Pomocník teď neodpovídá. ${KONTAKT}`})
    }
    const data = await r.json()
    const odpoved = String(data?.choices?.[0]?.message?.content || '').trim()
    // Jen čísla, žádný text konverzace: kolik to stojí a který model odpověděl.
    console.info('Chat odpověď', JSON.stringify({model: data?.model, usage: data?.usage}))
    if (!odpoved) return response.status(502).json({chyba: `Na tohle teď neumím odpovědět. ${KONTAKT}`})
    return response.status(200).json({odpoved})
  } catch (e) {
    console.error(`Chat: volání AI Gateway selhalo (${e.name}: ${e.message})`)
    return response.status(504).json({chyba: `Odpověď trvá moc dlouho. Zkuste to prosím znovu, nebo ${KONTAKT.charAt(0).toLowerCase()}${KONTAKT.slice(1)}`})
  }
}
