// =====================================================================
//  DRUH DÁRKOVÉHO POUKAZU — na jakou lekci platí a kolik stojí
//
//  klasik  jeden vstup na lekci Jóga s králíčky (PAYMENT_VOUCHER_CZK, 499 Kč)
//  deti    lekce Děti & králíčci pro zákonného zástupce s jedním dítětem
//          (PAYMENT_DETI_CZK, 1 090 Kč — stejně jako vstup na tu lekci)
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

/** Cena jednoho poukazu v Kč podle druhu. */
export function cenaPoukazuKc(druh: PoukazDruh): number {
  return druh === "deti"
    ? Number(env("PAYMENT_DETI_CZK", "1090"))
    : Number(env("PAYMENT_VOUCHER_CZK", env("PAYMENT_ENTRY_CZK", "499")));
}

/** Na co poukaz platí — věta do e-mailu a na PDF poukázku. */
export const POUKAZ_NA: Record<PoukazDruh, string> = {
  klasik: "jednu lekci Jóga s králíčky",
  deti: "lekci Děti & králíčci pro zákonného zástupce s jedním dítětem",
};
