# Návodová videa: rezervace a dárkový poukaz

Dvě videa pro Instagram, každé od otevření webu až po e-mail:

| Video | Délka | Co ukazuje |
|---|---|---|
| `out/rezervace.mp4` | ~74 s | úvodní stránka → termín → formulář → 2 místa → platba → „Zaplaceno ✓“ → e-mail s QR |
| `out/poukaz.mp4` | ~68 s | Koupit poukaz → druh → e-mail → platba → kód na webu → e-mail s kódem → PDF v příloze |

Formát je 1080 × 1350 (příspěvek 4:5) a 30 fps. Vlevo je seznam kroků se
zvýrazněným aktuálním krokem, vpravo telefon s nahrávkou webu v mobilním
zobrazení (390 px).

## Co je ve videu skutečné

- **Web** je živý https://www.jogaskralicky.cz, včetně aktuálních termínů.
- **Platební brána** je skutečná Stripe Checkout ze **sandboxu** („kralicci
  sandbox“). Session má stejné položky, texty a vzhled jako ta, kterou
  zakládají `stripe-create` a `stripe-voucher`. Platí se testovací kartou
  4242 4242 4242 4242. Od ostré brány se liší jen štítkem „Sandbox“.
- **E-maily** jsou skutečný výstup šablon `supabase/functions/_shared/templates.ts`
  zobrazený v jednoduché poštovní aplikaci (`posta.html`). Příloha poukazu
  je `assets/photos/poukaz-ukazka.webp`, proto má poukaz kód `DK-KRALICEK`.

Do ostré databáze ani ostrého Stripu se nic nezapíše. `nahraj.mjs` v prohlížeči
zachytí `create_booking`, `stripe-create`, `stripe-voucher`, `stripe-confirm`
a `get_ticket` a odpoví ukázkovými daty. Měření (GA, Vercel) je vypnuté.

## Jak videa přegenerovat

1. V Stripe sandboxu založte Checkout Session se stejnými parametry, jaké
   posílá `stripe-create` (u poukazu `stripe-voucher`) a navíc
   `adaptive_pricing.enabled = false` a `locale = cs`. `success_url` musí
   vést na živý web (`/rezervace.html?platba=ok…`, resp.
   `/koupit-poukaz.html?voucher=ok…`). Session jde zaplatit jen jednou,
   takže na každou nahrávku je potřeba nová.
2. Nahrajte a složte:

```bash
STRIPE_URL='https://checkout.stripe.com/c/pay/cs_test_…' \
  node --experimental-strip-types docs/navod-video/nahraj.mjs rezervace
node docs/navod-video/slozit.mjs rezervace
```

Bez `STRIPE_URL` se místo skutečné brány použije kopie `stripe.html`.

Potřebujete Playwright (Chromium) a ffmpeg s libx264. Cesty se dají přebít
proměnnými `PLAYWRIGHT` a `FFMPEG`. Když prohlížeč jde přes proxy s vlastní
certifikační autoritou, musí ji mít v NSS úložišti (`~/.pki/nssdb`).

- `nahraj.mjs` proklikává web a nahrává ho přes CDP screencast do `out/<scéna>/`.
- `slozit.mjs` z toho složí 30fps video, zkrátí chvíle, kdy se nic nehýbe,
  a přidá rámeček `ramecek.html` (vykreslovaný snímek po snímku přes `seek(t)`).
