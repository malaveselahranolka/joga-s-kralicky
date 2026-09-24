// =====================================================================
//  DRUH DÁRKOVÉHO POUKAZU — na jakou lekci platí a kolik stojí
//
//  klasik  jeden vstup na lekci Jóga s králíčky (PAYMENT_VOUCHER_CZK, 499 Kč)
//  deti    lekce Děti & králíčci pro zákonného zástupce s 1 až 4 dětmi
//          (PAYMENT_DETI_CZK 1 090 Kč za zástupce s jedním dítětem
//          + PAYMENT_DETI_DITE_CZK 500 Kč za každé další — stejně jako
//          vstup na tu lekci)
//
//  Počet dětí se ukládá do vouchers.deti (supabase/poukaz-deti-pocet.sql)
//  a podle něj poukaz při uplatnění zabere 1 + deti míst.
//
//  Druh se ukládá do vouchers.druh (supabase/poukaz-deti.sql) a podle něj
//  databáze pustí poukaz jen na správnou lekci. Stejnou tabulku cen má
//  i stripe-voucher (zakládá platbu) — musí sedět, jinak webhook platbu
//  odmítne jako voucher_amount_mismatch.
// =====================================================================

export type PoukazDruh = "klasik" | "deti";

/** Cokoli jiného než 'deti' (i chybějící hodnota ze starých plateb) je klasický poukaz. */
export const poukazDruh = (v: unknown): PoukazDruh => (v === "deti" ? "deti" : "klasik");

const env = (n: string, d = "") => Deno.env.get(n) ?? d;

/** Nejvíc dětí na jednoho zástupce (1 + 3 navíc), stejně jako u rezervace. */
export const POUKAZ_MAX_DETI = 4;

/**
 * Počet dětí na dětském poukazu (1–4). U klasického poukazu je vždy 1.
 * Chybějící hodnota (starší platby a řádky ve frontě) znamená 1 dítě.
 */
export function poukazDeti(druh: PoukazDruh, v: unknown): number {
  if (druh !== "deti") return 1;
  const n = Math.floor(Number(v) || 1);
  return Math.min(POUKAZ_MAX_DETI, Math.max(1, n));
}

/** Cena jednoho poukazu v Kč podle druhu (a u dětského podle počtu dětí). */
export function cenaPoukazuKc(druh: PoukazDruh, deti = 1): number {
  return druh === "deti"
    ? Number(env("PAYMENT_DETI_CZK", "1090")) +
      Number(env("PAYMENT_DETI_DITE_CZK", "500")) * (poukazDeti(druh, deti) - 1)
    : Number(env("PAYMENT_VOUCHER_CZK", env("PAYMENT_ENTRY_CZK", "499")));
}

/** „s jedním dítětem", „se dvěma dětmi"… */
export function sDetmi(deti: number): string {
  return ["s jedním dítětem", "se dvěma dětmi", "se třemi dětmi", "se čtyřmi dětmi"][
    Math.min(POUKAZ_MAX_DETI, Math.max(1, deti)) - 1
  ];
}

/** Na co poukaz platí — věta do e-mailu a na PDF poukázku. */
export function poukazNa(druh: PoukazDruh, deti = 1): string {
  return druh === "deti"
    ? `lekci Děti & králíčci pro zákonného zástupce ${sDetmi(poukazDeti(druh, deti))}`
    : "jednu lekci Jóga s králíčky";
}
