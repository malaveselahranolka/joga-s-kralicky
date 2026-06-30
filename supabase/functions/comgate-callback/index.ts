// =====================================================================
//  comgate-callback — sem Comgate posílá oznámení o změně stavu platby
//  (server-to-server). Tuhle URL nastavíš v Comgate portálu.
//
//  Comgate pošle x-www-form-urlencoded (transId, status, refId, ...).
//  My si stav PRO JISTOTU ověříme dotazem na Comgate (status) a teprve
//  pak zapíšeme. Odpovíme přesně tělem:  code=0&message=OK
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { env, parseForm, paymentStatus, mapStatus } from "../_shared/comgate.ts";

Deno.serve(async (req) => {
  // Comgate volá POST; na cokoliv jiného slušně odpovíme.
  const okBody = () => new Response("code=0&message=OK", {
    status: 200, headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  try {
    if (req.method !== "POST") return okBody();
    const incoming = parseForm(await req.text());
    const transId = incoming.transId || incoming.transID;
    if (!transId) return okBody();

    // ověř stav přímo u Comgate (nevěř slepě tělu notifikace)
    const st = await paymentStatus(transId);
    const status = mapStatus(st.status);

    const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
    await sb.from("bookings").update({
      payment_status: status,
      paid_at: status === "paid" ? new Date().toISOString() : null,
    }).eq("payment_ref", transId);

    return okBody(); // Comgate vyžaduje právě tohle tělo
  } catch (_e) {
    // I při chybě vrať OK, ať Comgate notifikaci nezahlcuje opakováním;
    // stav si umíme dotáhnout přes comgate-status.
    return okBody();
  }
});
