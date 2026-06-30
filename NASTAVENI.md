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

## Platby přes Comgate (volitelná záloha) — příprava

Web umí **volitelnou online zálohu** přes platební bránu **Comgate**. Je to
**vypnuté**, dokud to sám nezapneš — do té doby je rezervace zdarma jako teď.

> Tajný klíč (secret) z Comgate **nikdy nedávej do `comgate-config.js` ani do
> repozitáře**. Patří jen na server (Supabase Edge Functions, krok C níže).

### Jak to funguje
1. Zákazník dokončí rezervaci jako dosud (místo se hned drží).
2. Na potvrzovací obrazovce se navíc objeví tlačítko **„Zaplatit zálohu online"**.
3. Po kliknutí ho web pošle do Comgate; po zaplacení se vrátí zpět.
4. Comgate pošle potvrzení na server (callback) a stav platby se uloží k rezervaci.

Platba je **nepovinná** — rezervace platí i bez ní.

### A) Účet a klíče
1. Založ účet na **https://www.comgate.cz** a v administraci si najdi
   **identifikátor e-shopu (merchant)** a **propojovací heslo (secret)**.
2. Pro zkoušení zapni v Comgate **testovací režim**.

### B) Databáze (jednorázově)
V Supabase → **SQL Editor** → **New query** vlož obsah souboru
**`supabase/comgate.sql`** a dej **Run**. Přidá k rezervacím sloupce o stavu platby.

### C) Nasazení serverových funkcí (Supabase CLI)
Potřebuješ [Supabase CLI](https://supabase.com/docs/guides/cli). V kořeni projektu:
```bash
supabase login
supabase link --project-ref TVUJ_PROJECT_REF      # ref najdeš v Project Settings → General

# tajné údaje (uloží se jen na serveru, ne do repa):
supabase secrets set COMGATE_MERCHANT=123456
supabase secrets set COMGATE_SECRET=tvuj_tajny_secret
supabase secrets set COMGATE_TEST=true            # na ostro později false
supabase secrets set COMGATE_DEPOSIT_CZK=290      # výše zálohy v Kč (hlídá server)

# nasaď funkce:
supabase functions deploy comgate-create
supabase functions deploy comgate-callback
supabase functions deploy comgate-status
```
Funkce poběží na `https://TVUJ_PROJECT_REF.functions.supabase.co/...`.

### D) URL v Comgate portálu
V nastavení e-shopu v Comgate vyplň:
- **URL pro notifikaci (callback):** `https://TVUJ_PROJECT_REF.functions.supabase.co/comgate-callback`
- **Návratová URL (po zaplacení):** `https://malaveselahranolka.github.io/joga-s-kralicky/#rezervace`

### E) Zapnutí na webu
Otevři **`comgate-config.js`** a nastav:
```js
window.COMGATE = {
  enabled: true,
  functionsUrl: 'https://TVUJ_PROJECT_REF.functions.supabase.co',
  depositCzk: 290,
  currency: 'CZK',
  lang: 'cs',
  test: true,            // na ostro dej false (a v Comgate vypni testovací režim)
};
```
Commitni + pushni. Hotovo — po rezervaci se nabídne online záloha.

### F) Test
Udělej zkušební rezervaci a klikni na **Zaplatit zálohu**. V testovacím režimu
Comgate nabídne testovací platbu. Po návratu se nahoře u Rezervace ukáže stav.
V Supabase → Table editor → `bookings` uvidíš `payment_status = paid`.

> Ostrý provoz: v Comgate vypni testovací režim, dej `COMGATE_TEST=false`
> (`supabase secrets set ...`) a v `comgate-config.js` `test: false`.
