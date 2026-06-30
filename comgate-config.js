// =====================================================================
//  Platby přes Comgate — veřejná konfigurace (bezpečné mít v prohlížeči)
// ---------------------------------------------------------------------
//  TAJNÝ klíč (secret) sem NIKDY nedávej! Ten patří jen na server
//  (Supabase Edge Function – viz NASTAVENI.md, sekce „Platby přes Comgate").
//
//  Dokud je enabled:false, web funguje úplně stejně jako teď —
//  rezervace je zdarma a žádné platby se nenabízí.
// =====================================================================
window.COMGATE = {
  // Zapni až když máš nasazené edge funkce a vyplněný functionsUrl níže.
  enabled: false,

  // Adresa tvých Supabase Edge Functions, např.:
  //   https://mglopjlgpfpturvqtjcj.functions.supabase.co
  // (Project Settings → API → "Project URL", jen vyměň .supabase.co za .functions.supabase.co)
  functionsUrl: '',

  // Výchozí výše zálohy v Kč (skutečnou částku hlídá i server, tohle je jen popisek v UI).
  depositCzk: 290,

  // Měna a jazyk platební brány
  currency: 'CZK',
  lang: 'cs',

  // Necháš true, dokud testuješ v Comgate „testovacím" režimu. Na ostro dej false.
  test: true,
};
