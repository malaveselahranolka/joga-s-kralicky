# SEO plán — Jóga s králíčky

Stav a výchozí měření: 8. září 2026. Výsledky byly ověřené v nepersonalizovaném Google hledání pro Česko; pořadí se může lišit podle polohy, zařízení a času.

## Výchozí stav

| Dotaz | Stav před úpravou |
|---|---|
| jóga s králíčky Ostrava | homepage na 1. místě |
| králičí jóga Ostrava | homepage na 1. místě |
| bunny yoga Ostrava | web nebyl v první desítce |
| jóga se zvířátky Ostrava | web nebyl v první desítce |
| jóga se zvířaty Ostrava | web nebyl v prvních 40 výsledcích |
| jóga Ostrava | web nebyl v první desítce |

Web tedy nebyl plošně neindexovaný. Uměl vyhrát značkové a velmi přesné králičí dotazy, ale homepage neměla dost silné pokrytí obecnějšího lokálního záměru. Přesný objem jednotlivých frází nelze poctivě určit z výsledků vyhledávání; k tomu slouží vlastní data v Search Console nebo Keyword Planneru. Architektura proto pokrývá celý významově shodný cluster, ne domnělý žebříček hledanosti.

## Která stránka vlastní který záměr

| Primární stránka | Hlavní dotazy | Úloha |
|---|---|---|
| `/` | jóga se zvířaty Ostrava, jóga se zvířátky Ostrava, pet yoga Ostrava, bunny yoga Ostrava, jóga s králíčky Ostrava, králičí jóga Ostrava | jediná hlavní stránka služby a značky |
| `/joga-se-zviraty.html` | co je jóga se zvířaty, jak probíhá jóga se zvířaty, welfare zvířat | informační průvodce bez lokálního komerčního titulku |
| `/joga-pro-deti-ostrava.html` | jóga pro děti Ostrava, jóga se zvířaty pro děti | dětský formát od 5 let |
| `/darkovy-poukaz.html` | dárkový poukaz jóga Ostrava, zážitkový dárek Ostrava | nákup poukazu |
| `/rezervace.html` | rezervace jóga s králíčky, termíny | aktuální termíny a platba |

Homepage je u tohoto projektu zároveň stránkou hlavní služby. Králičí jóga, jóga se zvířaty, pet yoga a bunny yoga neoznačují čtyři odlišné nabídky, ale stejný lokální komerční záměr. Patří proto na jednu URL. Samostatný průvodce odpovídá na obecný informační záměr: vysvětluje průběh, rozdíly mezi formáty a welfare a vede čtenáře hledajícího Ostravu zpět na homepage.

## Co řeší tato změna

- Homepage vlastní celý lokální komerční cluster a obsahuje přesnou lokalitu, nabídku, cenu, kapacitu i přirozené varianty dotazu.
- Informační průvodce `/joga-se-zviraty.html` zůstává zachovaný, ale jeho title a H1 necílí na „Ostrava“. Nepravdivý pevný rozvrh, neověřené celorepublikové ceny a odkaz na zrušenou stránku o štěňatech byly odstraněny.
- Čistá varianta `/joga-se-zviraty` trvale přesměrovává na kanonickou `.html` adresu průvodce.
- URL o štěňatech, tedy službě, kterou studio nenabízí, vrací `410 Gone` s užitečnou vysvětlující stránkou; nepředstírá tematickou náhradu na homepage.
- Staré adresy `/kontakt` a `/kontakt.html` přesměrovávají na kontakt na homepage.
- Věk dětí je ve všech aktuálních podkladech sjednocen na **od 5 let**.
- Dětská stránka už netvrdí pevný čas 9:30; jediným zdrojem právě dostupných termínů je rezervace.
- Právní stránky zůstávají dostupné, ale mají `noindex` a nejsou v sitemapě.
- Homepage má title zaměřený na „jóga se zvířaty Ostrava“, značkový H1 a přirozeně vysvětluje varianty pet yoga, bunny yoga, jóga se zvířátky a králičí jóga.
- FAQ schema homepage se při buildu skládá ze stejného obsahu jako viditelné FAQ, takže úprava v administraci nevytvoří rozpor. Google FAQ rich results už nezobrazuje; markup zde neslibujeme jako rankingový faktor.
- Build se zastaví při strukturální chybě, například nevalidním JSON-LD, chybějícím souboru, rozbitém canonicalu nebo routě. Odchylka ve volně editovatelném obsahu vypíše při nasazení varování, ale administraci nezablokuje; přísný `npm run check` zůstává pro vývoj a kontrolu PR.

## Co musí následovat mimo kód

### Ihned po nasazení

1. V Google Search Console požádat o nové procházení homepage `/` a průvodce `/joga-se-zviraty.html`.
2. Znovu odeslat `https://www.jogaskralicky.cz/sitemap.xml`.
3. Ověřit, že `/joga-se-zviraty` vrací 308 na `/joga-se-zviraty.html`, puppy URL vracejí 410 a `/kontakt.html` vrací 308 na kontakt homepage.
4. Po 7–14 dnech zkontrolovat, kterou URL Google zobrazuje pro lokální a informační dotazy. Jde o kontrolní termín, ne garantovanou dobu zpracování.

### Google Business Profile

- Doplnit pravdivou hlavní kategorii, otevírací dobu nebo režim „pouze dle termínů“, popis služeb a aktuální fotografie přímo z lekcí.
- Držet všude stejné údaje: **Jóga s králíčky**, Tovární 486/7, Ostrava-Mariánské Hory, +420 603 340 860.
- Po každé lekci požádat skutečné návštěvníky o upřímnou recenzi přes přímý Google odkaz. Nenabízet odměnu a nevybírat jen spokojené hosty.
- Na recenze odpovídat věcně a přirozeně; nevkládat do každé odpovědi klíčová slova.

### Lokální autorita

- Získat odkaz z webu Fit&Fun Studia přímo na `https://www.jogaskralicky.cz/`.
- Nabídnout skutečný příběh a fotografie ostravským médiím, lokálním přehledům akcí a relevantním partnerům.
- U každé zmínky kontrolovat stejný název, adresu, telefon a cílovou URL.
- Nekupovat balíky odkazů a nevyrábět umělé „SEO články“ na nesouvisejících webech.

## Měření na 90 dní

V Search Console sledovat zvlášť značkové a neznačkové dotazy. Hlavní neznačkový cluster:

- jóga se zvířaty Ostrava
- jóga se zvířátky Ostrava
- bunny yoga Ostrava
- pet yoga Ostrava
- králičí jóga Ostrava
- jóga pro děti Ostrava

Každý týden uložit imprese, kliknutí, CTR a průměrnou pozici cílové stránky. V analytice sledovat přechody na rezervaci a dokončené platby z organického vyhledávání. Samotná pozice bez rezervací není obchodní výsledek.

První cíl je získat stabilní indexaci a růst impresí pro neznačkový cluster. Umístění v top 3 je dlouhodobý cíl, ne něco, co lze po technické úpravě poctivě garantovat — u lokálních výsledků rozhodují také vzdálenost hledajícího a veřejná známost firmy.

## Referenční dokumentace

- [Google: jak fungují lokální výsledky](https://support.google.com/business/answer/7091)
- [Google: užitečný a spolehlivý obsah](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)
- [Google: canonicaly a přesměrování duplicit](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
- [Google: vytvoření a odeslání sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Google Search updates: ukončení FAQ rich results v červnu 2026](https://developers.google.com/search/updates#june-2026)
