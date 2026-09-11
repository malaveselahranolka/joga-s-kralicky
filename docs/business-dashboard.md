# Business dashboard

Stav: lokální implementace. Migrace není aplikovaná do produkce a žádné externí napojení nebylo autorizované.

## Architektura

- `business.html` je samostatná soukromá stránka. Sdílí existující Supabase session se `admin.html`; nová databáze rezervací nevzniká.
- `business/domain.js` obsahuje deterministické výpočty bez DOM, sítě a AI.
- `business/data.js` je jediná klientská vrstva pro Supabase a výslovně oddělený lokální demo režim.
- `business/ui.js` vykresluje osm pohledů. Graf je vlastní sémantické SVG s tabulkovou alternativou; nový frontendový framework ani grafová knihovna nejsou kvůli jednomu grafu potřeba.
- `business/app.js` řídí session, URL období, formuláře, CSV import, export a navigaci.
- `supabase/business-dashboard.sql` přidává business tabulky, RLS, serverový souhrn, idempotentní kalendář nákladů, verzování a audit.

Produkční cesta je `/business` → `/business.html`. Stránka má `noindex`, není v sitemapě a je zakázaná všem jmenovaným robotům. Toto není bezpečnostní vrstva; ochranu dat zajišťuje Supabase Auth a RLS.

## Datové vazby

| Zdroj | Business význam | Důležitá vazba |
| --- | --- | --- |
| `lessons` + `bookings` | uskutečněné lekce, doložené platby, zaplacená místa | `booking.lesson_id`; částka je historické `payment_amount`, nikdy dnešní cena |
| `vouchers` | peněžní příjem při prodeji | uplatnění bez vazby na lekci není druhý příjem ani domyšlený výnos |
| `business_cost_rules` | verzovaná pravidla nákladů | stabilní `rule_key`, rostoucí `version` |
| `business_cost_occurrences` | plánované/skutečné výskyty | unikátní `occurrence_key`; jeden výskyt se pouze přepíná na zaplaceno |
| `business_ledger_entries` | importované příjmy, refundace, poplatky, reklama, výdaje, převody | stabilní externí ID/fingerprint; odkazy na booking, voucher, náklad a kampaň |
| `business_budgets` | návrh, přijatý plán a historie | stabilní `budget_key`, verze a explicitní základ období |
| kampaně/příspěvky/metriky | analytika, ne účetní pravda | platformní atribuce zůstává oddělená od skutečných prodejů |
| connections/sync runs | stav a historie importů | poslední úspěch, kurzor, počet řádků, chyba |
| cíle/scénáře/poznámky/pohledy | plánovací vrstva | nikdy nepřepisuje skutečnost |

## Definice metrik

- Výnosy z lekcí: uložené částky zaplacených rezervací podle data lekce.
- Provozní náklady: zaplacené zahrnuté výskyty plus nespárované poplatky, reklama a ostatní výdaje. Spárovaný pohyb se nezapočte podruhé.
- Provozní výsledek: výnosy z lekcí minus refundace a provozní náklady. Jde o manažerský výsledek před daní, ne účetní čistý zisk.
- Čistý peněžní příjem z prodeje: platby rezervací, prodeje poukazů a jiný příjem minus refundace.
- Peněžní tok: čistý peněžní příjem minus skutečně zaplacené výdaje. Stripe payout je převod a má nulový vliv.
- Zaplacená místa: součet `spots`; skupina tří míst je jeden kupující a tři místa.
- Kupující: unikátní konzervativně normalizovaný e-mail. Ruční zástupné identity se vynechají.
- Uživatelé webu: agregace zdroje za celé období. Denní unikátní uživatelé se nesčítají.
- Reklamní návrh: `max(0, provozní výsledek) × sazba`, jednou zaokrouhleno. Při neúplném základu nevzniká spolehlivý návrh.

Časové hranice používají `Europe/Prague`. Měna je CZK v celých haléřích. Nula, chybějící hodnota a neúplný výsledek jsou rozdílné stavy.

## Obsluha

1. Období vyberte v horní části; vlastní rozsah se ukládá do URL bez osobních údajů.
2. Ve Financích přidejte náklad. Rozšířená pole zpřístupní platnost, typ a procentní základ.
3. Úprava aktivního pravidla vytvoří novou verzi. Historické skutečné výskyty zůstanou beze změny.
4. CSV import nejdřív mapuje sloupce a ukáže kontrolu řádků. Duplicitní externí ID nebo fingerprint se znovu nezapíše.
5. V Reportech lze exportovat filtrovaný CSV souhrn nebo použít tisk pro PDF.

## Bezpečné použití migrace

Migraci nespouštět automaticky. Nejprve vytvořit zálohu projektu a aplikovat `supabase/business-dashboard.sql` ve staging projektu. Potom přidat konkrétního vlastníka:

```sql
insert into public.business_access (user_id, role, active)
values ('UUID_EXISTUJICIHO_AUTH_UZIVATELE', 'owner', true);
```

Následně ověřit anonymní, přihlášený-neoprávněný a owner účet přímými REST dotazy. Teprve po této kontrole lze stejnou migraci aplikovat v produkci. Cron příklad je v SQL zakomentovaný; zapnout jej až po ověření ručního běhu. Nové tabulky používají explicitní granty a RLS podle aktuálních doporučení Supabase: https://supabase.com/docs/guides/database/postgres/row-level-security

## Známá omezení

- Soukromé doklady používají neveřejný bucket `business-attachments`, owner RLS a signed URL platný 60 sekund. Limit je 10 MB; PDF, JPG, PNG nebo WebP.
- Serverové read-only konektory jsou připravené v `supabase/functions/business-sync`, ale bez autorizace účtů nejsou nasazené ani živě ověřené. Dashboard nepřipojenou metriku nevydává za nulu.
- Srovnání s minulým rokem se bez historie nezobrazuje. Automatické prognózy, AI vysvětlení, publikování, změny reklamních rozpočtů, refundace a externí zprávy nejsou součástí lokální implementace.
- Schéma a RLS prošly statickou revizí, ne spuštěním proti staging Supabase.
