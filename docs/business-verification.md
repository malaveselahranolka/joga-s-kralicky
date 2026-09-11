# Ověření business dashboardu

Datum lokálního ověření: 11. září 2026. Větev: `codex/business-dashboard`.

## Provedeno

- `npm run test:business`: 25/25 testů prošlo. Pokryto přesné účetní jádro, procentní rozpočet i explicitní procentní náklad, nula/ztráta, týdenní/měsíční/roční kalendář, den 31, přestupný rok, náklad za místo, refundace/poplatek/payout, poukaz, chybějící částka, rozpočet/přečerpání, deduplikace, unikátní users, skupinová rezervace, doporučení/kapacita, CSV parser, kontrakty konektorů, serverové read-only request builders a odstranění osobních/neočekávaných polí ze Zapier souhrnu.
- `npm run check`: prošly business testy, původní kontrola zdrojového webu, build i kontrola hotového `public/`. Původní veřejné URL, odkazy, JSON-LD, sitemap a robots zůstaly validní.
- `npm run test:business-browser` při běžícím `node serve.mjs`: prošlo načtení všech osmi pohledů, přepnutí grafu, mobilní šířka bez celostránkového přetečení, uložený pohled, demo zápis nákladu s dokladem a CSV import do odděleného `localStorage`.
- `node --check business/app.js`, `ui.js` a `data.js`: prošlo.
- Ruční vizuální revize ve skutečném Chromu: dvě kola, šířky 390, 768 a 1440 px. Opraven nesoulad předvolby období, zbytečná výška mobilního grafu a typografická odezva tlačítek.

## Screenshoty

- `docs/screenshots/business-overview-390.png`
- `docs/screenshots/business-marketing-768.png`
- `docs/screenshots/business-sources-1440.png`

## Akceptační scénáře

| Oblast | Stav | Důkaz / omezení |
| --- | --- | --- |
| 100 000 − 60 000 = 40 000; 15 % = 6 000 | prošlo | unit test |
| nula/ztráta; opakování; 31. den; leap year | prošlo | unit test |
| bez duplicit při přepnutí na zaplaceno a CSV reimportu | jádro prošlo | unit + browser demo; databázový souběh až staging |
| payment/refund/fee/payout; poukaz | prošlo | unit test |
| webhook opakování a opožděná událost | kontrakt prošel | mapování/deduplikace testované; živý Stripe webhook je aktivní, naslouchá 3 událostem a v ověřeném okamžiku měl 0% chybovost |
| historická platba bez částky | prošlo | unit test + viditelný stav neúplnosti |
| rozpočet 6 000/2 000 a 7 000 | prošlo | unit test |
| users nejsou součet dnů; skupina je jeden kupující | prošlo | unit test |
| anonymous/unauthorized RLS | připraveno | policies v migraci; reálný test čeká na staging |
| období, návrat, uložený pohled, náklad/verze, import, export, chyby | implementováno | prohlížeč ověřil pohledy a zápis; produkční persistence čeká na migraci |
| doporučení nepřekročí rozpočet; malý vzorek; kapacita | prošlo | unit test |
| screenshoty 390/768/1440 | prošlo | dvě vizuální kola |
| veřejný tok, admin, CMS | staticky prošlo | `npm run check`; reálná platba správně neprovedena |

## Read-only ověření účtů

- Supabase projekt je dostupný a zdravý. Business migrace v něm není aplikovaná; projekt nemá dostupnou zálohu, proto se do produkce nic nezapisovalo.
- Stripe produkční účet je dostupný. Existující endpoint do Supabase je aktivní; nevznikl druhý webhook ani nový klíč.
- GA4 property je dostupná a sbírá návštěvy, události i checkout události. Metriky se podle definice a consentu liší od Vercel Web Analytics; zdroje se nesmějí slepě sčítat.
- Vercel projekt je dostupný a Web Analytics je aktivní. Obsahuje i interní návštěvy `/admin.html`; synchronizační kontrakt je proto filtruje stejně jako `/business.html`, preview a test provoz.

## Neověřeno a proč

- Produkční ani staging Supabase migrace nebyla spuštěna. Proto nebylo možné provést SQL runtime test, RLS test tří rolí, refresh persistence skutečných dat ani Cron.
- Stripe, GA4 a Vercel byly ověřené pouze přes přihlášené webové rozhraní. Serverové transporty jsou připravené lokálně, ale API oprávnění/tokeny nebyly vytvořené ani uložené, takže konektory nejsou vydávány za živé.
- Meta/Instagram/Facebook, Sklik a Zapier zatím nemají ověřené účty ani API oprávnění.
- Žádný deploy, merge, změna webhooku, reálná platba, refundace, reklamní změna, publikace ani externí zpráva nebyly provedeny.
- TikTok Ads/organic a Google Ads nebyly implementované. Vyžadují nejdřív potvrdit skutečně používané účty, oprávnění a API.

## Spuštění

```powershell
npm install
npm run check
node serve.mjs
$env:BUSINESS_CHROME_PATH='C:/Program Files/Google/Chrome/Application/chrome.exe'
npm run test:business-browser
```

Lokální ukázka: `http://localhost:3000/business.html?demo=1`. Parametr demo funguje jen na localhostu; produkce na demo při chybě nikdy nepřepne.
