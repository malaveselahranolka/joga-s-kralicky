# Audit business sekce (větev `codex/business-dashboard`)

Datum auditu: 15. 9. 2026. Auditovaný strom: `origin/codex/business-dashboard` (`f9d477e`),
základ `9415ba4` — tedy **4 commity za `main`**.

> **Produkce je jinde, než tvrdí dokumentace větve (ověřeno 15. 9. 2026).**
> `docs/business-dashboard.md` i `docs/business-verification.md` píšou, že migrace
> není nasazená a konektory nejsou živé. **Obojí už neplatí.** Dotaz do produkčního
> Supabase ukázal: všech 19 business tabulek existuje, `business_access` má vlastníka,
> `business-sync` i `business-zapier` běží jako Edge Functions (`business-sync`
> s `verify_jwt = true`) a čtyři konektory už úspěšně importovaly data.
> Podrobnosti a zbývající mezery jsou v části *Skutečný stav produkce*.

> **Stav oprav (15. 9. 2026).** Body P0 a P2 jsou opravené na větvi
> `claude/business-section-audit-smryvh`, stejně jako P1 kromě výslovně
> uvedených výjimek. Každá oprava má regresní test (`npm run test:business`,
> 40 testů). Jednotlivé body si stav nesou u sebe, otevřené zbytky shrnuje
> závěrečná část *Co zůstalo otevřené*.

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

**Opraveno.** `business_period_summary` nově vrací `source_access` (= `public.is_owner()`)
a bez něj je `complete` vždy `false`. Klient z toho dělá blokující hlášku
místo nul s odznakem „Úplná data".


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

**Opraveno.** `computeFinancials` bere jen `status = 'posted'` (chybějící hodnota
dědí výchozí `posted` ze sloupce) a jedna rezervace bez částky se počítá jednou.


Existují dvě nezávislé implementace stejných definic: `business_period_summary`
(`supabase/business-dashboard.sql`) a `computeFinancials` (`business/domain.js`).
Testy pokrývají jen tu druhou. Rozdíly, které jsem ověřil:

| Co | SQL | JS (fallback při chybě RPC) |
| --- | --- | --- |
| stav pohybu | jen `status = 'posted'` | vše kromě `'void'` — **počítá i `pending`** |
| `missing_payment_amounts` | jedna rezervace = 1 | **jedna rezervace = 2** (ověřeno) |
| poukazy | sečte všechny řádky | dedupuje přes `id`/`code` |

*Oprava k původnímu znění auditu:* mezi rozdíly byl uvedený i `join lessons`
v SQL proti volnější vazbě v JS. To neplatí — `bookings.lesson_id` je
v `supabase/schema.sql` `not null` s cizím klíčem, takže rezervace bez lekce
vzniknout nemůže a obě implementace se tu rozejít nemají jak.

Ověřeno: čekající Stripe poplatek 500 Kč se v JS objeví v nákladech, v SQL ne.
Jedna zaplacená rezervace bez částky nahlásí „2 platby bez částky".

Oprava: jeden zdroj pravdy. Buď SQL funkce jako jediná cesta a JS jen pro demo,
nebo test, který obě implementace porovná na stejném vzorku.

### 3. Měna se nikde nekontroluje

**Opraveno.** Obě implementace sčítají jen `CZK`; cizí měna se počítá zvlášť jako
`foreign_currency_entries` a shodí úplnost na „Částečná data".


`mapStripeBalance` (`supabase/functions/_shared/business-sync-contracts.js`) bere
`row.currency` tak, jak přijde. Ani `computeFinancials`, ani `business_period_summary`
podle měny nefiltrují ani nepřevádí. Jedna platba v EUR se přičte k českým korunám
jako by to byly koruny. Databázový `check` hlídá jen tvar `^[A-Z]{3}$`.

Oprava: všechny součty omezit na `currency = 'CZK'` a jiné měny vypsat zvlášť
jako neúplnost, dokud nebude převod.

### 4. Časové pásmo se na třech místech ztratí

**Opraveno** na všech čtyřech místech: `pragueToday()` u úhrady nákladu,
`pragueDate()` v grafu, rozlišení zimního a letního posunu v CSV a pražský
začátek týdne v předvolbě období.


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

**Opraveno.** Publikum filtruje podle období a používá `normalizedBuyerEmail()`
společně s Přehledem.


`audience()` v `business/ui.js` **vůbec nefiltruje podle období**. Pod nadpisem
„1. září 2026 – 30. září 2026" se tak zobrazí počty za všechny načtené rezervace.
Navíc si normalizuje e-mail po svém (`email.startsWith('rucne')`) místo
`normalizedBuyerEmail()` z `domain.js` — takže „Kupující" v Publiku a
„skutečných kupujících" v Přehledu jsou dvě různě spočítaná čísla ve stejné aplikaci.

### 6. Limity dotazů useknou historii bez varování

**Opraveno.** Rezervace se načítají dvěma dotazy omezenými obdobím (lekce období
+ úhrady období) a slučují se podle `id`. Poukazy mají filtr období, výskyty
nákladů berou i náklad zaplacený uvnitř období. Dotaz, který se dotkl limitu,
hlásí neúplnost.


`business/data.js` načítá rezervace bez filtru na období s `.limit(5000)`,
poukazy s `.limit(1000)` a pohyby s `.limit(5000)`, vždy seřazené od nejnovějších.
Až studio překročí 5 000 rezervací, starší období začnou tiše ukazovat nižší tržby —
nic na to neupozorní. Také `occurrences` se načítají s `gte('scheduled_on', period.from)`,
takže náklad naplánovaný dřív a zaplacený uvnitř období do peněžního toku nespadne.

Oprava: filtrovat rezervace podle `paid_at`/`lesson_id` v období, a při dosažení
limitu vypsat výslovné upozornění „zobrazený výsledek je neúplný".

### 7. Zrušené lekce kazí obsazenost a bod zvratu

**Opraveno.** Kapacita počítá jen nezrušené lekce; fixní náklady v Plánu berou
jen zaplacené výskyty zahrnuté do provozního výsledku.


`overview()` i `plan()` sčítají `capacity` ze **všech** lekcí v období —
dotaz v `data.js` zrušené lekce nevyfiltrovává. Zrušená lekce tedy nafoukne kapacitu
a sníží obsazenost. `recurrenceOccurrences` v `domain.js` přitom zrušené lekce
správně vynechává, takže se dvě části kódu chovají opačně.

V `plan()` navíc „Fixní náklady období" sčítají výskyty **bez ohledu na `status`
i na `include_in_operating`** — na rozdíl od všeho ostatního, co počítá jen `status = 'paid'`.

### 8. Doporučení kanálů vrátí NaN

**Opraveno.** Nulový součet vah vrací prázdné rozdělení s `evidence: 'experiment'`.


`recommendChannels` v `domain.js`: pokud všechny způsobilé kanály mají
`revenue_minor = 0`, je `totalScore = 0` a všechny částky vyjdou jako `NaN`.
Ověřeno — karta pak ukáže „— Kč" a přitom `evidence: 'measured'`.
Chybí pojistka `totalScore > 0`.

### 9. CSV import obrátí znaménka u běžného bankovního výpisu

**Opraveno.** Znaménková konvence je volba v kroku mapování (výchozí „kladná
částka = příjem"), otisk se počítá z obsahu řádku místo jeho pořadí, klíčová
slova se porovnávají bez diakritiky (dřív se „výdaj" ani „převod" netrefily)
a `'meta'` už není vzorek pro reklamu.


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

**Opraveno** kromě posledního bodu: prázdná kategorie jde jako `null`, trigger
verzí drží `valid_to >= valid_from` i u zpětného data, Stripe `booking_id` se
ověřuje proti tvaru UUID. **Neopraveno:** `deleteCost` je pořád dvoukrokový
bez transakce — patří do RPC, což je zásah do migrace nad rámec oprav.


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

**Opraveno.** Útrata, prokliky a nákupy se spojují z `business_daily_metrics`
přes `dimension_key = 'campaign:<id>'`. Přiřazené tržby zůstávají prázdné,
protože je nikdo nevyrábí — a doporučení kanálů to nově řekne nahlas místo
tiché prázdné karty. Demo používá stejné sloupce jako migrace.


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

**Částečně opraveno.** Návrh rozpočtu jde přijmout tlačítkem v Přehledu, takže
cyklus návrh → přijetí → čerpání se uzavře; „Schválený rámec" ukazuje jen
rozpočet ve stavu `accepted`. Cíle se vykreslují v Plánu. **Neopraveno:**
formuláře na scénáře a poznámky — to je nová funkce, ne oprava.


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

**Neopraveno.** Dopočet metriky na vyžádání je nová funkce. Rozhraní ale už
neplete nedostupnost s nulou.


`data.js` hledá `business_period_metrics` přes `.eq('period_start', …).eq('period_end', …)` —
tedy přesnou shodu. Řádky vyrábí jen sync pro konkrétní období. Jakmile si majitelka
zvolí vlastní rozsah, řádek neexistuje a „Uživatelé webu" jsou trvale nedostupní.
Chybí dopočet na vyžádání (nebo aspoň nabídka „načíst pro toto období").

### 14. Bod zvratu počítá z vymyšleného čísla

**Opraveno.** Cena se bere z `payment-config.js`, proměnný náklad z pravidel
„za zaplacené místo". Bez nich se model nespočítá a Plán řekne, co chybí.


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

**Neopraveno.** Správa importních dávek je nová funkce.


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
12. **Finance, Marketing a Plán přetékaly na 390 px vodorovně.** Položka gridu
    se nezmenší pod šířku svého obsahu, takže široká tabulka roztáhla celý
    pohled místo aby se posouvala uvnitř svého rámu. Původní ověření to minulo,
    protože na mobilu zkoušelo jen Přehled. **Opraveno** (`min-width:0` na
    položkách gridu); nově se měří všech osm pohledů na 390, 768 i 1440 px.
13. **Demo je přibité na září 2026.** `demo-data.js` generuje data přes `iso(den)`
    s natvrdo `2026-09`. Od října bude ukázka prázdná. **Opraveno** (`setAttribute('aria-current','page')`). **Opraveno** — předvolba se dopočítá z období, jinak ukáže „Vlastní rozsah". **Opraveno** — opakování, typ poznámky i operace auditu mají české popisky. **Opraveno** — přepnutí pohledu překreslí z už načtených dat, bez dotazů a bez zápisu. **Opraveno** — na uvítací obrazovce přibylo „Odhlásit tento účet". **Opraveno** — hlášky rozlišují selhaný dotaz, useknutý výsledek a nepřipojený zdroj; pruh je i v Plánu, Reportech a Nastavení. **Opraveno** — pod 640 px se graf skryje a přesná tabulka je otevřená. **Opraveno** — osa používá kroky 1/2/2,5/5. **Opraveno** — natvrdo psané `aria-current` je pryč. **Opraveno** — deník ukazuje datum i čas v pražském pásmu. **Neopraveno** — detailní exporty jsou nová funkce. **Neopraveno** — ukázka zestárne, ale nic nerozbije.

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

---

## Co zůstalo otevřené

Opraveny byly chyby — věci, které vracely špatné číslo nebo nefungovaly.
Tohle jsou nové funkce, ne opravy, a zůstávají v seznamu *Co přidat*:

| Co | Proč to nebylo v opravách |
| --- | --- |
| Správa importních dávek a vrácení importu | nová obrazovka a nové RPC |
| Formuláře na scénáře a poznámky | nové funkce; cíle a rozpočet už fungují |
| Dopočet unikátních uživatelů pro vlastní období | vyžaduje volání konektoru na vyžádání |
| Detailní exporty rezervací, nákladů a pohybů | nová funkce |
| Srovnání s předchozím obdobím | nová funkce |
| Upozornění na neshodu Stripe vs. rezervace | nová funkce, potřebuje nasazený konektor |
| `deleteCost` v jedné transakci | patří do RPC, tedy zásah do migrace |
| Demo přepsat na relativní data | ukázka zestárne, nic ale nerozbije |

Dál platí i poznámky k nasazení: migrace se pořád musí projít přes staging,
RLS a obě SQL funkce nikdo nespustil proti skutečné databázi a `verify_jwt`
pro `business-sync` není v repozitáři zafixované.

## Ověření oprav

```bash
npm run check                 # 40 testů + kontrola zdroje, build a hotový public/
npm run test:business-browser # 8 sekcí, graf, mobil, náklad, CSV import
```

Kontrola prohlížeče si nově sama spustí statický server a najde Chrome podle
platformy, takže jde spustit z čistého klonu (`BUSINESS_CHROME_PATH` ji přebije).
Selhání externí CDN v demo režimu kontrolu neshodí, výjimka ve vlastním
skriptu ano.

---

## Skutečný stav produkce (ověřeno dotazem 15. 9. 2026)

`CLAUDE.md` varuje, že se produkční Supabase s repem rozchází. Rozchází se i tady:
dokumentace větve tvrdí, že migrace není nasazená a konektory nejsou živé —
ve skutečnosti běží obojí.

### Co běží

| Co | Stav |
| --- | --- |
| Business tabulky | všech 19 existuje, RLS zapnutá |
| `business_access` | 1 vlastník |
| `business-sync` | nasazená, `verify_jwt = true` |
| `business-zapier` | nasazená, `verify_jwt = false` (chrání ji vlastní `x-business-secret`) |
| Stripe | 2 běhy, 16 pohybů |
| GA4 | 3 běhy (2 úspěšné), 15 dnů + souhrn období |
| Vercel | 2 běhy (1 úspěšný), 30 dnů + souhrn období |
| Sklik | 1 běh, 0 řádků |
| Meta, Instagram, Facebook, TikTok, Google Ads, Zapier | nepřipojeno, žádný běh |

Účetní jádro proti skutečným datům sedí: za září 2026 vychází výnos 10 479 Kč,
což je přesně 21 zaplacených míst × 499 Kč. Plateb bez částky je 0.

### Co v produkci nesedí

1. **Stripe poplatky se nesbíraly. Opraveno.** V ledgeru bylo 14 pohybů typu
   `charge`, 1 refundace a 1 „Climate contribution" — ale **ani jeden `fee`**.
   Příčina: u karetní platby není poplatek samostatná balance transaction, je
   uvnitř pohybu v poli `fee`, a mapovač ho nečetl. `mapStripeEntries` teď
   z každého pohybu s nenulovým poplatkem vytvoří druhý záznam typu `fee`
   s odvozeným stabilním `external_id` (`txn_…:fee`), takže opakovaný import
   nic nezdvojí. **Pozor:** stávající řádky poplatek zpětně nedostanou — je
   potřeba nasadit `business-sync` a spustit Stripe synchronizaci za dané
   období znovu. Nové `external_id` zajistí, že se poplatky doplní bez dotčení
   už uložených pohybů.
2. **Vercel zapsal 15 budoucích dnů s nulou** a `complete = true`. Den, který
   nenastal, tak vypadá jako den bez návštěv. Klient je nově do součtu nebere,
   ale zapisovat se přestat musí v konektoru.
3. **Dva měřicí systémy se sčítaly dohromady.** GA4 hlásí za září 558 zobrazení,
   Vercel 998 za tentýž web; rozhraní je sčítalo na 1 556 a počet uživatelů bral
   z toho řádku, který se vrátil první (127 nebo 530 podle nálady databáze).
   **Opraveno** — zdroj se vybírá pevným pořadím (GA4, pak Vercel) a je vidět
   v popisku.
4. **Pohyby typu `adjustment` nepočítal nikdo. Opraveno.** V SQL ani v JS
   neměly větev, takže tiše mizely ze všech součtů. Nově se berou konzervativně
   jako výdaj a mapovač navíc určuje směr podle znaménka původní částky
   (záporná → `expense`, kladná → `income`), takže v kategorii `adjustment`
   zůstanou jen opravdu nejednoznačné případy. Ověřeno proti produkci: výdaje
   za září vzrostly z 0 Kč na 2,50 Kč, tedy o dosud neviditelnou korekci.
5. **Tři ze sedmi čekajících Stripe příjmů nemají vazbu na rezervaci. Opraveno.**
   Až se překlopí na `posted`, započítaly by se jako „jiný příjem" vedle částky
   z rezervace — tedy dvakrát. Nově platí pravidlo: platba ze Stripu vždycky
   patří k rezervaci nebo poukazu, a ty už jsou v příjmu z vlastních tabulek.
   Nespárovaný pohyb ze Stripu proto **není další příjem** — sčítá se zvlášť
   jako `unmatched_income`, shodí úplnost na „Částečná data" a ve Financích se
   vypíše výzva ke kontrole. Ruční a CSV příjem vlastní tabulku nemá, ten se
   počítá dál jako dosud.

   Párování podle částky a času by nepomohlo: k těmto pohybům existuje 1 až 3
   stejně pravděpodobných rezervací, takže by šlo o hádání. Příčina je
   pravděpodobně v tom, že `stripe-voucher` vkládá `metadata` jen do checkout
   session, ne do `payment_intent_data` jako `stripe-create` — poplatek za
   poukaz je taky 499 Kč, což sedí na všechny tři nespárované částky.
   **Návrh, neprovedeno:** doplnit `payment_intent_data: { metadata: { type:
   'voucher' } }` do `supabase/functions/stripe-voucher/index.ts` a mapovat
   `voucher_id`. Je to jednořádková a čistě doplňující změna, ale sahá do
   platebního toku, který `AGENTS.md` označuje za chráněný, a z tohoto
   prostředí ji nelze otestovat skutečnou platbou. Rozhodnutí patří majitelce.
6. **Marketing zůstane prázdný.** Oprava spojuje kampaně přes
   `dimension_key = 'campaign:<id>'`, jenže v produkci žádný takový řádek není:
   reklamní účty nejsou připojené a Sklik při jediném běhu nepřinesl nic.
7. **Opravy v `supabase/business-dashboard.sql` nejsou nasazené.** Produkce má
   pořád starou `business_period_summary` bez `source_access` i bez filtru měny.
   Klient to snese (chybějící `source_access` bere jako „přístup je v pořádku"),
   ale ochrany jsou do nasazení migrace nečinné.
8. **Nájem 400 Kč za lekci je správně** — potvrzeno majitelkou 15. 9. 2026.
   Studio se pronajímá za lekci, ne měsíčně, takže zářijové náklady 800 Kč za
   dvě uskutečněné lekce odpovídají skutečnosti.

---

## Nasazení do produkce 15. 9. 2026

Platebního toku (`stripe-create`, `stripe-webhook`, `stripe-confirm`,
`stripe-voucher`) se nasazení **nedotklo**.

### Co je nasazené

| Co | Jak ověřeno |
| --- | --- |
| `business_period_summary` — `source_access`, filtr měny, nespárovaný příjem, `adjustment` | migrace `business_summary_fees_adjustments_unmatched_income`; definice v produkci ověřena dotazem |
| `business_close_previous_cost_rule` — oprava zpětného data | tamtéž |
| `business-sync` verze 6 — poplatky Stripe, směr korekcí, ověření UUID | nasazeno s `verify_jwt = true`; funkce odpověděla `403 forbidden` na anon klíč, tedy modul se načetl a doběhl k vlastní kontrole oprávnění |

Postup byl: uložit stávající definice obou funkcí jako plán návratu → zkušebně
aplikovat v transakci a vrátit rollbackem (ověření syntaxe, otisky funkcí se
nezměnily) → teprve potom aplikovat migraci. Mění se jen dvě funkce, žádné
tabulky, politiky ani data.

### Dokončení nasazení

**Klientská část je živá.** PR #63 sloučen do `main` (merge `287d34e`), Vercel
nasadil produkci a `www.jogaskralicky.cz/business.html` už načítá
`payment-config.js`, tedy novou verzi. Vedlejší efekt, který stojí za zmínku:
produkce do té doby běžela z ručně povýšeného preview větve
`codex/business-dashboard`, která stála na stromě **4 commity za `main`** —
veřejnému webu tak chyběly poslední změny z mainu. Merge to srovnal.

**Poplatky Stripe se doplnily.** Synchronizace za 1. 7. – 30. 9. 2026 proběhla
úspěšně, 88 záznamů. Výsledek v ledgeru:

| Typ | Počet | Částka |
| --- | --- | --- |
| `fee` vyrovnané | 24 | 365,68 Kč |
| `fee` čekající | 7 | 120,37 Kč |
| `expense` (korekce podle znaménka) | 18 | 49,98 Kč |
| `income` vyrovnané | 24 (14 s vazbou) | 13 972 Kč |
| `refund` | 6 | 3 493 Kč |
| `transfer` (payouty) | 2 | 2 412,55 Kč |

Dopad na září 2026: poplatky **112,89 Kč** místo dosavadní nuly, korekce
2,50 Kč. Provozní výsledek tím klesl z 9 180 Kč na 9 064,61 Kč — přesně
o to nadhodnocení, které audit popsal. Nespárovaných plateb je za září 0,
takže období hlásí „Úplná data"; za celé červenec–září je jich 10 a období
správně hlásí „Částečná data".

### Co první běh shodil

První pokus o synchronizaci **selhal** na cizím klíči:

```
database_business_ledger_entries: ... violates foreign key constraint
"business_ledger_entries_booking_id_fkey"
```

Oprava z auditu ověřovala u `booking_id` z metadat Stripu jen **tvar UUID**,
ne existenci rezervace. Platby z července nesly UUID rezervací, které už
neexistují (zrušená lekce maže rezervace kaskádou), a celý běh spadl.
`business-sync` proto nově ověřuje vazby proti tabulce `bookings` a neznámou
zahodí na `null`; pohyb pak zůstane jako nespárovaný příjem, což souhrn umí
vykázat. Druhý běh po opravě prošel.

### Co živé není

**Reklamní účty.** Dokud není připojená Meta, Google Ads nebo TikTok, zůstane
Marketing prázdný — spojení kampaní přes `dimension_key = 'campaign:<id>'`
nemá co spojovat.

---

## Sazba platební brány a křížové ověření 16. 9. 2026

### Sazba 6,50 Kč + 1,5 %

Majitelka zadala sazbu brány. **Skutečné poplatky Stripu jí odpovídají na haléř**,
což potvrdila kontrola proti produkčním datům:

| Platba | Skutečný poplatek | Vzorec 6,50 + 1,5 % | Počet |
| --- | --- | --- | --- |
| 499 Kč | 13,99 Kč | 13,99 Kč | 24× |
| 998 Kč | 21,47 Kč | 21,47 Kč | 8× |

Sazba proto **nenahrazuje** naúčtované poplatky — ty zůstávají zdrojem pravdy.
Používá se tam, kde skutečný poplatek neexistuje nebo kde je potřeba kontrola:

- **Finance** srovnávají naúčtované poplatky s tím, co říká sazba, a rozdíl
  pojmenují. Za září je rozdíl −85,88 Kč, protože 141,84 Kč poplatků je
  ve stavu `pending` a do součtu se správně nepočítá.
- **Bod zvratu** poplatek brány konečně zná: proměnný náklad je 83,99 Kč
  (13,99 Kč brána + 70 Kč materiál) místo dosavadních 70 Kč. Bod zvratu se
  tím posunul z 24 na 25 míst. Model navíc funguje i bez pravidla „za
  zaplacené místo", protože poplatek je známý vždy.
- **Nastavení** sazbu zpřístupňují k úpravě (`business_settings.payment_fee`).
  Bez uloženého nastavení platí ověřená výchozí hodnota v JS i v SQL.

### Křížové ověření SQL proti JS

Audit vytýkal, že `business_period_summary` a `computeFinancials` jsou dvě
nezávislé implementace a testy pokrývají jen druhou. Ověřeno na skutečných
produkčních datech: nasazená SQL funkce byla spuštěna pod identitou majitelky
(`set local role authenticated` s jejím `sub`, celé v transakci s rollbackem),
stejná data pak prošla JS implementací.

**Všech 16 metrik ve dvou obdobích (září 2026 a červenec–září 2026) vyšlo
identicky** — včetně `expected_fees_minor`, `fee_gap_minor`,
`unmatched_income_entries` i `missing_payment_amounts`. Obě implementace tedy
na živých datech souhlasí.

Postup ke zopakování: vyexportovat `lessons`, `bookings`, `vouchers`,
`business_ledger_entries`, `business_cost_occurrences` a `business_settings`
jako JSON, pustit `computeFinancials` nad stejným obdobím a porovnat
s výstupem `business_period_summary`.

### Co kontrola ještě našla

**Chybějící částka se zobrazovala jako nula.** `Number(null)` i `Number('')`
je 0, takže `formatMoney(null)` vracelo „0 Kč" místo „—". V Přehledu to
znamenalo, že u návrhu rozpočtu svítilo **0 Kč** vedle věty „Výsledek není
úplný, proto automatický návrh nevznikl". Stejná chyba byla v `num()`, kde
nespočítaný bod zvratu ukazoval „0" míst. Opraveno sdílenou funkcí
`finiteNumber`; skutečná nula se dál zobrazuje jako nula.

**Sazba se zaokrouhlovala na koruny.** `formatMoney` má
`maximumFractionDigits: 0`, takže poplatek 13,99 Kč svítil jako „14 Kč".
U sazby a u srovnání poplatků haléře rozhodují, proto pro ně vznikl
`formatMoneyExact`.

---

## Oficiální zahájení provozu 5. 9. 2026

Majitelka určila, že provoz jede oficiálně od 5. září a všechno starší se
nemá počítat **nikde**. Datum je uložené v `business_settings.business_start`
a jde ho změnit v Nastavení; prázdná hodnota znamená, že se neořezává nic.

**Jak to funguje:** datum se neuplatňuje na jednotlivé druhy položek, ale na
celé období. `clampPeriod(period, startDate)` posune začátek na pozdější
z obou dat a všechny ostatní výpočty se pak ptají jen na období — o datu
zahájení nevědí a nemají se jak rozejít. Stejné je to v SQL: funkce si
`p_from` sama posune na `greatest(p_from, business_start)`.

Ořez platí i na dotazy, ne až na součty. `store.load()` proto čte nastavení
jako první a teprve pak se ptá na data — jinak by návštěvnost, kampaně nebo
poznámky pořád ukazovaly dobu před otevřením studia.

**Období celé před zahájením** (například srpen) není chyba ani neúplnost.
Vrací nuly s `period_empty: true` a s dokladem, co do nich nespadlo. Nula je
tady odpověď, ne mlčení.

**Doklad o ořezu.** Změna výsledku se nesmí stát potichu, takže se zvlášť
počítá, co ořez odnesl: `excluded_revenue_minor`, `excluded_costs_minor`
a `excluded_entries`. Rozhraní to ukáže v pruhu nad čísly a `labelPeriod()`
připíše k rozsahu „zkráceno zahájením provozu". V CSV exportu přibyly
`zvolene_od`, `zvolene_do` a `zahajeni_provozu`, aby se z vyvezeného čísla
dalo poznat, za jaké dny platí.

Dřívější verze ořezávala jen náklady a výnosy nechávala být. To dělalo
nesouměrnost, kvůli které období sahající před 5. 9. vycházelo příznivěji,
než jaká byla skutečnost. Ořez celého období ji ruší.

Dopad na produkční data (ověřeno dotazem 16. 9. 2026):

| Období | Provozní výsledek | Ořez odnesl |
| --- | --- | --- |
| září 2026 (1.–30. 9.) | 5 912,61 Kč (beze změny) | nic, 1.–4. 9. je prázdné |
| srpen 2026 | 0 Kč (dřív −998 Kč) | 33 záznamů: výnos 2 994 Kč, náklady 250,80 Kč |
| červen–září 2026 | 5 912,61 Kč (dřív −998 Kč navíc) | 42 záznamů: výnos 3 992 Kč, náklady 300,27 Kč |
| 10.–16. 9. 2026 | 1 779,56 Kč | nic, období je celé po zahájení |

Září se nezměnilo, protože mezi 1. a 4. 9. není v produkci jediná rezervace,
poukaz, náklad ani pohyb. Srpen se změnil z vymyšleného mínusu na poctivou
nulu: jeho výnos i náklady byly z doby, kdy studio ještě oficiálně neběželo.

## Poukazy: vlastní sekce a spojení s platbou

Sekce **Poukazy** v Business ukazuje prodej za zvolené období: kolik se jich
prodalo a za kolik, kolik jich čeká na uplatnění, kolik už bylo uplatněno
a kolik propadlo. Míra uplatnění se počítá jen z rozhodnutých kusů
(uplatněné + propadlé) — čerstvě prodaný poukaz s roční platností není
„neuplatněný", jen ještě nedozrál.

Nevyužitý poukaz je **závazek**: peníze na účtu už jsou, ale lekce se teprve
odehraje. Uplatnění proto není další tržba, jen dodání služby; sekce to říká
výslovně, aby se to nesčítalo dvakrát.

### Platba za poukaz neměla vazbu

Platba za poukaz dorazila do peněžních pohybů bez jakékoli značky, protože
metadata relace Checkoutu se na platbu samy nepřenášejí. Souhrn ji pak
vykazoval jako **nespárovaný příjem**, tedy jako mezera v párování —
přestože šlo o poctivý prodej, jen započítaný z tabulky poukazů.

Oprava má dvě části:

1. `stripe-voucher` posílá `payment_intent_data.metadata` s `type=voucher`,
   stejně jako `stripe-create` posílá `booking_id` u rezervací.
2. `business-sync` u příjmu bez vazby na rezervaci dohledá relaci Checkoutu
   přes `checkout/sessions?payment_intent=…` a spojí pohyb s poukazem podle
   `vouchers.session_id`. Díky tomu se doplnily i starší platby, které značku
   v metadatech ještě nemají.

Jeden nákup může nést několik poukazů, takže vazba je ukazatel na nákup, ne
na jeden kus — částky se stejně berou z tabulky poukazů.

Ověřeno v produkci 16. 9. 2026: po nasazení a spuštění synchronizace
(92 pohybů) má **všech pět prodaných poukazů vazbu na svou platbu**, včetně
dvou z doby před opravou. Součty se nezměnily: září zůstává na 5 912,61 Kč,
prodej poukazů 1 497 Kč, nespárovaný příjem 0.

---

### Křížové ověření po změně

Stejným postupem jako 16. 9.: nasazená SQL funkce spuštěná pod identitou
majitelky proti JS implementaci nad stejnými produkčními daty.
**24 metrik ve třech obdobích plus 12 metrik ve čtvrtém, žádný rozdíl** —
včetně nových `excluded_revenue_minor`, `excluded_costs_minor`,
`excluded_entries`, `period_from`, `period_clamped` a `period_empty`.
