# Jóga s králíčky — pravidla projektu

## Co to je

Statické HTML na Vercelu + Supabase (rezervace, poukazy, Stripe platby)
+ vlastní CMS v repozitáři. **Sanity je od 7. 9. 2026 pryč** — kdyby ji
zmiňoval jakýkoli soubor nebo poznámka, je to zastaralé.

| Část | Kde běží | K čemu |
|---|---|---|
| Statické HTML + `assets/` | Vercel | web sám, styly inline v každé stránce |
| `content/obsah.json` | repo | **jediný zdroj pravdy pro texty a fotky** |
| `scripts/obsah-do-html.mjs` | build | vsadí obsah do HTML, ještě než se odešle |
| `admin.html` → „Obsah webu" | Vercel | tady to edituje majitelka, uloží se commitem |
| Supabase | Supabase | lekce, rezervace, poukazy, Stripe |

## Nejdůležitější pravidlo

**Text na webu se nemění v HTML.** Mění se v `content/obsah.json` (nebo ve správě)
a do HTML ho vsadí build. Úprava přímo v `index.html` se při dalším buildu ztratí.

Výjimka: `obsah.json` → `galerie` se pořád edituje ručně v souboru.

## Než něco nahlásíš jako hotové

```bash
npm run verify
```

Kontroluje skripty, fakta, sitemapu, odkazy i robots. Musí projít.
`npm run build` generuje `public/` — do gitu `public/` nepatří.

## Pasti, na které se tu už šláplo

- **Nevracej blok `.proof`** (pruh se statistikami) do `index.html`. Čísla
  `4,9★ z 230 hodnocení` byla vymyšlená a `obsah.json` klíč `stats` nemá,
  takže není odkud je dosadit. Podmínka pro vrácení je v paměti projektu.
- **`admin.html` zůstává na Google Fonts záměrně** (Fraunces + Nunito Sans,
  je noindex). V CSP proto musí zůstat `fonts.googleapis.com` a `fonts.gstatic.com`.
  Nemazat je s odůvodněním „už self-hostujeme" — to platí jen pro veřejný web.
- **Tvrzení o produkci si vždy ověř dotazem**, ne z paměti. Produkční Supabase
  se v minulosti rozcházel s repem a tři ze čtyř zapsaných tvrzení o něm
  mezitím přestala platit.
- **Hlavní checkout je 116 commitů pozadu.** Když něco „v repu není", ověř,
  ve kterém stromě se díváš.

## Screenshoty

`node serve.mjs`, pak `node screenshot.mjs <url> [label] [width] [light|dark] [full|fold]`.
Projekt má `puppeteer-core`, ne `puppeteer` — skript si proto bere nainstalovaný
Chrome (přebít jde přes `PUPPETEER_EXECUTABLE_PATH`). Mobil (390) nepřeskakuj.

Podrobný návod na rezervace, Stripe, QR a e-maily je v `NASTAVENI.md`.
