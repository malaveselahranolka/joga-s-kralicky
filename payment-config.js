// =====================================================================
//  Platby přes Stripe — veřejná konfigurace (bezpečné mít v prohlížeči)
// ---------------------------------------------------------------------
//  TAJNÝ klíč (Stripe secret key sk_...) sem NIKDY nedávej! Ten patří jen
//  na server (Supabase Edge Function – viz NASTAVENI.md, sekce „Platby").
//
//  Dokud je enabled:false, web funguje úplně stejně jako teď —
//  rezervace je zdarma a žádné platby se nenabízí.
// =====================================================================
window.PAYMENTS = {
  provider: 'stripe',

  // Zapni až když máš nasazené edge funkce a vyplněný functionsUrl níže.
  enabled: false,

  // Adresa tvých Supabase Edge Functions, např.:
  //   https://mglopjlgpfpturvqtjcj.functions.supabase.co
  // (Project URL má tvar https://REF.supabase.co → sem dej https://REF.functions.supabase.co)
  functionsUrl: '',

  // Výše zálohy v Kč (skutečnou částku hlídá i server, tohle je jen popisek v UI).
  depositCzk: 290,
};
