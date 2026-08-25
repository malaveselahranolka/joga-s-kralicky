// =====================================================================
//  email-dispatch — dožene, co se hned neodeslalo
//
//  stripe-webhook i stripe-confirm se pokusí e-mail odeslat rovnou. Když
//  to zrovna nevyjde (EmailJS má výpadek, trefili jsme limit 1 požadavek
//  za vteřinu, spadla síť), zůstane řádek ve frontě public.email_outbox
//  a čeká. Tahle funkce frontu projde a zkusí to znovu.
//
//  KDO JI VOLÁ
//    * tlačítko „Poslat znovu" v adminu — funguje hned, bez dalšího nastavení
//    * (nepovinně) pravidelný spouštěč, ať se to dožene i bez majitelky
//
//  Pravidelné spouštění přes pg_cron — v Supabase SQL Editoru zapni
//  rozšíření pg_cron a pg_net a spusť:
//
//    select cron.schedule('rozeslani-mailu', '*/5 * * * *', $$
//      select net.http_post(
//        url     := 'https://<projekt>.supabase.co/functions/v1/email-dispatch',
//        headers := jsonb_build_object('Authorization', 'Bearer <service_role_key>')
//      )
//    $$);
//
//  Volat ji smí jen majitelka. Pozor: samotné `verify_jwt` na to nestačí —
//  anon klíč je taky platné JWT a je veřejně v supabase-config.js. Proto se
//  níž ověřuje konkrétní přihlášený uživatel proti OWNER_EMAIL.
//
//  Secrets: EMAILJS_PRIVATE_KEY (viz ../_shared/email.ts)
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dispatch, emailReady } from "../_shared/email.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const env = (n: string, d = "") => Deno.env.get(n) ?? d;

// Musí sedět s public.is_owner() v supabase/schema.sql.
const OWNER_EMAIL = env("OWNER_EMAIL", "kovacikovabarbora71@gmail.com");

// Vrátí e-mail přihlášeného uživatele, nebo null. Token ověřuje Supabase,
// my mu jen podáme hlavičku — vlastní dekódování JWT by bylo k ničemu,
// protože podpis si stejně musí zkontrolovat někdo jiný.
async function callerEmail(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  try {
    const anon = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data, error } = await anon.auth.getUser(token);
    if (error) return null;
    return data?.user?.email ?? null;
  } catch (_e) {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  const who = await callerEmail(req);
  if (!who || who.toLowerCase() !== OWNER_EMAIL.toLowerCase()) {
    return json({ ok: false, error: "forbidden" }, 403);
  }

  // Bez privátního klíče se nedá odeslat nic. Říkáme to rovnou a nahlas,
  // ať se v adminu pozná, že nejde o zaseknutou frontu, ale o chybějící
  // nastavení. (Fronta se přitom plní dál a o nic se nepřijde.)
  if (!emailReady()) {
    return json({
      ok: false,
      error: "email_provider_not_configured",
      hint: "Supabase → Edge Functions → Secrets: doplň RESEND_API_KEY " +
            "(resend.com, po ověření domény jogaskralicky.cz). Případně " +
            "EMAILJS_PRIVATE_KEY, chceš-li zůstat u EmailJS.",
    }, 503);
  }

  try {
    const { limit } = await req.json().catch(() => ({}));
    const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
    const result = await dispatch(admin, Math.max(1, Math.min(Number(limit) || 10, 25)));
    return json({ ok: true, ...result });
  } catch (e) {
    return json({ ok: false, error: "server_error", detail: String(e) }, 500);
  }
});
