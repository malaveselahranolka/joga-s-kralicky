// =====================================================================
//  newsletter-send — rozešle newsletter všem přihlášeným odběratelům
//  Volá se z adminu (jen přihlášená majitelka). Vstup: { subject, message }
//  Posílá přes Brevo (https://www.brevo.com) transactional API,
//  každý příjemce dostane vlastní e-mail (adresy se navzájem nevidí).
//
//  Tajné údaje z prostředí (Supabase secrets):
//    BREVO_API_KEY          – API klíč z Brevo (SMTP & API → API Keys)
//    NEWSLETTER_FROM_EMAIL  – ověřený odesílatel v Brevo
//    NEWSLETTER_FROM_NAME   – jméno odesílatele (nepovinné)
//    SITE_URL               – adresa webu (pro odhlašovací odkaz)
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

  try {
    // 1) ověř, že volá přihlášená majitelka
    const auth = req.headers.get("Authorization") || "";
    if (!auth) return json({ ok: false, error: "unauthorized" }, 401);
    const asUser = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: auth } },
    });
    const { data: isOwner, error: ownErr } = await asUser.rpc("is_owner");
    if (ownErr || isOwner !== true) return json({ ok: false, error: "forbidden" }, 403);

    // 2) obsah
    const { subject, message } = await req.json().catch(() => ({}));
    if (!String(subject || "").trim() || !String(message || "").trim())
      return json({ ok: false, error: "missing_content" }, 400);

    // 3) Brevo nastavení
    const BREVO = env("BREVO_API_KEY");
    const fromEmail = env("NEWSLETTER_FROM_EMAIL");
    if (!BREVO || !fromEmail) return json({ ok: false, error: "brevo_not_configured" }, 500);
    const fromName = env("NEWSLETTER_FROM_NAME", "Jóga s králíčky");
    const site = env("SITE_URL", "https://malaveselahranolka.github.io/joga-s-kralicky/");

    // 4) načti aktivní odběratele (service-role, mimo RLS)
    const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
    const { data: subs, error } = await admin
      .from("newsletter_subscribers").select("email").eq("unsubscribed", false);
    if (error) return json({ ok: false, error: "db_error" }, 500);
    if (!subs || !subs.length) return json({ ok: true, sent: 0 });

    // 5) sestav HTML + rozešli (po dávkách, každý příjemce vlastní verzi)
    const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
    const bodyHtml = esc(String(message)).replace(/\n/g, "<br>");
    const html = (email: string) =>
      `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;color:#1E231C;line-height:1.6;font-size:16px">` +
      `<p style="margin:0 0 16px">${bodyHtml}</p>` +
      `<hr style="border:none;border-top:1px solid #E3DFD3;margin:26px 0">` +
      `<p style="font-size:12px;color:#5C6357;margin:0">Tenhle e-mail ti chodí, protože ses přihlásil k odběru na jogaskralicky.cz. ` +
      `<a href="${site}${site.includes("?") ? "&" : "?"}unsub=${encodeURIComponent(email)}" style="color:#6E8A4E">Odhlásit odběr</a>.</p>` +
      `</div>`;

    let sent = 0;
    for (let i = 0; i < subs.length; i += 900) {
      const chunk = subs.slice(i, i + 900);
      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": BREVO, "content-type": "application/json", "accept": "application/json" },
        body: JSON.stringify({
          sender: { name: fromName, email: fromEmail },
          subject: String(subject),
          htmlContent: html(chunk[0].email),
          messageVersions: chunk.map((s) => ({ to: [{ email: s.email }], htmlContent: html(s.email) })),
        }),
      });
      if (!res.ok) return json({ ok: false, error: "brevo_error", detail: await res.text(), sent }, 502);
      sent += chunk.length;
    }
    return json({ ok: true, sent });
  } catch (e) {
    return json({ ok: false, error: "server_error", detail: String(e) }, 500);
  }
});
