// =====================================================================
//  PLATNOST DÁRKOVÉHO POUKAZU — JEDINÝ ZDROJ PRAVDY
//
//  Číslo bývalo opsané na šesti místech (dvě Edge funkce, SQL funkce,
//  výchozí hodnota sloupce v databázi, e-mail a PDF poukázka) pokaždé
//  jako „365 dní" nebo „12 měsíců". Změnit platnost tak znamenalo najít
//  všech šest a na žádné nezapomenout — což nevyšlo: výchozí hodnota
//  sloupce v produkci a texty na webu se rozešly s tím, co funkce
//  opravdu zapisovaly.
//
//  Teď se mění TADY. Ostatní vrstvy si to nemůžou naimportovat
//  (Postgres a statické HTML nejsou Deno), takže mají vlastní opis
//  a `npm run verify` hlídá, že všechny říkají totéž:
//
//    * Postgres        → public.voucher_validity() v supabase/vouchers-lifecycle.sql
//    * prohlížeč/texty → payment-config.js → voucherValidityMonths
//
//  Když tady změníš číslo a jinde ne, kontrola spadne a vypíše, kde.
// =====================================================================

/** Kolik měsíců poukaz platí od vystavení. */
export const PLATNOST_MESICU = 6;

/**
 * Doba platnosti česky, i se správným tvarem slova „měsíc".
 * Do textů se sází tohle, ať se nikde neobjeví jiné číslo než výš.
 */
export const PLATNOST_TEXT = (() => {
  const n = PLATNOST_MESICU;
  const slovo = n === 1 ? "měsíc" : (n >= 2 && n <= 4 ? "měsíce" : "měsíců");
  return `${n} ${slovo}`;
})();

/**
 * Do kdy platí poukaz vystavený v `od`.
 *
 * Počítá se v KALENDÁŘNÍCH měsících, ne v pevném počtu dní — jinak by
 * se „šest měsíců" v e-mailu rozešlo s datem na poukázce podle toho,
 * kolik dní má zrovna půlrok. Postgres to dělá stejně (interval
 * '6 months'), takže datum z databáze a datum z funkce sedí.
 *
 * Konec měsíce se ořezává na poslední platný den, stejně jako v
 * Postgresu i jinde v projektu: 31. 8. + 6 měsíců = 28. 2., ne 3. 3.
 */
export function platnostDo(od: Date = new Date()): Date {
  const den = od.getUTCDate();
  const do_ = new Date(od.getTime());
  do_.setUTCDate(1);
  do_.setUTCMonth(do_.getUTCMonth() + PLATNOST_MESICU);
  const posledniDen = new Date(Date.UTC(do_.getUTCFullYear(), do_.getUTCMonth() + 1, 0)).getUTCDate();
  do_.setUTCDate(Math.min(den, posledniDen));
  return do_;
}

/** Totéž jako `platnostDo`, rovnou ve tvaru pro sloupec `vouchers.expires_at`. */
export function platnostDoISO(od: Date = new Date()): string {
  return platnostDo(od).toISOString();
}
