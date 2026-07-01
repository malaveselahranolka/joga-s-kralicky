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
   - **Content** (přepni na text a vlož):
     ```
     Dobrý den {{name}},

     děkujeme za rezervaci! Vaše místo je potvrzené:

     Lekce: {{lesson}}
     Kdy: {{datetime}}
     Počet míst: {{spots}}
     Kde: {{location}}

     Těšíme se na vás (a králíci taky).
     Jóga s králíčky
     ```
   Ulož a zapiš si **Template ID** (např. `template_xy34`).
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

## Platby přes Stripe (volitelná záloha)

Web umí **volitelnou online zálohu** přes **Stripe Checkout**. Je to
**vypnuté**, dokud to sám nezapneš — do té doby je rezervace zdarma jako teď.

> Tajný klíč Stripe (`sk_...`) **nikdy nedávej do `payment-config.js` ani do
> repozitáře**. Patří jen na server (Supabase Edge Functions, krok C níže).

### Jak to funguje
1. Zákazník dokončí rezervaci jako dosud (místo se hned drží).
2. Na potvrzovací obrazovce se navíc objeví tlačítko **„Zaplatit zálohu online"**.
3. Po kliknutí ho web pošle na **Stripe Checkout**; po zaplacení se vrátí zpět.
4. Stripe pošle potvrzení na server (webhook) a stav platby se uloží k rezervaci.

Platba je **nepovinná** — rezervace platí i bez ní.

### A) Účet a klíče
1. Založ účet na **https://stripe.com**. Pro zkoušení nech účet v **Test mode**.
2. **Developers → API keys** → zkopíruj **Secret key** (`sk_test_...`).

### B) Databáze (jednorázově)
V Supabase → **SQL Editor** → **New query** vlož obsah souboru
**`supabase/payments.sql`** a dej **Run**. Přidá k rezervacím sloupce o stavu platby.

### C) Nasazení funkcí + tajné klíče (Supabase Dashboard, bez CLI)
**Edge Functions → Secrets** nastav:
```
STRIPE_SECRET_KEY      = sk_test_...
PAYMENT_DEPOSIT_CZK    = 499
PAYMENT_VOUCHER_CZK    = 499
SITE_URL               = https://malaveselahranolka.github.io/joga-s-kralicky/
STRIPE_WEBHOOK_SECRET  = whsec_...   (doplníš v kroku D)
```
Pak **Edge Functions → Deploy a new function → Via Editor** a nahraj (jméno přesně):
- `stripe-create`  — vlož obsah `supabase/functions/stripe-create/index.ts`
- `stripe-voucher` — vlož obsah `supabase/functions/stripe-voucher/index.ts` (dárkové poukazy)
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
  functionsUrl: 'https://TVUJ_PROJECT_REF.functions.supabase.co',
  depositCzk: 499,
  voucherCzk: 499,
};
```
Commitni + pushni. Hotovo — po rezervaci se nabídne platba a objeví se karta
na koupi dárkového poukazu.

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

Když spustíš **`supabase/payments.sql`** (viz sekce *Platby přes Stripe*),
přibude u každé rezervace v adminu **stav platby**:

- **Zaplaceno online** — host zaplatil zálohu online (Stripe).
- **Platba čeká** — platbu spustil, ale ještě nedokončil.
- **Zaplatí na místě** — online neplatil (typicky ruční / telefonická rezervace).

V záložce **Rezervace** navíc:
- Tlačítko **„Označit zaplaceno"** u rezervace = host zaplatil na místě
  (hotově/kartou na recepci). Zase to jde vrátit přes **„Zrušit platbu"**.
- Filtr **Platba** (vše / zaplaceno / platba čeká / zaplatí na místě) a
  krátký souhrn nad seznamem.

> Tahle evidence funguje i **bez** zapnutých online plateb — stačí spustit
> `supabase/payments.sql` a platby na místě si odškrtáváš ručně.

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
