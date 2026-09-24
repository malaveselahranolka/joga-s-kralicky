# Jóga s králíčky 🐰

Web studia v Ostravě, kde se cvičí jóga a mezi podložkami pobíhá deset
domácích králíčků. Rezervace, platby kartou, dárkové poukazy, e-maily
i správa obsahu běží z tohoto repozitáře.

**Živě:** https://www.jogaskralicky.cz/

## Jak je to poskládané

| Část | Kde běží | K čemu |
|---|---|---|
| Statické HTML + `assets/` | Vercel | Web sám. `npm run build` ho skládá do `public/`. |
| `content/obsah.json` | repo → build | Jediný zdroj textů a fotek homepage. Build je vsadí přímo do HTML. |
| `admin.html` + `api/obsah.js` | Vercel + GitHub | Správa pro majitelku. Uložení obsahu vytvoří commit a Vercel nasadí nový web. |
| Supabase (Postgres + Edge funkce) | Supabase | Lekce, rezervace, poukazy, fronta e-mailů, newsletter, business data. |
| Stripe Checkout | Stripe | Platba kartou (včetně Apple Pay a Google Pay) za lekce i poukazy. |
| Brevo | Brevo | Odesílání e-mailů. Podobu e-mailů drží repo (`_shared/templates.ts`). |
| `api/chat.js` | Vercel + AI Gateway | Chat „Máte otázku?“ na webu. Odpovídá jen z `api/_chat-znalosti.js`. |
| `business.html` + `business/` | Vercel + Supabase | Soukromý business přehled (tržby, náklady, zdroje návštěv). |

### Hlavní pravidlo

**Text na webu se nemění v HTML.** Mění se v `content/obsah.json` nebo ve
správě (záložka *Obsah webu*). Build ho vsadí do `index.html`, takže
vyhledávač i návštěvník dostanou hotový text bez čekání na JavaScript.
Ruční úprava textu v `index.html` se při dalším buildu přepíše.
Výjimka: `obsah.json` → `galerie` se edituje ručně v souboru.

## Stránky

| Stránka | Co na ní je |
|---|---|
| `index.html` | Homepage: lekce, ceny, galerie, FAQ, kontakt |
| `rezervace.html` | Výběr termínu, rezervace, platba, uplatnění poukazu |
| `koupit-poukaz.html` | Koupě dárkového poukazu (klasický / dětský, počet dětí, počet kusů) |
| `darkovy-poukaz.html` | Představení poukazu, ukázka skutečného poukazu z e-mailu |
| `skupinove-lekce.html` | Soukromé lekce pro firmy a oslavy, u nás ve studiu nebo u zákazníka, s poptávkovým formulářem |
| `joga-pro-deti-ostrava.html` | Lekce Děti & králíčci |
| `joga-se-zviraty.html`, `o-nas.html` | Články a informace o studiu |
| `vstupenka.html` | Stav rezervace a QR kód pro odbavení u dveří |
| `obchodni-podminky.html`, `zasady-osobnich-udaju.html` | Právní texty |
| `asistent.html` | Celostránková verze chatu |
| `admin.html`, `business.html` | Správa a business přehled (noindex, přihlášení přes Supabase) |

## Lekce, ceny a poukazy

Ceny počítá vždy **server** (Edge funkce), prohlížeč je jen ukazuje.
Veřejná konfigurace pro zobrazení je v `payment-config.js` a musí sedět se
Supabase secrets. Na shodu dohlíží `npm run verify`.

| Co | Cena | Poznámka |
|---|---|---|
| Lekce Jóga s králíčky | 499 Kč / osoba | až 4 místa na jedno jméno |
| Lekce Děti & králíčci (`lessons.druh = 'deti'`) | 1 090 Kč zákonný zástupce + 1 dítě, každé další dítě 500 Kč | nejvýš 4 děti na zástupce, kapacita 12 osob včetně dospělých |
| Dárkový poukaz klasický | 499 Kč | jeden vstup na lekci Jóga s králíčky |
| Dárkový poukaz dětský | 1 090 Kč + 500 Kč za další dítě | zástupce + 1 až 4 děti (`vouchers.deti`), jen na lekci Děti & králíčci |

Poukaz platí **6 měsíců** v kalendářních měsících (31. 8. → 28. 2.).
Délka žije na třech místech, která si ji nemůžou importovat: Edge funkce
(`_shared/poukaz-platnost.ts`), databáze (`public.voucher_validity()`)
a web (`payment-config.js → voucherValidityMonths`). `npm run verify`
hlídá, že všechna tři říkají totéž. Změna platnosti = změnit
`FAKTA.poukazPlatnostMesicu` ve `scripts/verify.mjs` a opravit, na co
kontrola ukáže. Zkrácení platí jen pro nově vystavené poukazy.

Každý druh poukazu jde uplatnit jen na lekci svého druhu. Dětský poukaz
zabere při uplatnění 1 + počet dětí míst (`create_booking_poukazem`).

### PDF poukazu

K e-mailu s poukazem se přibaluje poukázka k vytištění
(`supabase/functions/_shared/poukaz-pdf.ts`, `pdf-lib`, 210 × 99 mm).
Nese kód a platnost, cenu schválně ne. U dětského poukazu píše, na kolik
dětí platí. Fonty leží v `assets/fonts/pdf/` a funkce si je stáhne z webu.
Když chybí nebo selže vykreslení, e-mail odejde bez přílohy, protože kód
je i v těle zprávy.

Obrázky `assets/photos/poukaz-ukazka*.webp` na webu jsou vykreslené přímo
z tohoto generátoru, aby web ukazoval skutečný poukaz. Dětský má variantu
pro každý počet dětí (`-deti`, `-deti-2` až `-deti-4`). Po změně návrhu je
vyrenderuj znovu:
1. Sbal `poukaz-pdf.ts` esbuildem pro Node. Importy z esm.sh přepiš na
   npm balíčky `pdf-lib` a `@pdf-lib/fontkit`.
2. Vykresli PDF přes pdf.js.
3. Ulož do WebP v šířkách 1200 a 640 px.

České fonty pro PDF vznikly sloučením `latin` + `latin-ext` řezů
Schibsted Grotesk a Hanken Grotesk (fonttools: instancer → merge →
subset). Ani jedna z těch sad sama češtinu nepokryje.

## E-maily

Potvrzení rezervací, kódy poukazů, přesuny a zrušení lekcí posílá
**server** přes **Brevo** (secret `BREVO_API_KEY`). Šablony jsou v repu
v `supabase/functions/_shared/templates.ts`:

| Šablona | Kdy |
|---|---|
| `bookingMail` | potvrzení zaplacené rezervace s QR kódem |
| `detiBookingMail` | potvrzení lekce Děti & králíčci („Kdo: zástupce + N děti“, pokyny „Než vyrazíte“) |
| `voucherMail` | dárkový poukaz s kódem a PDF přílohou |
| `presunMail`, `cancelMail` | přesun rezervace, zrušená lekce |
| `welcomeMail` | přihlášení k newsletteru |
| `customMail` | ruční zpráva ze správy |

Každý e-mail se nejdřív zapíše do fronty `public.email_outbox` a teprve
pak se odešle. Co selže, zkouší se znovu (1 min → 5 min → 30 min → 2 h)
a pak čeká na člověka. Stav fronty je ve správě v záložce **E-maily**,
odkud jde zprávu poslat znovu. Díky frontě se potvrzení neztratí ani
tehdy, když host zavře stránku hned po zaplacení.

EmailJS se z prohlížeče odstranil 3. 9. 2026. Resend je v kódu připravený
(`RESEND_API_KEY` má přednost před Brevem), ale dokud DNS domény bydlí
u emailprofi.cz, nejde nastavit. Podrobnosti jsou v `.env.example`.

## Edge funkce (`supabase/functions/`)

| Funkce | JWT | K čemu |
|---|---|---|
| `stripe-create` | ne | Založí platbu za rezervaci. Cenu spočítá podle druhu lekce a počtu míst. |
| `stripe-voucher` | ne | Založí platbu za poukazy (druh, počet dětí, počet kusů). |
| `stripe-webhook` | ne | Příjem událostí ze Stripu (ověřený podpis). Potvrdí platbu, vystaví poukazy, zařadí e-maily. |
| `stripe-confirm` | ne | Totéž z návratové stránky, rychlejší cesta vedle webhooku. |
| `email-dispatch` | ano | Rozeslání fronty e-mailů. Volá ji správa nebo server. |
| `business-sync`, `business-zapier` | ano / ne | Importy do business přehledu (Stripe, Vercel, GA4, Sklik) |

Sdílený kód je v `_shared/`: e-maily, šablony, PDF poukazu, druh a cena
poukazu, platnost. Funkce se nasazují přes Supabase CLI nebo MCP.
Stripe funkce jdou s `--no-verify-jwt`:

```bash
supabase functions deploy stripe-webhook --no-verify-jwt
```

Pořadí při změně plateb: **databáze → webhook/confirm/dispatch →
stripe-create/stripe-voucher → web**. Starší kód tak nikdy nedostane data,
kterým nerozumí.

## Databáze (`supabase/*.sql`)

Spouští se v Supabase → SQL Editor. Všechny soubory jsou bezpečné pustit
opakovaně. Pořadí:

1. `schema.sql` — tabulky, RLS, `is_owner()`
2. `payments.sql`, `tickets.sql`
3. `online-only.sql` — držení místa po dobu platby, kapacita, `create_booking`
4. `lesson-images.sql` — obrázek u lekce (`image_url`, úložiště `lesson-images`)
5. `vouchers.sql`, `vouchers-lifecycle.sql` — poukazy, platnost,
   atomické uplatnění, deník Stripe událostí (`stripe_events`)
6. `email-outbox.sql` — fronta odchozích e-mailů
7. `provoz-a-brzdy.sql` — provozní pojistky (zaplacenou rezervaci nejde smazat ad.)
8. `presun-rezervace.sql` — přesun rezervace na jiný termín
9. `poukaz-rezervace.sql` — `create_booking_poukazem()`, uplatnění poukazu v rezervaci
10. `rezervace-na-poukaz.sql` — ze zaplacené rezervace udělá poukaz stejné hodnoty
11. `newsletter.sql`, `attribution.sql` — odběr novinek, odkud zákazník přišel
12. `deti-a-kralici.sql` — `lessons.druh`, pravidla lekce Děti & králíčci
13. `poukaz-deti.sql` — `vouchers.druh`, dětský poukaz jen na dětskou lekci
14. `poukaz-deti-pocet.sql` — `vouchers.deti`, dětský poukaz na 1–4 děti
15. `business-dashboard.sql` — business tabulky a RLS (viz `docs/business-dashboard.md`)

> Produkční databáze se v minulosti rozcházela s repem. Tvrzení o
> produkci si vždy ověř dotazem, ne z paměti.

## Chat na webu

Bublina „Máte otázku?“ (`assets/chat.js`) volá `api/chat.js`. Ten posílá
dotaz přes Vercel AI Gateway (`AI_GATEWAY_API_KEY`, model v `CHAT_MODEL`)
a odpovídá jen z faktů v `api/_chat-znalosti.js`. Co tam není, pošle na
e-mail. Konverzace se neukládají. Při změně cen, lekcí nebo poukazů
aktualizuj i tenhle soubor (a `llms.txt`).

## Lokální práce

```bash
npm ci
vercel env pull .env.local   # volitelné, jen kvůli snímku termínů
npm run build                # → public/
```

Bez `.env.local` build doběhne také, jen do `rezervace.html` nevloží
statický snímek vypsaných termínů. `public/` do gitu nepatří.

### Než něco nasadíš

```bash
npm run check
```

Spustí testy (business, chat), `verify` nad zdroji, build a `verify-public`
nad hotovým `public/`. Hlídá fakta (ceny, kapacity, věk dětí, platnost
poukazu), shodu serveru a webu, JSON-LD vs. viditelné FAQ, sitemapu,
indexaci, canonicaly, přesměrování, odkazy i soubory. Návratový kód 1 =
nenasazuj.

Vercel při nasazení pouští `npm run build`. Strukturální chyby nasazení
zastaví. Odchylka v textu upraveném majitelkou ve správě jen vypíše
varování, aby uložení obsahu nezablokovalo web.

## Proměnné prostředí

Seznam je v [`.env.example`](.env.example). Tajné hodnoty nikdy nejdou do
repozitáře.

- **Vercel:**
  - `GITHUB_TOKEN`, `GITHUB_REPO`, `GITHUB_BRANCH`, `OBSAH_EMAILY` pro ukládání obsahu,
  - `AI_GATEWAY_API_KEY` pro chat,
  - `SUPABASE_URL` a `SUPABASE_ANON_KEY` pro snímek termínů při buildu.
- **Supabase secrets:**
  - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  - `BREVO_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`,
  - `PAYMENT_ENTRY_CZK`, `PAYMENT_VOUCHER_CZK`, `PAYMENT_DETI_CZK`, `PAYMENT_DETI_DITE_CZK`,
  - `SITE_URL`, `OWNER_EMAIL`.

## Nasazení

Push do `main` spustí Vercel Production a každá větev dostane Vercel
Preview. Edge funkce a SQL se nasazují zvlášť do Supabase (projekt
`mglopjlgpfpturvqtjcj`).

Návod na Supabase, Stripe, QR odbavení, obrázky lekcí a newsletter krok
za krokem je v [NASTAVENI.md](NASTAVENI.md). Business přehled popisuje
[`docs/business-dashboard.md`](docs/business-dashboard.md).
