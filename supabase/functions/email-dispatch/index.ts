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
//  Volat ji smí jen majitelka, NEBO pg_cron přes service_role klíč.
//
//  Pozor: samotné `verify_jwt` na majitelku nestačí — anon klíč je taky
//  platné JWT a je veřejně v supabase-config.js. Proto se níž u běžných
//  uživatelů ověřuje konkrétní přihlášený e-mail proti OWNER_EMAIL.
//
//  service_role klíč naproti tomu žádného přihlášeného uživatele nemá —
//  auth.getUser() by na něj vždycky vrátil chybu. Rozeznáváme ho podle
//  role v tělu JWT. Bezpečné bez dalšího ověřování podpisu: Supabase brána
//  s verify_jwt=true propustí dál jen požadavek s platně podepsaným JWT,
//  takže v okamžiku, kdy sem kód doběhne, je podpis už ověřený a payload
//  čteme jen kvůli obsahu, ne kvůli důvěryhodnosti.
//
//  Secrets: BREVO_API_KEY (viz ../_shared/email.ts)
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

function decodeJwtRole(token: string): string | null {
  try {
    const part = token.split(".")[1];
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
    const json = atob(b64 + pad);
    return JSON.parse(json)?.role ?? null;
  } catch (_e) {
    return null;
  }
}

// true = smí spustit rozeslání. Buď je to service_role (pg_cron, admin
// skript), nebo přihlášená majitelka.
async function callerAllowed(req: Request): Promise<boolean> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;

  if (decodeJwtRole(token) === "service_role") return true;

  try {
    const anon = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data, error } = await anon.auth.getUser(token);
    if (error) return false;
    return (data?.user?.email ?? "").toLowerCase() === OWNER_EMAIL.toLowerCase();
  } catch (_e) {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  if (!(await callerAllowed(req))) {
    return json({ ok: false, error: "forbidden" }, 403);
  }

  // Bez privátního klíče se nedá odeslat nic. Říkáme to rovnou a nahlas,
  // ať se v adminu pozná, že nejde o zaseknutou frontu, ale o chybějící
  // nastavení. (Fronta se přitom plní dál a o nic se nepřijde.)
  if (!emailReady()) {
    return json({
      ok: false,
      error: "email_provider_not_configured",
      hint: "Supabase → Edge Functions → Secrets: doplň BREVO_API_KEY " +
            "(app.brevo.com → SMTP & API, po ověření domény jogaskralicky.cz).",
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
