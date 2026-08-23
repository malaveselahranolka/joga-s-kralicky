// =====================================================================
//  Sběrné místo pro hlášení o porušení CSP
//
//  Politika běží zatím v režimu Report-Only — nic neblokuje, jen hlásí.
//  Jenže dokud hlášení neměla kam chodit, prohlížeč je zahodil a my jsme
//  o žádném porušení nevěděli. Bez toho nejde CSP nikdy zapnout naostro:
//  člověk netuší, co by se rozbilo.
//
//  Jak to používat:
//    1) nech to běžet pár dní, prohlížeči sem pošlou, co politika chytá
//    2) v logu Vercelu (`vercel logs`) hledej řádky „CSP porušení"
//    3) každý nález buď oprav, nebo přidej do politiky ve vercel.json
//    4) až bude log čistý, přepni hlavičku z
//       Content-Security-Policy-Report-Only na Content-Security-Policy
//
//  Prohlížeče posílají dva různé formáty, proto ta dvojkolejnost níž:
//    * starší: Content-Type application/csp-report, tělo {"csp-report": {...}}
//    * novější Reporting API: application/reports+json, tělo [{type, body}]
// =====================================================================

// Hlášení chodí bez přihlášení a z libovolné stránky, takže se z endpointu
// nesmí stát skládka. Delší tělo než tohle nedává smysl ani u nejdelší
// politiky — takové zahodíme, aniž bychom ho parsovali.
const MAX_BODY = 16 * 1024

function normalize(payload) {
  // starý formát
  if (payload && payload['csp-report']) {
    const r = payload['csp-report']
    return [{
      documentURL: r['document-uri'],
      blockedURL: r['blocked-uri'],
      directive: r['effective-directive'] || r['violated-directive'],
      disposition: r.disposition,
    }]
  }
  // Reporting API — pole hlášení, zajímají nás jen ta o CSP
  if (Array.isArray(payload)) {
    return payload
      .filter((item) => item && item.type === 'csp-violation' && item.body)
      .map((item) => ({
        documentURL: item.body.documentURL,
        blockedURL: item.body.blockedURL,
        directive: item.body.effectiveDirective,
        disposition: item.body.disposition,
      }))
  }
  return []
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return response.status(405).end()
  }

  try {
    const raw = typeof request.body === 'string' ? request.body : JSON.stringify(request.body ?? '')
    if (raw.length > MAX_BODY) return response.status(413).end()
    const payload = typeof request.body === 'string' ? JSON.parse(request.body) : request.body

    for (const v of normalize(payload)) {
      console.warn('CSP porušení', JSON.stringify({
        directive: v.directive,
        blocked: v.blockedURL,
        page: v.documentURL,
        rezim: v.disposition,   // 'report' = jen hlásíme, 'enforce' = blokovali bychom
      }))
    }
  } catch (_e) {
    // Nevalidní hlášení není náš problém a nemá cenu kvůli němu vracet chybu —
    // prohlížeč by to stejně jen zkusil znovu.
  }

  // 204: přijato, nic nevracíme
  return response.status(204).end()
}
