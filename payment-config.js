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

  // Lekce „Děti & králíčci“ (v databázi lessons.druh = 'deti'):
  // zákonný zástupce s jedním dítětem za detiCzk, každé další dítě detiDiteCzk,
  // nejvýš detiMaxDeti dětí na jednoho zástupce (1 + 3 navíc).
  // Místa v kapacitě = lidé, takže zástupce + 2 děti zaberou 3 místa.
  // Server: stripe-create (PAYMENT_DETI_CZK / PAYMENT_DETI_DITE_CZK, výchozí
  // 1090 / 500) a limit míst v supabase/deti-a-kralici.sql. Musí sedět.
  detiCzk: 1090,
  detiDiteCzk: 500,
  detiMaxDeti: 4,

  // Jak dlouho držíme místo nezaplacené rezervaci (minuty).
  // Musí odpovídat tomu, co nastavuje supabase/online-only.sql (35 min).
  holdMinutes: 35,

  // Dárkové poukazy — cenu × počet kusů počítá funkce stripe-voucher.
  voucherCzk: 499,
  maxVouchers: 10,   // kolik poukazů lze koupit najednou

  // Na jakou lekci poukaz platí. Kupuje se na koupit-poukaz.html (výběr se
  // ukáže, když jsou aktivní aspoň dva druhy). O tom, co jde koupit a za
  // kolik, rozhoduje server (supabase/functions/stripe-voucher → DRUHY);
  // tady je jen opis pro zobrazení. Dětský poukaz platí na zákonného
  // zástupce s 1 až detiMaxDeti dětmi (cena jako vstup: detiCzk + detiDiteCzk
  // za každé další dítě), uplatní se jen na lekci Děti & králíčci.
  voucherDruhy: [
    { id: 'klasik', nazev: 'Jóga s králíčky',
      popis: 'Jeden vstup na lekci jógy s králíčky pro dospělé.',
      aktivni: true },
    { id: 'deti', nazev: 'Děti & králíčci',
      popis: 'Lekce pro děti od 10 let. Poukaz platí na zákonného zástupce s 1 až 4 dětmi, každé další dítě 500 Kč.',
      cenaCzk: 1090,
      aktivni: true },
  ],

  // Jak dlouho platí nově vystavený poukaz (měsíce).
  //
  // Tohle je opis pro prohlížeč a pro kontrolu textů. Skutečnou platnost
  // razítkují na poukaz servery a ty mají vlastní zdroj pravdy:
  //   * Edge funkce → supabase/functions/_shared/poukaz-platnost.ts
  //   * databáze    → public.voucher_validity() (supabase/vouchers-lifecycle.sql)
  // `npm run verify` hlídá, že všechna tři čísla i texty na webu sedí,
  // takže změna na jednom místě bez ostatních neprojde.
  voucherValidityMonths: 6,

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
