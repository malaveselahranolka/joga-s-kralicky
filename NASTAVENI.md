# Rezervační systém — nastavení (krok za krokem)

Tenhle web má teď **živý rezervační systém** se sdílenou databází:

- **`index.html`** — veřejná stránka. Ukazuje reálná volná místa a přijímá rezervace.
- **`admin.html`** — aplikace pro majitelku: přihlášení, přehled, plánování lekcí, správa rezervací.
- **`supabase/schema.sql`** — databázové schéma (tabulky + pravidla).
- **`supabase-config.js`** — sem vložíš klíče ke svojí databázi.

Vše běží na **Supabase** (hostovaná databáze, free tarif bohatě stačí). Nepotřebuješ žádný server.

---

## 1) Založ projekt na Supabase

1. Jdi na **https://supabase.com** → **Start your project** → přihlas se (např. přes GitHub).
2. **New project**. Zadej název (např. `joga-s-kralicky`), vymysli **Database Password** (ulož si ho stranou — k webu ho nepotřebuješ) a vyber region **Central EU (Frankfurt)**.
3. Počkej ~2 minuty, než se projekt vytvoří.

## 2) Vytvoř tabulky (spusť SQL)

1. V levém menu otevři **SQL Editor** → **New query**.
2. Otevři soubor **`supabase/schema.sql`** z tohoto projektu, zkopíruj **celý jeho obsah** a vlož do editoru.
3. **Důležité:** v souboru na začátku najdi řádek
   ```
   select coalesce(auth.jwt() ->> 'email', '') = 'majitelka@example.cz'
   ```
   a přepiš `majitelka@example.cz` na **e-mail, kterým se budeš přihlašovat** do adminu.
4. Klikni **Run**. Mělo by proběhnout bez chyb (zelené „Success“).

## 3) Vytvoř si přihlášení (účet majitelky)

1. V levém menu **Authentication** → **Users** → **Add user** → **Create new user**.
2. Zadej **stejný e-mail** jako v kroku 2.3 a heslo. Zaškrtni **Auto Confirm User**.
3. (Doporučeno) **Authentication → Providers → Email** a vypni **„Allow new users to sign up“**, aby se nikdo cizí nemohl registrovat.

## 4) Propoj web s databází

1. V Supabase otevři **Project Settings** (ozubené kolo) → **API**.
2. Zkopíruj:
   - **Project URL** (např. `https://abcd1234.supabase.co`)
   - **anon public** klíč (dlouhý, začíná `eyJ…`)
3. Otevři soubor **`supabase-config.js`** a vlož je:
   ```js
   window.SUPABASE_URL      = 'https://abcd1234.supabase.co';
   window.SUPABASE_ANON_KEY = 'eyJ...tady-tvuj-klic...';
   ```
4. Ulož.

> Tyhle dvě hodnoty jsou určené k tomu, aby byly veřejně v prohlížeči — data chrání bezpečnostní pravidla z `schema.sql`, ne tajnost klíče. Klidně je commitni.

## 5) Nahraj na web

```bash
git add -A
git commit -m "Přidán rezervační systém (Supabase)"
git push
```

GitHub Pages se aktualizuje do pár minut.

---

## 6) Potvrzovací e-maily (EmailJS) — nepovinné

Aby hostovi po rezervaci přišel potvrzovací e-mail (a tobě kopie). Bez tohoto kroku rezervace fungují normálně, jen se e-mail neodešle.

1. Založ si free účet na **https://www.emailjs.com** → **Sign Up**.
2. **Email Services** → **Add New Service** → vyber **Gmail** (nebo jiný) a připoj svůj e-mail. Zapiš si **Service ID** (např. `service_ab12cd`).
3. **Email Templates** → **Create New Template**. Nastav pole:
   - **To Email:** `{{to_email}}`
   - **From Name:** `Jóga s králíčky`
   - **Bcc:** `kovacikovabarbora71@gmail.com`  *(sem chodí tvoje kopie — přehled o nových rezervacích)*
   - **Subject:** `Potvrzení rezervace — Jóga s králíčky`
   - **Content** — přepni na **Code** (`<>`) a vlož:
     ```html
     <p>Dobrý den {{name}},</p>
     <p>děkujeme za rezervaci! Vaše místo je potvrzené:</p>
     <p>
       Lekce: {{lesson}}<br />
       Kdy: {{datetime}}<br />
       Počet míst: {{spots}}<br />
       Kde: {{location}}
     </p>
     <p style="text-align:center;margin:24px 0">
       <img src="{{qr_url}}" alt="QR kód vstupenky" width="260" height="260"
            style="display:block;margin:0 auto;border:1px solid #E3DFD3;border-radius:12px" />
       <span style="display:block;margin-top:10px;font-size:14px;color:#5C6357">
         Tenhle QR kód ukažte ve studiu — je to vaše vstupenka.
       </span>
     </p>
     <p>Stav rezervace a platby: <a href="{{ticket_url}}">{{ticket_url}}</a></p>
     <p>Těšíme se na vás (a králíci taky).<br />Jóga s králíčky</p>
     ```
   Ulož a zapiš si **Template ID** (např. `template_xy34`).

   > Ten obrázek `{{qr_url}}` je **jediné místo, kde host QR kód dostane** —
   > na webu se QR záměrně nezobrazuje. Bez něj přijde e-mail bez vstupenky.
4. **Account → General** (nebo **API Keys**) → zkopíruj **Public Key**.
5. Vlož všechny tři hodnoty do **`supabase-config.js`**:
   ```js
   window.EMAILJS_PUBLIC_KEY  = 'sem-public-key';
   window.EMAILJS_SERVICE_ID  = 'service_ab12cd';
   window.EMAILJS_TEMPLATE_ID = 'template_xy34';
   ```
6. Ulož, commit + push. Hotovo — od teď chodí potvrzení hostovi i tobě.

> Free tarif EmailJS: 200 e-mailů/měsíc. V EmailJS si můžeš v *Account → Security* přidat povolenou doménu webu pro vyšší bezpečnost.

---

## Jak to používat

### Admin (`tvuj-web/admin.html`)
- Přihlas se e-mailem a heslem z kroku 3.
- **Přehled** — nejbližší lekce a jejich obsazenost.
- **Lekce** — *+ Přidat lekci* (datum, čas, délka, kapacita), nebo *Vygenerovat příští týden z rozvrhu* (vytvoří lekce podle standardního týdenního rozvrhu). Lekce lze upravit, **zrušit** (zmizí z webu, ale vidíš přihlášené, koho informovat) nebo smazat.
- **Rezervace** — vidíš, kdo se přihlásil; rezervaci můžeš **zrušit** (místa se vrátí) nebo přidat **ruční rezervaci** (telefonický host).

### Veřejná stránka
- Sekce **Rezervace** ukáže jen lekce, které jsi vypsala, a **reálný počet volných míst**.
- Když je lekce plná, ukáže se jako *Obsazeno*. Systém ohlídá, aby se nepřebukovala.

---

## Časté otázky

**„Rezervace připravujeme“ na webu / admin nejde přihlásit.**
Není vyplněný `supabase-config.js` (krok 4), nebo je překlep v URL/klíči.

**Přihlášení do adminu hlásí chybu.**
Účet musí existovat (krok 3) a jeho e-mail se musí **shodovat** s e-mailem v `schema.sql` (krok 2.3). Když jsi e-mail změnila až dodatečně, spusť `schema.sql` znovu.

**Na webu nejsou žádné termíny.**
Zatím nejsou vypsané lekce — přidej je v adminu (záložka Lekce).

**Chci jinou kapacitu sálu.**
Nastav ji u každé lekce při zakládání (pole *Kapacita*). Výchozí je 12.

---

## Platby přes Stripe (POUZE ONLINE, povinné před lekcí)

Vstup se platí **výhradně online kartou** přes **Stripe Checkout**, hned při
rezervaci. Na místě se **neplatí**. Rezervace bez zaplacení jen **drží místo
35 minut**, pak se místo samo vrátí do nabídky.

Cenu počítá **server**: `cena za osobu × počet míst`. Když si někdo rezervuje
3 místa na jedno jméno, brána mu rovnou napočítá 3 × 499 Kč. Prohlížeč do
částky nemluví (nešlo by ji podvrhnout).

> Tajný klíč Stripe (`sk_...`) **nikdy nedávej do `payment-config.js` ani do
> repozitáře**. Patří jen na server (Supabase Edge Functions, krok C níže).

### Jak to funguje
1. Zákazník vyplní formulář a zvolí počet míst (cena se mu hned přepočítá).
2. Web založí rezervaci, **drží místo 35 minut** a rovnou ho pošle do brány.
3. Ve Stripe zaplatí celou částku (v rozpisu vidí „3 × 499 Kč").
4. Po návratu se web zeptá Stripu (`stripe-confirm`), zapíše „zaplaceno"
   a **teprve teď** odešle potvrzovací e-mail s QR kódem.
5. Webhook (`stripe-webhook`) je druhá, nezávislá cesta pro případ,
   že host zavře okno dřív, než se vrátí.

Nezaplacená rezervace **nikdy nezablokuje místo natrvalo** — po vypršení
držení ji web přestane počítat do obsazenosti.

### A) Účet a klíče
1. Založ účet na **https://stripe.com**. Pro zkoušení nech účet v **Test mode**.
2. **Developers → API keys** → zkopíruj **Secret key** (`sk_test_...`).

### B) Databáze (jednorázově)
V Supabase → **SQL Editor** → **New query** spusť postupně:
1. **`supabase/payments.sql`** — sloupce o stavu platby,
2. **`supabase/online-only.sql`** — držení místa do zaplacení, přepočet volných
   míst a rezervace pro víc osob na jedno jméno (1–8).

*(Když jsi `tickets.sql` a `schema.sql` spustil dřív, nevadí — `online-only.sql`
je jen přepíše novější verzí.)*

### C) Nasazení funkcí + tajné klíče (Supabase Dashboard, bez CLI)
**Edge Functions → Secrets** nastav:
```
STRIPE_SECRET_KEY      = sk_test_...
PAYMENT_ENTRY_CZK      = 499          (cena za JEDNO místo; musí sedět s payment-config.js)
PAYMENT_VOUCHER_CZK    = 499
SITE_URL               = https://malaveselahranolka.github.io/joga-s-kralicky/
STRIPE_WEBHOOK_SECRET  = whsec_...   (doplníš v kroku D)
```
Pak **Edge Functions → Deploy a new function → Via Editor** a nahraj (jméno přesně):
- `stripe-create`  — vlož obsah `supabase/functions/stripe-create/index.ts`
- `stripe-voucher` — vlož obsah `supabase/functions/stripe-voucher/index.ts` (dárkové poukazy)
- `stripe-confirm` — vlož obsah `supabase/functions/stripe-confirm/index.ts`
  (ověří platbu hned po návratu z brány); i tady **vypni „Verify JWT"**
- `stripe-webhook` — vlož obsah `supabase/functions/stripe-webhook/index.ts`;
  u téhle funkce **vypni „Verify JWT"** (Stripe neposílá Supabase token).

Taky spusť v SQL editoru **`supabase/vouchers.sql`** (tabulka poukazů).

*(SUPABASE_URL a SERVICE_ROLE_KEY doplňovat netřeba — funkce je mají automaticky.)*

### D) Webhook ve Stripe
Stripe **Developers → Webhooks → Add endpoint**:
- **Endpoint URL:** `https://TVUJ_PROJECT_REF.functions.supabase.co/stripe-webhook`
- **Events:** `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_failed`
- Zkopíruj **Signing secret** (`whsec_...`) a ulož jako `STRIPE_WEBHOOK_SECRET` (krok C).

### E) Zapnutí na webu
Otevři **`payment-config.js`** a nastav:
```js
window.PAYMENTS = {
  provider: 'stripe',
  enabled: true,
  entryCzk: 499,     // cena za JEDNO místo — stejné číslo jako PAYMENT_ENTRY_CZK
  maxSpots: 4,       // kolik míst smí host koupit na jedno jméno (max 8)
  holdMinutes: 35,   // jak dlouho držíme nezaplacené místo
  voucherUrl: 'https://buy.stripe.com/…',   // Payment Link na dárkový poukaz
  voucherCzk: 499,
  fallbackEntryUrl: 'https://buy.stripe.com/…',  // záchranná brzda, viz níž
};
```

> **Co je `fallbackEntryUrl`:** starý pevný odkaz na jeden vstup za 499 Kč.
> Použije se jen když funkce `stripe-create` neodpoví (není nasazená, výpadek)
> **a jde o rezervaci na jedno místo**. U víc osob by strhl málo, takže se tam
> platba radši nespustí a host dostane výzvu napsat vám. Až bude `stripe-create`
> nasazená, tahle cesta se nikdy nepoužije — nech ji tam jako pojistku.
Commitni + pushni. Hotovo — po odeslání formuláře jde host rovnou do platby
a na stránce s termíny je i karta na koupi dárkového poukazu.

> **Cenu měň na dvou místech naráz:** `entryCzk` v `payment-config.js`
> (co host vidí) a secret `PAYMENT_ENTRY_CZK` (co brána opravdu strhne).
> Kdyby se rozešly, platí ta serverová.
>
> **`enabled: false`** je nouzová brzda: platby se vypnou a rezervace budou
> zdarma jako dřív. Nech `true`, dokud platby fungují.

### E2) Vzhled platební brány — kde se mění
Barvy a název v platební bráně **nejsou ve Stripe Dashboardu**, ale
v souboru `supabase/functions/stripe-create/index.ts`, v bloku `const branding`.
Je to tam schválně: dá se to měnit spolu se zbytkem webu.

```js
background_color: '#2C3B2E',      // levý panel
button_color:     '#2C3B2E',      // tlačítko Zaplatit
display_name:     'Jóga s králíčky',
```

> Nastavení ve Stripe Dashboardu (**Settings → Branding**) tuhle bránu
> **neovlivní** — kód ho přebíjí. Dashboard řídí jen vzhled **e-mailových
> účtenek** od Stripu a **odkazu na dárkový poukaz**. Když měníš barvy,
> změň je pro jistotu na obou místech, ať to ladí všude.
>
> Logo a ikona se berou z účtu (v dashboardu je nahrané máš), ty v kódu nejsou.

Po změně barev musíš funkci `stripe-create` znovu nasadit (Edge Functions →
`stripe-create` → vložit nový obsah → Deploy).

### F) Dárkový poukaz + e-mail s kódem (EmailJS)
Poukaz se zaplatí přes Stripe, po zaplacení web ukáže **kód** a pošle ho e-mailem.
1. V EmailJS vytvoř šablonu (pole: `to_email`, `code`, `amount`), zkopíruj Template ID.
2. Do `supabase-config.js`: `window.EMAILJS_VOUCHER_TEMPLATE_ID = 'template_…';`
3. Prodané poukazy vidíš v adminu → záložka **Poukazy** (odškrtneš „uplatněno").

### G) Test
Rezervuj/kup poukaz zkušebně. Ve Stripe **Test mode** zaplať kartou
`4242 4242 4242 4242` (libovolné budoucí datum a CVC). Rezervace → v Supabase
`bookings.payment_status = paid`; poukaz → záložka Poukazy + e-mail s kódem.

> **Doporučení:** nejdřív otestuj celé v **Test mode**. Teprve až vše sedí,
> přepni Stripe na **Live mode**, dej `sk_live_...` a `whsec_...` z živého
> webhooku (jinak stejný postup). V live jde o skutečné peníze.

---

## QR kód (chodí e-mailem, na webu se nezobrazuje)

Po rezervaci pošleme hostovi potvrzovací e-mail a **v něm je QR kód**. Ve studiu
ho jen ukáže na mobilu, ty ho v adminu naskenuješ v záložce **Odbavení** a hned
vidíš jméno, lekci a jestli má **zaplaceno**.

Na webu se QR nikde nekreslí. Stránka `vstupenka.html` slouží už jen jako
**stav rezervace** (termín, počet míst, stav platby) — host se na ni dostane
z odkazu v e-mailu.

QR kóduje jediný údaj: odkaz `…/vstupenka.html#3f9a21c4-…`, jedinečný pro každou
rezervaci. To dlouhé ID je zároveň klíč — kdo ho nemá, nic nepřečte.

### A) Spusť SQL
Supabase → **SQL Editor → New query → Run**: obsah **`supabase/tickets.sql`**.
(Předtím musí být hotové `schema.sql` a `payments.sql`.)

Ověř si, že to prošlo: SQL Editor → `select public.get_ticket('00000000-0000-0000-0000-000000000000');`
Musí vrátit prázdný řádek, ne chybu „function does not exist".

### B) QR do potvrzovacího e-mailu (POVINNÉ — jinak host QR nedostane)
Web posílá do EmailJS dvě pole navíc: **`qr_url`** (hotový obrázek QR kódu)
a **`ticket_url`** (odkaz na stav rezervace). Šablona je musí použít, jinak se
v e-mailu neobjeví nic.

EmailJS → **Email Templates** → tvoje šablona potvrzení → přepni na **Code**
(`<>`) a vlož do těla e-mailu:

```html
<p style="text-align:center;margin:24px 0">
  <img src="{{qr_url}}" alt="QR kód vstupenky" width="260" height="260"
       style="display:block;margin:0 auto;border:1px solid #E3DFD3;border-radius:12px" />
  <span style="display:block;margin-top:10px;font-size:14px;color:#5C6357">
    Tenhle QR kód ukažte ve studiu.
  </span>
</p>
<p>Stav rezervace a platby: <a href="{{ticket_url}}">{{ticket_url}}</a></p>
```

Pak **Save** a pošli si zkušební rezervaci na vlastní e-mail.

> Některé e-mailové aplikace obrázky napoprvé blokují („Zobrazit obrázky").
> Proto je na stránce stavu rezervace i krátký kód, který stačí nadiktovat.

### C) Aby stav platby seděl (jinak zůstane „nezaplaceno")
Tohle je ta důležitá část — bez ní se databáze o zaplacení nedozví a host
zůstane viset na „Čeká na zaplacení". Vedou k ní **dvě nezávislé cesty** —
nastav obě, jedna druhou jistí.

**Cesta 1 — ověření hned po návratu z platby (funkce `stripe-confirm`)**

1. Supabase → **Edge Functions → Deploy a new function → Via Editor**, jméno
   přesně `stripe-confirm`, vlož obsah `supabase/functions/stripe-confirm/index.ts`.
   U téhle funkce **vypni „Verify JWT"**. (Bezpečné: bez platného ID platební
   session neudělá nic a ven pošle jen „zaplaceno ano/ne".)
2. Návratovou adresu **nikde nenastavuješ** — platbu zakládá funkce
   `stripe-create` a `?platba=ok&session_id={CHECKOUT_SESSION_ID}` si do ní
   doplní sama. Jen zkontroluj secret `SITE_URL` (krok C výše), ať míří na tvůj web.
   *(Ruční nastavení „After payment" má pořád jen Payment Link na dárkový poukaz.)*

**Cesta 2 — webhook (chytí i platby, kde host zavřel okno)**

1. Supabase → **Edge Functions → Deploy a new function → Via Editor**, jméno
   přesně `stripe-webhook`, vlož obsah `supabase/functions/stripe-webhook/index.ts`.
   U téhle funkce **vypni „Verify JWT"** (Stripe neposílá Supabase token).
2. Stripe → **Developers → Webhooks → Add endpoint**
   - **Endpoint URL:** `https://TVUJ_PROJECT_REF.functions.supabase.co/stripe-webhook`
   - **Events:** `checkout.session.completed`, `checkout.session.expired`,
     `checkout.session.async_payment_failed`
3. Zkopíruj **Signing secret** (`whsec_...`) a ulož ho v Supabase →
   **Edge Functions → Secrets** jako `STRIPE_WEBHOOK_SECRET`.
   (`STRIPE_SECRET_KEY` už tam máš.)

> ⚠️ **Nejčastější chyba: test vs. live.** Stripe má dva oddělené světy.
> Když platíš přes **live** odkaz (`buy.stripe.com/…`, tvůj případ), ale webhook
> a `STRIPE_SECRET_KEY` máš z **Test mode**, Stripe zaplacení nikam neohlásí a
> rezervace zůstane „nezaplaceno". V Stripe vpravo nahoře přepni na **live**
> a zkontroluj, že tam ten endpoint je a že `STRIPE_SECRET_KEY` začíná `sk_live_`.

**Kde koukat, když to nesedí:**
- Stripe → **Developers → Webhooks** → klik na endpoint → *Events* — musí tam
  být `checkout.session.completed` se zelenou 200. Červená = klikni a přečti chybu.
- Supabase → **Edge Functions → stripe-confirm / stripe-webhook → Logs**.
- Supabase → **Table editor → bookings** — sloupec `payment_status` musí být `paid`.

### D) Jak to používáš u dveří
Admin → záložka **Odbavení** → **Zapnout kameru** → namíříš na QR hosta.
- 🟢 **Zaplaceno online** — pouštíš dál. (E-mail s QR chodí až po zaplacení,
  takže kdo má QR, má skoro vždy i zaplaceno.)
- 🟠 **Nezaplaceno / Platba se zpracovává** — dej **Zkontrolovat znovu**; pokud
  to pořád nesedí a peníze vyřešíte jinak (převod, výjimka), klikni
  **Označit zaplaceno ručně**.
- ⚫ **Rezervace zrušena / Vstupenka neznámá** — neplatí.

Kamera nejede (nepovolený přístup, starý telefon)? Pod čtečkou je políčko, kam
opíšeš krátký kód rezervace (host ho vidí na stránce stavu rezervace).

> Kamera funguje jen na **https** (GitHub Pages ano) nebo na `localhost`.
> Poprvé se prohlížeč zeptá na povolení — dej **Povolit**.

---

## Newsletter (odběr novinek)

V patičce webu je políčko **„Odebírat"**, kam návštěvník zadá e-mail.
Adresy se ukládají do databáze a vidíš je v adminu v záložce **Newsletter**.

### Zapnutí
1. V Supabase → **SQL Editor** → **New query** vlož obsah souboru
   **`supabase/newsletter.sql`** a dej **Run**.
2. Hotovo. Od teď se přihlášení z patičky ukládají.

### Co umí admin (záložka Newsletter)
- Počet odběratelů a přehled e-mailů (kdo a kdy se přihlásil).
- **Stáhnout CSV** — seznam aktivních adres (oddělené `;`, s diakritikou).
  Ten naimportuješ do svého nástroje na rozesílání (Ecomail, Mailchimp,
  Brevo…) a odtud pošleš newsletter.
- Odhlásit / znovu přihlásit / smazat jednotlivé adresy.

> Samotné **rozesílání** e-mailů web nedělá (na to slouží specializované
> služby). Web sbírá adresy a dá ti je exportem; rozesílání řešíš v té službě.
> Kdyby sis přál rozesílání napojit přímo, dá se doplnit edge funkce.

---

## Platby ve správě rezervací

Když spustíš **`supabase/payments.sql`** a **`supabase/online-only.sql`**
(viz sekce *Platby přes Stripe*), má každá rezervace v adminu **stav platby**:

- **Zaplaceno online** — host zaplatil v bráně. Jediná běžná cesta.
- **Zaplaceno ručně** — odškrtla jsi to sama (telefonická rezervace, převod,
  výjimka). Jde vrátit přes **„Zrušit platbu"**.
- **Čeká na platbu** — platbu spustil, ale ještě nedokončil; místo mu držíme.
- **Propadlo — nezaplaceno** — držení vypršelo. **Místo už je zase volné**,
  řádek zůstává jen pro přehled (klidně ho smaž).
- **Nezaplaceno** — typicky ruční rezervace z adminu; ta místo drží napořád.

V záložce **Rezervace** je i filtr **Platba** a souhrn nad seznamem.

> **Ruční rezervace (telefon / walk-in)** z adminu se online neplatí a její
> místo se nikdy samo neuvolní — je to tvoje výjimka z pravidla „jen online".

---

## Rozesílání newsletteru přímo z adminu (EmailJS)

Napíšeš zprávu ve **správě** a rozešle se všem odběratelům rovnou z
prohlížeče přes **EmailJS** (co už používáš na potvrzení rezervací).
Žádné další služby ani nasazování.

### A) Vytvoř newsletter šablonu v EmailJS
1. Přihlas se na **https://dashboard.emailjs.com** → **Email Templates** → **Create New Template**.
2. Nastav pole:
   - **To Email:** `{{to_email}}`
   - **Subject:** `{{subject}}`
   - **Content (tělo):** vlož `{{message}}` a dole klidně přidej řádek s odhlášením:
     `Odhlásit odběr: {{unsubscribe_url}}`
3. Ulož a zkopíruj **Template ID** (např. `template_abc123`).

### B) Doplň ID do configu
V souboru **`supabase-config.js`** nastav:
```js
window.EMAILJS_NEWSLETTER_TEMPLATE_ID = 'template_abc123';
```
Commitni + pushni. (PUBLIC_KEY a SERVICE_ID už tam máš z rezervací.)

### C) Rozeslání
V adminu → **Newsletter** → **Napsat a rozeslat newsletter**: vyplň
předmět a text, **Rozeslat odběratelům**. Posílá po jednom (tlačítko
ukazuje průběh), každý dostane vlastní e-mail i s odhlašovacím odkazem.

> Pozor na limity EmailJS (free tarif ~200 e-mailů/měsíc). Na malý seznam
> pohodlně stačí; u většího zvaž službu na hromadné rozesílání (Ecomail…)
> a použij **Stáhnout CSV**.
> Odhlášení přes odkaz v e-mailu funguje automaticky (`?unsub=` na webu).

---

## Kdo vidí data ve správě (vlastník)

Admin ukazuje rezervace, odběratele atd. **jen účtu vlastníka** —
definovaný v `supabase/schema.sql` funkcí `is_owner()`. Když se přihlásíš
jiným e-mailem, RLS ti data **schová** (uvidíš prázdno, i když v databázi
jsou). Chceš-li povolit víc účtů, spusť v SQL editoru:
```sql
create or replace function public.is_owner() returns boolean
language sql stable as $$
  select coalesce(auth.jwt() ->> 'email', '') in (
    'kovacikovabarbora71@gmail.com',   -- majitelka
    'adamekfilip12@gmail.com'          -- správce webu
  )
$$;
```
