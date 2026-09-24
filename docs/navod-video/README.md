# Návodová videa: rezervace a dárkový poukaz

Dvě krátká videa pro zákazníky, od otevření webu až po e-mail:

| Video | Délka | Co ukazuje |
|---|---|---|
| `out/rezervace.mp4` | ~62 s | termín → formulář → platba → „Zaplaceno ✓“ → potvrzovací e-mail s QR |
| `out/poukaz.mp4` | ~56 s | Koupit poukaz → druh a e-mail → platba → kód na webu → e-mail s kódem a PDF |

Formát je 1080 × 1920 (na výšku) a 30 fps, takže se hodí do Reels, stories i na web.

## Styl

Obrazovky jsou wireframe, něco mezi skicou a nahrávkou obrazovky. Fotky
nahrazují přeškrtnuté rámečky a odstavce šedé linky. Tlačítka, popisky polí,
ceny a texty e-mailů jsou ale opsané z webu (`rezervace.html`,
`koupit-poukaz.html`, `assets/poukaz-koupit.js`) a ze šablon e-mailů
(`supabase/functions/_shared/templates.ts`).

Údaje ve videu jsou ukázkové: jména, e-maily, kód poukazu `DK-Q7K4M2XA` i
testovací karta `4242 …`. QR kód nic nekóduje. Platební brána je zjednodušená
podoba Stripe Checkout, skutečná vypadá trochu jinak.

## Jak videa přegenerovat

Když se změní texty na webu, upravte `rezervace.html` / `poukaz.html` tady ve
složce (scénář je dole v `<script>`) a spusťte:

```bash
node docs/navod-video/record.mjs              # obě videa
node docs/navod-video/record.mjs poukaz       # jen jedno
FRAMES=5,20,40 node docs/navod-video/record.mjs rezervace   # jen kontrolní PNG
```

Potřebujete Playwright (Chromium) a ffmpeg s libx264. Cesty se dají přebít
proměnnými `PLAYWRIGHT` a `FFMPEG`. Scéna se renderuje snímek po snímku
(`engine.js` → `window.seek(t)`), takže každé spuštění dá stejné video.
