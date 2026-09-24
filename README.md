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

Text se proto **nemění přímo v HTML** — mění se v `content/obsah.json` nebo ve
správě. Úprava v `index.html` se při dalším buildu ztratí. (Sanity, která obsah
dřív dotahovala až v prohlížeči, byla 7. 9. 2026 odstraněna.)

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
npm run check
```

`check` přísně zkontroluje zdroje, sestaví `public/` a projde i hotový
balík. Hlídá skripty, JSON-LD, provozní fakta, věk dětí, sitemapu,
indexaci, canonicaly, přesměrování, chybějící odkazy i soubory.

Vercel používá `npm run build`. Strukturální chyby při něm nasazení dál
zastaví, ale odchylka v titulku, popisku nebo jiném textu upraveném
majitelkou v administraci pouze vypíše varování. Uložení běžného obsahu
tak nemůže tiše zablokovat nové nasazení.

Návratový kód 1 z `npm run check` = nenasazuj. Není to náhrada za testy plateb, ale chytí
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
7. `presun-rezervace.sql` — `presun_rezervaci()` pro přesun rezervace
   na jiný termín (potřebuje frontu z kroku 6)
8. `poukaz-rezervace.sql` — `create_booking_poukazem()`, uplatnění
   dárkového poukazu přímo v online rezervaci (potřebuje kroky 4–6)
9. `rezervace-na-poukaz.sql` — `vystavit_poukaz_z_rezervace()`, opačný
   směr: z hotové zaplacené rezervace udělá dárkový poukaz(y) stejné
   hodnoty (potřebuje kroky 4–6)
10. `newsletter.sql`, `attribution.sql`
11. `deti-a-kralici.sql` — druh lekce `lessons.druh` a pravidla lekce
    Děti & králíčci: zákonný zástupce + 1 až 4 děti (2–5 míst, kapacita
    = lidé), dárkový poukaz za 499 Kč na ni neplatí. Cenu (1 090 Kč +
    500 Kč za každé další dítě) počítá `stripe-create`.

Krok 5 přibyl proto, že produkční databáze měla dvě věci, které v repu
vůbec nebyly (`vouchers.expires_at` a celá tabulka `stripe_events`).
Bez nich by čerstvé nasazení rozbilo webhook.

## Platnost dárkového poukazu

Poukaz platí **6 měsíců** od vystavení (dřív rok). Délka žije ve třech
prostředích, která si ji nemůžou naimportovat jedno od druhého:

| Vrstva | Kde | Co |
|---|---|---|
| Edge funkce (Deno) | `supabase/functions/_shared/poukaz-platnost.ts` | `PLATNOST_MESICU`, `platnostDoISO()`, text do e-mailu a na PDF |
| Databáze (Postgres) | `supabase/vouchers-lifecycle.sql` | `public.voucher_validity()` — čte ji výchozí hodnota sloupce i `vystavit_poukaz_z_rezervace()` |
| Prohlížeč a texty | `payment-config.js` → `voucherValidityMonths` | pro kontrolu textů na webu |

`npm run verify` hlídá, že všechny tři říkají totéž a že se číslo nikde
neopisuje natvrdo. Změna platnosti = změnit `FAKTA.poukazPlatnostMesicu`
ve `scripts/verify.mjs`, pustit kontrolu a opravit, na co ukáže.

**Počítá se v kalendářních měsících**, ne v pevném počtu dní — konec
měsíce se ořízne na poslední platný den (31. 8. → 28. 2.). Postgres
(`interval '6 months'`) i `platnostDo()` to dělají shodně, takže datum
v databázi sedí s datem na poukázce.

Zkrácení platí **jen dopředu**. Poukazy vystavené dřív mají `expires_at`
zapsané při vystavení a nikdo s ním nehýbe — doběhnou s roční platností,
jak byly prodané.

## PDF dárkového poukazu

K poukazovému e-mailu se přibaluje vytisknutelná poukázka
(`supabase/functions/_shared/poukaz-pdf.ts`). Kreslí se vektorově přes
`pdf-lib`, logo je překreslené podle `assets/logo.svg`.

Rozvržení je 210 × 99 mm na šířku podle schváleného návrhu: vlevo logo
v kolečku a jméno studia, vpravo nadpis, perex, vlasová linka a smetanová
karta se dvěma políčky — **kód poukazu** a **platnost**. Cena na poukázce
schválně není; je to dárek a příjemce nemá vidět, co dárce platil. Míry
v souboru jsou zapsané v milimetrech (`mm()`) a měřené shora (`shora()`),
aby se daly číst stejně jako v návrhu.

Fonty leží jako běžné soubory v `assets/fonts/pdf/` a funkce si je
**jednou stáhne a drží v paměti** (`poukaz-fonty.ts`). Zapéct je do kódu
jako base64 by znamenalo skoro 100 kB zdrojáku, který nejde zkontrolovat
v code review a při každé ruční manipulaci hrozí, že se jeden znak rozbije
a poukaz se tiše přestane generovat.

> **Důsledek:** příloha funguje až ve chvíli, kdy jsou fonty nasazené na
> webu. Dokud tam nejsou, e-mail s poukazem odejde bez přílohy — kód je
> v těle zprávy a ten je to podstatné.

Řezy jsou čtyři a jmenují se podle rodiny a váhy, ať je z volání poznat,
co se sází:

| Soubor | Kde se používá |
|---|---|
| `schibsted-600.ttf` | nadpis „Dárkový poukaz" |
| `schibsted-700.ttf` | jméno studia, kód poukazu, platnost |
| `hanken-400.ttf` | perex a kontakty |
| `hanken-600.ttf` | popisky v kartě |

Web má Hanken i Schibsted Grotesk rozdělené na `latin` a `latin-ext` a
**ani jeden soubor sám češtinu nepokryje** — latin má `á é í ó ú ý`,
latin-ext `č ď ě ň ř š ť ů ž`. Vyrobit je znovu
(potřebuje `pip install fonttools brotli`):

1. z každé dvojice `.woff2` udělej statický řez
   (`fontTools.varLib.instancer`, `wght` podle názvu souboru),
2. slij `latin` + `latin-ext` dohromady (`fontTools.merge.Merger`),
3. ořízni na podmnožinu znaků a ulož do `assets/fonts/pdf/`.

Podmnožina je schválně velkorysá (ASCII + celá česká abeceda +
interpunkce). Na chybějícím glyfu `pdf-lib` spadne — e-mail pak sice
odejde, ale bez přílohy, protože se selhání polyká záměrně: kód poukazu
je v těle zprávy a ten je to podstatné.

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
