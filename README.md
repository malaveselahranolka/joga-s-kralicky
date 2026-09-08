# Jóga s králíčky 🐰

Web studia klidu, kde po lekcích jógy volně pobíhají domácí králíčci.

**Živě:** https://www.jogaskralicky.cz/

## Co to doopravdy je

Nejde už o jednostránkový web na GitHub Pages. Ve skutečnosti jsou
propojené tyto části:

| Část | Kde běží | K čemu |
|---|---|---|
| Statické HTML + `assets/` | Vercel | Web sám. Build ho skládá do `public/`. |
| `content/obsah.json` | GitHub + build | Zdroj aktuálního obsahu homepage; při buildu se vsadí přímo do HTML. |
| `admin.html` + `api/obsah.js` | Vercel + GitHub | Správa obsahu; uložení vytvoří commit a spustí nové nasazení. |
| Supabase (databáze + Edge funkce) | Supabase | Lekce, rezervace, poukazy, platby přes Stripe. |

HTML v repozitáři není zástupný text. Homepage se při buildu doplní z
`content/obsah.json`, takže vyhledávač i návštěvník dostanou stejný obsah
bez čekání na JavaScript. Proto musí být obě vrstvy srovnané a dohlíží na
to automatické kontroly.

## Lokální práce

```bash
npm ci
```

```bash
vercel env pull .env.local
```

```bash
npm run build
```

Build vyrobí `public/`. Bez lokálních proměnných doběhne také, jen do
rezervační stránky nevloží statický snímek právě vypsaných termínů.

## Než něco nasadíš

```bash
npm run build
```

Build nejprve zkontroluje zdroje, potom sestaví `public/` a nakonec
projde i hotový balík. Hlídá skripty, JSON-LD, provozní fakta, věk dětí,
sitemapu, indexaci, canonicaly, přesměrování, chybějící odkazy i soubory.
Samostatnou zdrojovou kontrolu lze pustit přes `npm run verify`.

Návratový kód 1 = nenasazuj. Není to náhrada za testy plateb, ale chytí
to přesně ty rozpory, které se na webu objevovaly opakovaně.

## Databáze

SQL soubory ve `supabase/` se pouštějí v Supabase → SQL Editor. Jsou
napsané tak, aby šly spustit opakovaně. Pořadí:

1. `schema.sql` — tabulky, RLS, `is_owner()`
2. `payments.sql`, `tickets.sql`
3. `online-only.sql` — držení místa, kapacita, `create_booking`
4. `vouchers.sql` — tabulka poukazů
5. `vouchers-lifecycle.sql` — platnost poukazu, atomické uplatnění,
   deník Stripe událostí (`stripe_events`)
6. `email-outbox.sql` — fronta odchozích e-mailů
7. `newsletter.sql`, `attribution.sql`

Krok 5 přibyl proto, že produkční databáze měla dvě věci, které v repu
vůbec nebyly (`vouchers.expires_at` a celá tabulka `stripe_events`).
Bez nich by čerstvé nasazení rozbilo webhook.

## Edge funkce

Ve `supabase/functions/`. Nasazují se přes Supabase CLI, `stripe-webhook`
a `stripe-confirm` **bez** ověřování JWT:

```bash
supabase functions deploy stripe-webhook --no-verify-jwt
```

`email-dispatch` se nasazuje normálně (s JWT) — volá ji admin po přihlášení.

Tajné klíče nikdy nejdou do repozitáře, jen do Supabase secrets — seznam
je v [`.env.example`](.env.example).

## E-maily

Potvrzení rezervací a kódy poukazů posílá **server**, ne prohlížeč hosta.
Pořád přes EmailJS a přes tytéž šablony; změnilo se jen to, odkud se
odeslání spouští.

Dřív ho spouštěla návratová stránka po platbě. Kdo zavřel záložku, zaplatil
na mobilu a potvrzení otevřel na notebooku, nebo koho trefil výpadek
EmailJS, zůstal bez vstupenky — a chyba se přitom spolkla, takže se to
nikdo nedozvěděl. Přesně tak 21. 8. 2026 skončil zaplacený poukaz bez kódu.

Teď se e-mail nejdřív zapíše do fronty `public.email_outbox` a teprve pak
se zkusí odeslat. Co selže, zůstane a zkusí se znovu (1 min → 5 min →
30 min → 2 h, pak čeká na člověka). V adminu je na to záložka **E-maily**:
je vidět, co čeká, co se nepovedlo a proč, a jde to poslat znovu.

Jediné, co k tomu chybí, je secret `EMAILJS_PRIVATE_KEY`:

```bash
supabase secrets set EMAILJS_PRIVATE_KEY=...
```

Dokud není nastavený, nic se nerozbije — server se do fronty zapisuje dál
a odesílání zatím obstará prohlížeč jako dřív. Jakmile klíč přibude,
prohlížeč sám zmlkne (server to hlásí v odpovědi jako `serverEmail`), takže
nehrozí, že by e-mail přišel dvakrát.

## Nasazení

Push do `main` → Vercel Production. Náhled každé větve → Vercel Preview.

Podrobnosti k nastavení účtů, klíčů a Stripu jsou v [NASTAVENI.md](NASTAVENI.md).
