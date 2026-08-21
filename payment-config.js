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

  // Dárkové poukazy — cenu × počet kusů počítá funkce stripe-voucher.
  voucherCzk: 499,
  maxVouchers: 10,   // kolik poukazů lze koupit najednou

  // POZOR — tady BÝVALY dva pevné Stripe Payment Linky jako „záchranná brzda",
  // kdyby funkce stripe-create / stripe-voucher neodpověděly. Jsou pryč
  // a ve Stripu deaktivované, protože se daly zneužít:
  //
  //   * u vstupu si kdokoli k odkazu připsal ?client_reference_id=<id cizí
  //     rezervace> a za jeden vstup si nechal potvrdit všechna její místa,
  //   * u poukazu odkaz neposílal metadata, takže webhook poukaz do databáze
  //     vůbec nezaložil — zákazník zaplatil a dostal kód neplatný u dveří.
  //
  // Když brána nejede, platba se teď nespustí vůbec. Nezaplacená rezervace
  // je menší problém než špatně zaplacená. Nevracej je sem.
};

// Zpětná kompatibilita se starším názvem (dřív se vstupu říkalo „záloha“).
window.PAYMENTS.depositCzk = window.PAYMENTS.entryCzk;
