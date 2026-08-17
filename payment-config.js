// =====================================================================
//  Platby přes Stripe — veřejná konfigurace (bezpečné mít v prohlížeči)
// ---------------------------------------------------------------------
//  Vstup na lekci se platí VÝHRADNĚ ONLINE, hned při rezervaci.
//  Částku počítá SERVER (funkce stripe-create) jako cena × počet osob,
//  takže rezervace pro víc lidí na jedno jméno zaplatí správnou sumu.
//  Tady jsou jen údaje pro zobrazení v prohlížeči — žádný tajný klíč.
//
//  DŮLEŽITÉ: entryCzk musí sedět s tím, co má server v secretu
//  PAYMENT_ENTRY_CZK. Jinak by web ukazoval jinou cenu, než brána strhne.
//
//  enabled:false = nouzový režim (platby vypnuté, rezervace zdarma).
// =====================================================================
window.PAYMENTS = {
  provider: 'stripe',
  enabled: true,

  // Cena za JEDNO místo (Kč). Server: secret PAYMENT_ENTRY_CZK = stejné číslo.
  entryCzk: 499,

  // Kolik míst smí host koupit v jedné rezervaci (na jedno jméno).
  maxSpots: 4,

  // Jak dlouho držíme místo nezaplacené rezervaci (minuty).
  // Musí odpovídat tomu, co nastavuje supabase/online-only.sql (35 min).
  holdMinutes: 35,

  // Dárkový poukaz — hotový Stripe Payment Link (pevná částka, 1 ks):
  voucherUrl: 'https://buy.stripe.com/fZu28r7Dr6xLc8t1JH1gs00',
  voucherCzk: 499,

  // ZÁCHRANNÁ BRZDA. Starý pevný odkaz na jeden vstup za 499 Kč. Použije se
  // jen tehdy, když funkce stripe-create neodpoví (není nasazená, výpadek) —
  // a jen pro rezervaci na JEDNO místo, kde ta pevná částka sedí. U víc osob
  // se platba radši nespustí, aby nikdo nezaplatil míň, než má.
  fallbackEntryUrl: 'https://buy.stripe.com/4gM6oH8Hvg8l4G1agd1gs01',
};

// Zpětná kompatibilita se starším názvem (dřív se vstupu říkalo „záloha“).
window.PAYMENTS.depositCzk = window.PAYMENTS.entryCzk;
