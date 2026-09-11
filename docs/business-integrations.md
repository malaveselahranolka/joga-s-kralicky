# Business integrace

Externí API synchronizace zatím nejsou nasazené ani aktivní. Produkční Stripe webhook už existuje a je funkční pro rezervační tok; business ledger z něj zatím nevzniká. Lokální `business-sync` připravuje read-only importy Stripe, GA4, Vercel, Meta Ads, Instagram, Facebook Page, TikTok Ads/organic, Google Ads a Sklik. `business-zapier` připravuje omezený, deduplikovaný příjem a výslovně vyvolané souhrny. Tokeny nesmějí být v `business.html`, klientském JavaScriptu, URL, Git repozitáři ani logu. Patří do Supabase Edge Function secrets nebo jiného schváleného serverového secret store.

Čisté kontrakty v `business/integration-contracts.js` a `supabase/functions/_shared/business-sync-contracts.js` ověřují veřejné cesty, nulovou versus chybějící metriku, správnou agregaci users, mapování Stripe pohybu, stáří spojení, nejnovější verzi externí události a tvary read-only požadavků. Síťový transport je implementovaný lokálně; bez nasazení, migrace a oprávnění účtů nebyl vydáván za živý.

## Proměnné bez hodnot

```text
BUSINESS_SYNC_SECRET=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
GA4_PROPERTY_ID=
GOOGLE_SERVICE_ACCOUNT_JSON=
VERCEL_ACCESS_TOKEN=
VERCEL_TEAM_ID=
VERCEL_PROJECT_ID=
META_ACCESS_TOKEN=
META_AD_ACCOUNT_ID=
META_PAGE_ID=
META_INSTAGRAM_ACCOUNT_ID=
META_GRAPH_VERSION=v24.0
TIKTOK_ACCESS_TOKEN=
TIKTOK_ADVERTISER_ID=
TIKTOK_CREATOR_ACCESS_TOKEN=
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REFRESH_TOKEN=
GOOGLE_ADS_DEVELOPER_TOKEN=
GOOGLE_ADS_CUSTOMER_ID=
GOOGLE_ADS_LOGIN_CUSTOMER_ID=
GOOGLE_ADS_API_VERSION=v25
SKLIK_API_TOKEN=
SKLIK_ACCOUNT_ID=
ZAPIER_INBOUND_SECRET=
ZAPIER_OUTBOUND_WEBHOOK_URL=
```

Přesné názvy lze při implementaci serverových funkcí upravit; hodnoty nikdy necommitovat.

## Kontrakty a bezpečný provoz

| Zdroj | Minimální oprávnění a mapování | Frekvence / historie | Chyba a obnova |
| --- | --- | --- | --- |
| Stripe | jen čtení plateb, refunds, fees a balance transactions; webhook ověřuje podpis; stabilní event/transaction ID | webhook průběžně, denní zpětná kontrola; stránkovat po kurzoru | duplicitní událost je no-op; starší stav nesmí přepsat novější; payout mapovat jako `transfer` |
| GA4 Data API | service account s Viewer přístupem k jedné property; users/sessions/views za `Europe/Prague` a veřejné cesty | denní import plus agregace přesného období; dostupnost dle retention property | chybějící consent neblokuje rezervaci; unikátní uživatele nikdy nesčítat z dnů |
| Vercel Web Analytics | read-only token omezený na projekt; visits/events, bez admin/business/preview/test provozu | denně, poslední úspěšný kurzor | stav `stale` po překročení intervalu; poslední hodnotu označit datem |
| Meta Ads/Page/Instagram | pouze insights pro výslovně zvolené účty; spend, impressions, clicks, dostupný reach a post metrics | denně; stránkovat a respektovat rate limits i atribuční okno | organické a placené oddělit; nepodporovaná metrika je `null`, ne 0 |
| Sklik | read-only report oprávnění k jednomu účtu; cost/clicks/conversions | denně, po dnech a kampaních | token invalidovat/obnovit oficiální cestou; import idempotentní |
| Zapier | tajný inbound endpoint pro úzce vymezené agregované události; outbound pouze po zapnutí a zadání příjemce | dle události, týdenní/měsíční souhrn | deduplikovat event ID, retry s backoff; vývoj nic neposílá |

`business-sync` přijímá pouze `POST { provider, from, to }`, období omezuje na 366 dní, opakuje jen 429/5xx, stránkuje s pevným stropem a ukládá stav do `business_sync_runs`. `business-zapier` přijímá pouze povolené agregované metriky bez osobních údajů; replay stejného `event_id` je no-op. Odchozí Zapier požadavek nevzniká z Cronu ani při otevření dashboardu.

Každý import musí před zápisem vytvořit `business_sync_runs`, průběžně ukládat kurzor, počet řádků a chybu. Externí ID jsou unikátní ve svém zdroji. Importy agregují do business tabulek; otevření dashboardu nesmí synchronně volat platformy.

## Ověřené aktuální významy

- Stripe může událost doručit opakovaně a pořadí není garantované; endpoint musí ověřit podpis a zpracování deduplikovat: https://docs.stripe.com/webhooks
- Stripe balance report rozlišuje aktivitu balance od payoutů, proto payout není další příjem: https://docs.stripe.com/reports/balance
- GA4 rozlišuje `activeUsers`, `sessions` a `screenPageViews`; jde o různé metriky: https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema
- Vercel Web Analytics API nabízí programový přístup k návštěvám a událostem: https://vercel.com/changelog/web-analytics-api
- Supabase Cron používá `pg_cron`; naplánovaný SQL příklad zůstává v migraci vypnutý: https://supabase.com/docs/guides/cron
- Meta Graph verze je konfigurovatelná; před autorizací účtu je nutné potvrdit dostupná pole a oprávnění konkrétní aplikace: https://www.postman.com/meta/instagram, https://www.postman.com/meta/facebook-marketing-api
- TikTok Ads používá integrovaný report a organický import pouze scope `video.list`: https://business-api.tiktok.com/portal/docs, https://developers.tiktok.com/doc/display-api-overview/
- Google Ads používá read-only GAQL reporting; verze API je konfigurovatelná: https://developers.google.com/google-ads/api/docs/reporting/overview
- Sklik používá JSON API Drak v5, tokenové přihlášení a dvoufázový campaign report: https://api.sklik.cz/drak/, https://api.sklik.cz/drak/campaigns.createReport.html
- Zapier URL se zachází jako s tajemstvím a outbound je pouze explicitní: https://help.zapier.com/hc/en-us/articles/8496288690317-Trigger-Zap-workflows-from-webhooks

## Read-only inventura 11. září 2026

| Služba | Ověřený stav | Zbývá |
| --- | --- | --- |
| Supabase | projekt i Auth dostupné; business tabulky chybí; existující Edge Functions běží | bezpečná staging migrace, SQL runtime a RLS test |
| Stripe | produkční účet dostupný; existující Supabase webhook aktivní, 3 události, 0% chybovost při kontrole | rozšířit serverové zpracování do business ledgeru a udělat zpětnou kontrolu balance transactions |
| GA4 | property dostupná; sbírá users, sessions, page views i checkout události | vytvořit nejmenší read-only Data API přístup a ověřit timezone/retention |
| Vercel | projekt a Web Analytics dostupné; interní admin provoz je ve statistikách | vytvořit nejmenší read-only API přístup a při importu filtrovat interní cesty |

## Přesný další krok

Nejdřív vytvořit obnovitelný staging Supabase nebo potvrdit řízenou produkční migraci se zálohou. Potom nasadit `business-sync` s ověřováním JWT a `business-zapier`, autorizovat jeden konektor po druhém a pro každý provést kontraktový test plus read-only API test. Doporučené pořadí: Stripe → GA4 → Vercel → Meta → TikTok → Google Ads → Sklik → Zapier. Bez toho zůstávají stavy správně `Nepřipojeno`/`Data zastaralá`.
