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
//  Nasazuj S ověřováním JWT (výchozí) — volá se z adminu s přihlášením
//  majitelky, ne z internetu.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  // Bez privátního klíče se nedá odeslat nic. Říkáme to rovnou a nahlas,
  // ať se v adminu pozná, že nejde o zaseknutou frontu, ale o chybějící
  // nastavení. (Fronta se přitom plní dál a o nic se nepřijde.)
  if (!emailReady()) {
    return json({
      ok: false,
      error: "emailjs_private_key_not_set",
      hint: "Supabase → Edge Functions → Secrets: doplň EMAILJS_PRIVATE_KEY " +
            "(EmailJS → Account → Security → Private Key; tamtéž povol API " +
            "požadavky mimo prohlížeč).",
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
