// =====================================================================
//  Sdílené pomocné funkce pro Comgate Edge Functions
//  Comgate Connect API v1.0 — https://help.comgate.cz/docs/api-protokol
//
//  Tajné údaje se čtou z prostředí (Supabase secrets), NIKDY z repa:
//    COMGATE_MERCHANT  – číslo e-shopu (merchant ID)
//    COMGATE_SECRET    – heslo pro propojení (secret)
//    COMGATE_TEST      – "true" / "false" (testovací režim brány)
//    COMGATE_DEPOSIT_CZK – výše zálohy v Kč (server si ji hlídá sám)
// =====================================================================

const COMGATE_BASE = "https://payments.comgate.cz/v1.0";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

export function env(name: string, fallback = ""): string {
  return Deno.env.get(name) ?? fallback;
}

export function comgateCreds() {
  return {
    merchant: env("COMGATE_MERCHANT"),
    secret: env("COMGATE_SECRET"),
    test: env("COMGATE_TEST", "true") === "true",
  };
}

// Comgate vrací i přijímá data jako application/x-www-form-urlencoded.
export function parseForm(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(text)) out[k] = v;
  return out;
}

async function comgatePost(path: string, params: Record<string, string>) {
  const res = await fetch(`${COMGATE_BASE}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  return parseForm(await res.text());
}

// Založí platbu (prepareOnly) a vrátí { code, transId, redirect, message }.
export async function createPayment(opts: {
  priceHaler: number; // cena v haléřích (Kč × 100)
  curr: string;
  label: string;
  refId: string;
  email: string;
  lang: string;
}) {
  const { merchant, secret, test } = comgateCreds();
  return await comgatePost("create", {
    merchant,
    secret,
    price: String(opts.priceHaler),
    curr: opts.curr,
    label: opts.label,
    refId: opts.refId,
    method: "ALL",
    email: opts.email,
    prepareOnly: "true",
    country: "CZ",
    lang: opts.lang,
    test: test ? "true" : "false",
  });
}

// Zjistí stav platby podle transId → { code, status, price, refId, ... }
export async function paymentStatus(transId: string) {
  const { merchant, secret } = comgateCreds();
  return await comgatePost("status", { merchant, secret, transId });
}

// Mapování Comgate stavu na náš payment_status
export function mapStatus(comgate: string): "paid" | "pending" | "cancelled" | "failed" {
  switch ((comgate || "").toUpperCase()) {
    case "PAID": return "paid";
    case "AUTHORIZED":
    case "PENDING": return "pending";
    case "CANCELLED": return "cancelled";
    default: return "failed";
  }
}
