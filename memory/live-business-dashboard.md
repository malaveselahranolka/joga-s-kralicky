---
name: Live business dashboard deployment
description: Produkční stav soukromého business dashboardu k 11. 9. 2026
metadata:
  node_type: memory
  type: project
---

# Live business dashboard deployment

- Dne 11. 9. 2026 byl commit `429908b` nasazen jako aktuální Vercel produkce na `https://www.jogaskralicky.cz/business.html`.
- Business schéma a Edge Functions `business-sync` a `business-zapier` byly nasazeny do Supabase projektu `mglopjlgpfpturvqtjcj`.
- Supabase preview/staging větev nebyla vytvořena: dashboard vyžadoval Pro a uváděl cenu `$0.01344/h`. Migrace proto proběhla přímo na produkci v jedné transakci po lokálních testech.
- Audit po nasazení potvrdil, že stávající Stripe Edge Functions nebyly redeploynuty a nové business triggery neleží na žádné ne-business tabulce.

**Why:** Produkční stav, omezení plánu a ověřená izolace plateb nejsou spolehlivě odvoditelné jen z pracovního stromu.

**How to apply:** Při další změně dashboardu nejdřív ověř aktuální Vercel deployment a Supabase plán; bez výslovného souhlasu nevytvářej placenou staging větev. Platební funkce drž mimo business deploy.
