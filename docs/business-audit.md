# Audit business sekce (větev `codex/business-dashboard`)

Datum auditu: 15. 9. 2026. Auditovaný strom: `origin/codex/business-dashboard` (`f9d477e`),
základ `9415ba4` — tedy **4 commity za `main`**.

Auditováno bylo všech 34 souborů větve: `business.html`, `business/*.js` (7 souborů),
`supabase/business-dashboard.sql`, obě Edge Functions, testy, dokumentace i změny
v `scripts/`, `robots.txt`, `vercel.json` a `package.json`.

## Shrnutí

Sekce je promyšlená a na statický web nadstandardně poctivá: RLS je psaná defenzivně,
doklady jsou v neveřejném bucketu, auditní deník klient jen čte, částky se drží v haléřích,
demo běží jen na localhostu a rezervačního ani platebního toku se změna nedotýká.
`npm run check` po sloučení s `main` projde (28/28 testů) a mobil 390 px nepřetéká.

Hlavní problém není v tom, co chybí, ale v tom, že **dashboard umí zobrazit špatné číslo
jako správné**. Dokumentace si klade pravidlo „nula, chybějící hodnota a neúplný výsledek
jsou rozdílné stavy" — kód ho na několika místech porušuje: zamítnutý dotaz, chybějící
oprávnění nebo uříznutý limit skončí jako nula s odznakem „Úplná data".

Druhý problém: **ukázka slibuje víc než produkce**. Marketing v demu počítá ROAS
a rozděluje rozpočet; proti nasazenému schématu to nemůže fungovat nikdy.

Doporučení: větev **nesloučit** dřív, než se vyřeší body P0 níže. Bez nich sekce dává
majitelce čísla, o kterých nepozná, že jsou neúplná.

---

## P0 — vrací špatná čísla nebo tiše selže

### 1. Dva nezávislé systémy oprávnění, které se můžou rozejít

`public.is_owner()` v `supabase/schema.sql` má natvrdo jediný e-mail. `lessons`,
`bookings` i `vouchers` mají RLS postavenou na něm. Nová `public.business_has_access()`
v `supabase/business-dashboard.sql` je na tom nezávislá a ptá se jen na `business_access`.

Když se `business_access` udělí komukoli jinému než té jedné adrese (účetní, druhý účet
majitelky, vývojář), dopadne to takhle: přístup projde, business tabulky se načtou,
ale `lessons`/`bookings`/`vouchers` vrátí **prázdno bez chyby**. `business_period_summary`
je `security invoker`, takže i ono vrátí samé nuly — a `missing_amounts = 0`, tedy
`complete: true`. Výsledek: dashboard ukáže 0 Kč výnosů, 0 míst, 0 kupujících
a vedle toho odznak **„Úplná data"**.

Oprava: buď `business_has_access()` navázat i na `is_owner()`, nebo `business_period_summary`
udělat `security definer` s vlastní kontrolou, nebo (nejlevněji) při načtení ověřit,
že `lessons`/`bookings` vrací data, a jinak zobrazit tvrdou chybu místo nul.

### 2. Souhrn v SQL a v JS počítají jinak

Existují dvě nezávislé implementace stejných definic: `business_period_summary`
(`supabase/business-dashboard.sql`) a `computeFinancials` (`business/domain.js`).
Testy pokrývají jen tu druhou. Rozdíly, které jsem ověřil:

| Co | SQL | JS (fallback při chybě RPC) |
| --- | --- | --- |
| stav pohybu | jen `status = 'posted'` | vše kromě `'void'` — **počítá i `pending`** |
| rezervace | `join lessons` — rezervace bez lekce úplně vypadne | do hotovosti se započte i bez lekce |
| `missing_payment_amounts` | jedna rezervace = 1 | **jedna rezervace = 2** (ověřeno) |
| poukazy | sečte všechny řádky | dedupuje přes `id`/`code` |

Ověřeno: čekající Stripe poplatek 500 Kč se v JS objeví v nákladech, v SQL ne.
Jedna zaplacená rezervace bez částky nahlásí „2 platby bez částky".

Oprava: jeden zdroj pravdy. Buď SQL funkce jako jediná cesta a JS jen pro demo,
nebo test, který obě implementace porovná na stejném vzorku.

### 3. Měna se nikde nekontroluje

`mapStripeBalance` (`supabase/functions/_shared/business-sync-contracts.js`) bere
`row.currency` tak, jak přijde. Ani `computeFinancials`, ani `business_period_summary`
podle měny nefiltrují ani nepřevádí. Jedna platba v EUR se přičte k českým korunám
jako by to byly koruny. Databázový `check` hlídá jen tvar `^[A-Z]{3}$`.

Oprava: všechny součty omezit na `currency = 'CZK'` a jiné měny vypsat zvlášť
jako neúplnost, dokud nebude převod.

### 4. Časové pásmo se na třech místech ztratí

Dokumentace slibuje `Europe/Prague`, kód místy používá UTC:

- `business/data.js` — `markOccurrencePaid` zapisuje `new Date().toISOString().slice(0,10)`.
  Mezi půlnocí a 2:00 pražského času se náklad označí jako zaplacený **včerejškem**.
- `business/ui.js` — `trendChart` řadí do dnů přes `starts_at.slice(0,10)`
  a `occurred_at.slice(0,10)`, tedy podle UTC. Lekce ve 22:30 UTC spadne v grafu
  do jiného dne než v KPI nad ním. Graf a čísla nad ním se tedy nemusí shodovat.
- `business/csv.js` — `normalizeDate` má natvrdo `+02:00` (letní čas); v zimě je to
  špatný posun. Použití poledne to zachrání, ale je to náhoda, ne návrh.
- `business/app.js` — `presetPeriod('week')` počítá začátek týdne z `now.getDay()`,
  tedy z časového pásma prohlížeče, ne z Prahy.

### 5. Publikum počítá něco jiného, než co má v hlavičce

`audience()` v `business/ui.js` **vůbec nefiltruje podle období**. Pod nadpisem
„1. září 2026 – 30. září 2026" se tak zobrazí počty za všechny načtené rezervace.
Navíc si normalizuje e-mail po svém (`email.startsWith('rucne')`) místo
`normalizedBuyerEmail()` z `domain.js` — takže „Kupující" v Publiku a
„skutečných kupujících" v Přehledu jsou dvě různě spočítaná čísla ve stejné aplikaci.

### 6. Limity dotazů useknou historii bez varování

`business/data.js` načítá rezervace bez filtru na období s `.limit(5000)`,
poukazy s `.limit(1000)` a pohyby s `.limit(5000)`, vždy seřazené od nejnovějších.
Až studio překročí 5 000 rezervací, starší období začnou tiše ukazovat nižší tržby —
nic na to neupozorní. Také `occurrences` se načítají s `gte('scheduled_on', period.from)`,
takže náklad naplánovaný dřív a zaplacený uvnitř období do peněžního toku nespadne.

Oprava: filtrovat rezervace podle `paid_at`/`lesson_id` v období, a při dosažení
limitu vypsat výslovné upozornění „zobrazený výsledek je neúplný".

### 7. Zrušené lekce kazí obsazenost a bod zvratu

`overview()` i `plan()` sčítají `capacity` ze **všech** lekcí v období —
dotaz v `data.js` zrušené lekce nevyfiltrovává. Zrušená lekce tedy nafoukne kapacitu
a sníží obsazenost. `recurrenceOccurrences` v `domain.js` přitom zrušené lekce
správně vynechává, takže se dvě části kódu chovají opačně.

V `plan()` navíc „Fixní náklady období" sčítají výskyty **bez ohledu na `status`
i na `include_in_operating`** — na rozdíl od všeho ostatního, co počítá jen `status = 'paid'`.

### 8. Doporučení kanálů vrátí NaN

`recommendChannels` v `domain.js`: pokud všechny způsobilé kanály mají
`revenue_minor = 0`, je `totalScore = 0` a všechny částky vyjdou jako `NaN`.
Ověřeno — karta pak ukáže „— Kč" a přitom `evidence: 'measured'`.
Chybí pojistka `totalScore > 0`.

### 9. CSV import obrátí znaménka u běžného bankovního výpisu

`business/csv.js`: `kindFrom()` označí kladnou částku bez klíčového slova jako
`expense` a zápornou jako `income`; `mapCsvRows` pak znaménko zahodí (`Math.abs`).
Jenže bankovní i Stripe exporty běžně píšou **příjmy kladně a výdaje záporně** —
tedy přesně naopak. Import takového výpisu obrátí celý peněžní tok.

Dvě další slabiny na stejném místě:
- `import_fingerprint` obsahuje **pořadové číslo řádku**. Stejný export s jinak
  seřazenými řádky projde jako nové pohyby. Dokumentace přitom slibuje, že se
  duplicita nezapíše.
- `kindFrom` hledá podřetězec `'meta'` → poznámka „metadata" se stane reklamní útratou.

Oprava: znaménkovou konvenci nabídnout jako explicitní volbu v kroku mapování,
fingerprint počítat z obsahu řádku (bez indexu) a typ nechat potvrdit v náhledu.

### 10. Drobné, ale spolehlivě rozbije uložení

- `business/app.js` — `category_id: $('#costCategory').value` pošle prázdný řetězec,
  když se kategorie nenačtou. Postgres odpoví `invalid input syntax for type uuid`.
  Patří tam `|| null` (sloupec je nullable).
- `supabase/business-dashboard.sql` — trigger `business_close_previous_cost_rule`
  nastaví předchozí verzi `valid_to = new.valid_from - 1`. Když se nová verze
  zadá se **zpětným** datem, poruší to `check (valid_to >= valid_from)` a insert
  spadne na nesrozumitelnou chybu constraintu.
- `business-sync-contracts.js` — `booking_id` se bere z metadat Stripu bez ověření.
  Neexistující ID způsobí porušení cizího klíče a **celý běh synchronizace spadne**.
- `business/data.js` — `deleteCost` maže nejdřív výskyty, pak pravidla, bez transakce.
  Když druhý krok selže, výskyty jsou pryč a pravidlo zůstane. Patří to do RPC.

---

## P1 — funkce, které proti nasazenému schématu nemůžou fungovat

### 11. Celý Marketing je proti produkci prázdný

`ui.js` čte z kampaní sloupce `spend_minor`, `revenue_minor` a `purchases`.
Tabulka `business_campaigns` v `business-dashboard.sql` **žádný z nich nemá** —
má jen `source, external_id, name, channel, objective, starts_on, ends_on, status`.
Synchronizace (`business-sync/index.ts`) ukládá útratu a nákupy do
`business_daily_metrics` pod `dimension_key = 'campaign:<id>'` a **nic ty dvě tabulky
nespojuje**. `revenue_minor` (přiřazené tržby) nevyrábí vůbec žádný zdroj — atribuce
neexistuje.

Důsledek v produkci: tabulka „Kampaně" ukáže tři sloupce pomlček a
`recommendChannels` se kvůli `purchases = NaN` nespustí nikdy.

`business/demo-data.js` si ale ty sloupce **domyslí**, takže v demu to vypadá,
že funkce běží (viz `docs/screenshots/`). Ukázka tedy není věrný náhled produkce.

Oprava: buď dopočítat kampaňové metriky pohledem nad `business_daily_metrics`,
nebo ty sloupce do `business_campaigns` doplnit a plnit je při syncu.
A demo srovnat se schématem, ať neslibuje nemožné.

### 12. Polovina uložených objektů nemá jak vzniknout

`business/data.js` vystavuje `saveBudget`, `saveGoal`, `saveScenario` a `saveNote`.
**Žádná z nich se nikde nevolá.** V UI není formulář na rozpočet, cíl, scénář ani poznámku.

Praktické důsledky:
- „Schválený rámec" na Marketingu bude vždy 0 Kč, protože `accepted_minor` nemá kdo nastavit.
  Přehled tedy navrhne rozpočet, ale **navržený rozpočet nelze přijmout** — hlavní
  dokumentovaný pracovní postup (návrh → přijetí → čerpání) se nedá uzavřít.
- „Uložené scénáře" v Plánu mají prázdný stav s textem „Scénáře vzniknou po zadání
  růstu kapacity nebo ceny" — ale zadat je není kde.
- `business_goals` se načítá dotazem a **nikde se nevykresluje**. Zbytečný dotaz.

Dále: `ui.js` bere `data.budgets[0]` bez ohledu na `status`, takže se jako
„Schválený rámec" může zobrazit rozpočet ve stavu `proposal` nebo `superseded`.

### 13. Unikátní uživatelé nebudou dostupní skoro nikdy

`data.js` hledá `business_period_metrics` přes `.eq('period_start', …).eq('period_end', …)` —
tedy přesnou shodu. Řádky vyrábí jen sync pro konkrétní období. Jakmile si majitelka
zvolí vlastní rozsah, řádek neexistuje a „Uživatelé webu" jsou trvale nedostupní.
Chybí dopočet na vyžádání (nebo aspoň nabídka „načíst pro toto období").

### 14. Bod zvratu počítá z vymyšleného čísla

`ui.js`, funkce `plan()`: `breakEven({ priceMinor: 49900, variableCostMinor: 7000, … })`.

- 499 Kč je sice správná cena, ale je **opsaná natvrdo**. Projekt má na cenu jediný
  zdroj — `payment-config.js` (`entryCzk: 499`) — a `business.html` ho ani nenačítá.
  Po změně ceny bude Plán tiše počítat se starou.
- **70 Kč proměnného nákladu na místo nemá v datech oporu.** Je to odhad zobrazený
  jako výsledek. Je to přesně ten vzorec, před kterým varuje `CLAUDE.md`
  u bloku `.proof` („čísla byla vymyšlená… není odkud je dosadit").

Oprava: cenu brát z `payment-config.js`, proměnný náklad z pravidla `per_paid_spot`,
které majitelka skutečně zadala — a když neexistuje, bod zvratu nepočítat.

### 15. Import nejde vzít zpět

Nesprávně namapovaný CSV import zapíše stovky pohybů a **v UI není žádná cesta,
jak je smazat nebo označit `void`**. Importní dávka se v `business_import_batches`
eviduje, ale nikde se nezobrazuje. Zápis navíc probíhá **řádek po řádku**
(dva dotazy na řádek), takže 2 000řádkový Stripe export znamená ~4 000 požadavků
bez transakce; zavření prohlížeče uprostřed nechá dávku navždy ve stavu `importing`.

---

## P2 — viditelné vady a nedodělky

1. **Aktivní sekce se v menu nikdy nezvýrazní.** `app.js` používá
   `toggleAttribute('aria-current', …)`, což nastaví `aria-current=""`. CSS ale cílí na
   `a[aria-current="page"]` (`business.css`). Ověřeno v DOM — zvýraznění nefunguje
   vizuálně ani pro odečítače obrazovky. Oprava je jednořádková: `setAttribute('aria-current','page')`.
2. **Výběr období neodpovídá skutečnosti.** Při `?from=2026-09-01&to=2026-09-07`
   ukazuje rozbalovátko „Tento měsíc", zatímco popisek pod nadpisem správně hlásí
   1.–7. září. Ověřeno. `render()` `#periodPreset` nikdy nesynchronizuje.
3. **V tabulkách svítí anglické hodnoty z databáze** — `monthly`, `decision`, `INSERT`.
   `statusLabel()` existuje, ale pro `recurrence`, `note_type` a `action` chybí obdoba.
4. **Každý klik v menu je plné načtení stránky.** Odkazy v postranním panelu jsou
   běžné `<a href>` bez odchycení. Přepnutí z Přehledu na Finance znovu stáhne stránku,
   znovu ověří přihlášení a spustí **19 dotazů, RPC `business_generate_calendar_costs`
   a zápis odvozených výskytů**. Prohlížení dat tedy při každém kliknutí zapisuje do databáze.
5. **Slepá ulička při chybějícím oprávnění.** `showAuth('forbidden')` a
   `showAuth('migration_missing')` schovají přihlašovací formulář a **nenabídnou odhlášení**.
   Kdo se přihlásí nesprávným účtem, nemá ze stránky cestu ven. Zhoršuje to tlačítko
   „Business", které nová verze `admin.html` ukazuje každému přihlášenému.
6. **Chybová hláška tvrdí něco jiného, než se stalo.** `errors()` píše
   „Některá napojení vyžadují kontrolu… Zobrazené hodnoty jsou poslední dostupný stav."
   Jenže seznam obsahuje i selhané dotazy na `Lekce` a `Rezervace`, a zobrazené hodnoty
   nejsou poslední známý stav, ale **nuly**. Navíc `plan()`, `reports()` a `settings()`
   ten pruh nevykreslují vůbec — v Reportech se tedy dá vyexportovat tiše neúplný souhrn.
7. **Graf je na mobilu nečitelný.** `viewBox="0 0 880 250"` se na 390 px zmenší tak,
   že popisky os mají ~4 px. Tabulka „Přesná data grafu" pod ním existuje — na úzké
   obrazovce by měla být rozbalená a graf skrytý.
8. **Popisky os grafu nejsou zaokrouhlené** — „3 992 Kč", „−3 004 Kč". Tři linky
   v podílech 0/0,5/1 místo hezkých kroků.
9. **Podzáložky ve Financích nefungují jako záložky.** V `ui.js` má `#result` natvrdo
   `aria-current="page"`; při kliknutí na „Náklady" se to nepřenese.
10. **Auditní deník ukazuje jen datum bez času** (formátovač `date`), takže několik
    změn za den nelze odlišit.
11. **Export je tenký.** „Export CSV" vydá 6 řádků souhrnu. Chybí detailní export
    rezervací, nákladů a pohybů, tedy to, co by účetní skutečně chtěl.
12. **Demo je přibité na září 2026.** `demo-data.js` generuje data přes `iso(den)`
    s natvrdo `2026-09`. Od října bude ukázka prázdná.

---

## Co přidat

Seřazeno podle toho, co majitelce nejdřív ušetří práci:

1. **Panel zdraví dat** místo současného jednořádkového pruhu: které tabulky selhaly,
   jestli se narazilo na limit dotazu, kolik pohybů zůstalo nespárovaných s rezervací,
   kolik plateb nemá částku. Nula z chyby musí vypadat jinak než nula ze skutečnosti.
2. **Uzavření rozpočtového cyklu**: tlačítko „Přijmout návrh" na Přehledu, které založí
   `business_budgets` se `status = 'accepted'` — bez toho je celá marketingová část mrtvá.
3. **Spojení kampaní s metrikami** (pohled nad `business_daily_metrics`), ať tabulka
   Kampaně a doporučení kanálů mají odkud brát data.
4. **Editor scénáře** s cenou z `payment-config.js` a proměnným nákladem z reálného
   pravidla `per_paid_spot`; bez podkladu bod zvratu nepočítat.
5. **Srovnání s předchozím obdobím** (měsíc / stejný měsíc loni) — dokumentace to zmiňuje
   jako záměrně vynechané, ale je to to první, na co se u přehledu ptá každý.
6. **Správa importů**: seznam dávek, náhled a „vrátit dávku" (nastavit `status = 'void'`).
7. **Detailní exporty** rezervací, nákladů a pohybů za období, ne jen 6 KPI.
8. **Formuláře pro cíle a poznámky** — obojí už má tabulku, RLS i načítací dotaz.
9. **Vykreslení `business_goals`** (dnes se načítají a zahazují).
10. **Upozornění na neshodu Stripe vs. rezervace** — kolik plateb v ledgeru nemá
    protějšek mezi rezervacemi. To je jediná kontrola, která odhalí chybu dřív než účetní.

---

## Co je na škodu (zvážit odstranění)

- **Vymyšlených 70 Kč proměnného nákladu** v Plánu. Buď z dat, nebo pryč.
- **Demo, které umí víc než produkce** (kampaně se sloupci, jež v DB neexistují).
  Ukázka má být zmenšenina pravdy, ne lepší verze.
- **Marketingová sekce v současné podobě.** Dokud kampaně nemají data, je to prázdný
  slib; lepší ji dočasně skrýt než ji nechat ukazovat pomlčky.
- **Zápis do databáze při každém otevření pohledu.** Generování kalendáře nákladů patří
  do plánované úlohy (Cron už je v SQL připravený a zakomentovaný) nebo za výslovné
  tlačítko, ne do `load()`.
- **`camelizeRow()`** v `data.js` — funkce, která vrací vstup beze změny.
- **Dotaz na `business_goals`**, dokud se nevykresluje.
- **`BUSINESS_SYNC_SECRET`** v seznamu proměnných v `docs/business-integrations.md` —
  v kódu se nikde nepoužívá.
- **`Access-Control-Allow-Origin: '*'`** u obou Edge Functions. Autorizace to neobchází,
  ale u funkce nad finančními daty nemá důvod být otevřená.

---

## Poznámky k nasazení

- **Větev je 4 commity za `main` a stojí na stromě před odstraněním Sanity.**
  Ještě obsahuje `src/cms.js`, `scripts/seed-content.mjs` a `scripts/sync-content.mjs`.
  Zkušební sloučení s `main` ale proběhlo **bez konfliktu** a `npm run check` v něm
  prošel (28/28 testů, build i kontrola `public/`). Sanity soubory zůstaly smazané
  a `speed-insights.js` z `main` se zachoval. Přesto sloučit `main` do větve ještě
  před revizí, ať se recenzuje to, co se nasadí.
- **Dokumentovaný způsob ověření nejde zopakovat z čistého klonu.**
  `scripts/check-business-browser.mjs` má natvrdo windowsovou cestu ke Chromu
  a potřebuje `serve.mjs`, který je v `.gitignore`. Cesta k prohlížeči jde přebít přes
  `BUSINESS_CHROME_PATH`, server ne.
- `docs/business-verification.md` mluví o 25 testech, dnes jich je 28.
- **`verify_jwt` pro `business-sync` není nikde v repozitáři zafixované** (chybí
  `config.toml`). Funkce čte roli z JWT bez ověření podpisu — což je stejný vzorec,
  jaký používá a odůvodňuje existující `email-dispatch` (brána podpis ověří dřív).
  Není to tedy nová díra, ale je to položka nasazovacího seznamu: kdyby někdo
  `verify_jwt` vypnul, `business-sync` vydá klíč `service_role` komukoli.
- Migraci pouštět podle `docs/business-dashboard.md` — nejdřív staging, pak test
  tří rolí (anonym / přihlášený bez oprávnění / owner). RLS zatím nikdo nespustil.

## Co se při auditu ověřilo a co ne

**Ověřeno:** sloučení s `main` a `npm run check` (28/28); statické pročtení všech souborů
větve; spuštění ukázky v Chromiu na šířkách 390 a 1440 px (bez vodorovného přetečení);
kontrola DOM na `aria-current` a nesoulad výběru období; tři domain chyby spuštěné
v Node (`recommendChannels` → NaN, dvojí počítání `missingPaymentAmounts`, `pending`
pohyb v JS vs. SQL); porovnání sloupců `business_campaigns` proti tomu, co čte `ui.js`
a co zapisuje `business-sync`; ověření jednotek `payment_amount` a `vouchers.amount`
(obojí haléře) proti `supabase/payments.sql` a `supabase/vouchers.sql`.

**Neověřeno:** SQL za běhu — migrace není nasazená, takže `business_period_summary`,
`business_generate_calendar_costs`, triggery ani RLS neběžely proti skutečné databázi.
Žádný externí konektor se nespouštěl. Nic se nenasazovalo ani neměnilo v produkci.
