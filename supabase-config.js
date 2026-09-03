// =====================================================================
//  Připojení k Supabase  —  vyplň dvě hodnoty níže
// ---------------------------------------------------------------------
//  1) Založ si zdarma projekt na https://supabase.com
//  2) V projektu otevři:  Settings (ozubené kolo) → API
//  3) Zkopíruj sem:
//       • "Project URL"        → SUPABASE_URL     (např. https://abcd1234.supabase.co)
//       • "anon public" klíč   → SUPABASE_ANON_KEY (dlouhý, začíná na "eyJ...")
//  4) Ulož soubor a nahraj na web (commit + push).
//
//  Tyto hodnoty jsou určené k tomu, aby byly v prohlížeči veřejné.
//  Data chrání bezpečnostní pravidla v databázi (schema.sql), ne tajnost klíče.
// =====================================================================

window.SUPABASE_URL      = 'https://mglopjlgpfpturvqtjcj.supabase.co';
window.SUPABASE_ANON_KEY = 'sb_publishable_fSK0f_Mv-WFaKnvxwTu5BA_NxYV-U9_';

// =====================================================================
//  E-maily
// ---------------------------------------------------------------------
//  Potvrzení rezervací, poukazy i newsletter odesílá SERVER přes Brevo
//  (fronta public.email_outbox, klíč BREVO_API_KEY v Supabase secrets).
//  Prohlížeč žádný e-mail neposílá, proto tu nejsou žádné klíče.
//
//  Do 3. 9. 2026 tu ležela konfigurace EmailJS jako záložní cesta
//  z prohlížeče. Nepoužívala se — server hlásí serverEmail: true,
//  jakmile je Brevo nastavené — a kvůli ní se na každé zobrazení
//  rezervace i homepage stahoval skript z cizí domény.
// =====================================================================
