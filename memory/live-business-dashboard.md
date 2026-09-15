---
name: Live business dashboard deployment
description: Produkční stav soukromého business dashboardu k 12. 9. 2026
metadata:
  node_type: memory
  type: project
---

# Live business dashboard deployment

- Dne 12. 9. 2026 byl commit `7ab5c7d` povýšen do Vercel produkce na `https://www.jogaskralicky.cz/business.html`; odstranil nepodporované pole `day_of_week` z formuláře nákladů. Produkční uložení pravidla „Nájem studia“ 400 Kč za uskutečněnou lekci od 10. 9. 2026 vytvořilo 2 výskyty v celkové hodnotě 800 Kč.
- Business schéma a Edge Functions `business-sync` a `business-zapier` byly nasazeny do Supabase projektu `mglopjlgpfpturvqtjcj`.
- Supabase preview/staging větev nebyla vytvořena: dashboard vyžadoval Pro a uváděl cenu `$0.01344/h`. Migrace proto proběhla přímo na produkci v jedné transakci po lokálních testech.
- Audit po nasazení potvrdil, že stávající Stripe Edge Functions nebyly redeploynuty a nové business triggery neleží na žádné ne-business tabulce.
- Stripe read-only import dne 11. 9. 2026 uložil 9 ledger řádků. Vercel token je omezený na projekt `joga-s-kralicky`; import uložil 30 denních a 1 souhrnný řádek. Oprava limitu 100 řádků je v commitu `c81575c` a byla samostatně nasazena do `business-sync`.
- GA4 Data API má od 12. 9. 2026 služební účet s rolí pouze Prohlížející pro property `552235365`. Produkční import ověřil 11 denních a 1 souhrnný řádek; JSON klíč a property ID jsou pouze v Supabase Secrets.
- Sklik API Drak je od 12. 9. 2026 připojeno přes Supabase Secret; první synchronizace proběhla úspěšně a v aktuálním Sklik účtu našla 0 záznamů.
- Uživatel dne 12. 9. 2026 rozhodl TikTok a Zapier nepřipojovat. Přihlášený Google profil nemá Google Ads účet; nový nebyl založen, aby nevznikly žádné platební ani fakturační změny.
- Meta aplikace `Jóga Business Dashboard` (`1112724884410941`) byla 12. 9. 2026 vytvořena a dostala produkt Instagram. Přidání Instagram tester účtu/tokenu nešlo dokončit; uživatel rozhodl Meta napojení zastavit. Instagram, Facebook a Meta Ads proto zůstávají nepřipojené, dokud výslovně nepožádá pokračovat.
- Stažená lokální kopie GA4 klíče `C:\Users\adame\Downloads\joga-business-dashboard-63b0df719ed4.json` zůstala po úspěšném uložení v Supabase, protože automatické smazání zablokovala ochrana prostředí. Je nutné ji ručně smazat.

**Why:** Produkční stav, stav externích účtů, omezení plánu a ověřená izolace plateb nejsou spolehlivě odvoditelné jen z pracovního stromu.

**How to apply:** Při další změně dashboardu nejdřív ověř aktuální Vercel deployment a Supabase plán; bez výslovného souhlasu nevytvářej placenou staging větev. Platební funkce drž mimo business deploy. TikTok, Zapier a Meta znovu neřeš bez nové výslovné žádosti. Google Ads nezakládej bez zvláštního rozhodnutí uživatele.
