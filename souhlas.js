// =====================================================================
//  SOUHLAS SE STATISTIKAMI  →  a teprve pak Google Analytics
// ---------------------------------------------------------------------
//  Do 3. 9. 2026 měla každá stránka v hlavičce natvrdo `gtag.js`. Znamenalo
//  to, že se návštěvníkovi hned při načtení uložila cookie `_ga` a Googlu
//  odešel jeho identifikátor — bez zeptání. Zásady zpracování osobních údajů
//  přitom tvrdily pravý opak („žádné reklamní cookies, proto na vás
//  nevyskakuje lišta se souhlasem"). Analytické cookies ale souhlas
//  vyžadují (§ 89 odst. 3 zákona č. 127/2005 Sb.).
//
//  Řešení je schválně přísnější, než bývá zvykem: `gtag.js` se NENAČTE
//  VŮBEC, dokud návštěvník neřekne ano. Běžné implementace skript pustí
//  hned a jen mu přes Consent Mode zakážou ukládání — jenže i tak odejde
//  Googlu požadavek s IP adresou. Takhle neodejde nic. Vedlejší efekt:
//  kdo souhlas nedá, nestahuje si 100 kB cizího JavaScriptu.
//
//  Consent Mode v2 se nastavuje i tak — až se skript jednou načte, musí
//  zastihnout správný výchozí stav.
//
//  Rozhodnutí se ukládá do localStorage, ne do cookie: je to údaj nutný
//  pro fungování webu (bez něj bychom se ptali pořád dokola), takže na něj
//  souhlas potřeba není, a nikam se neodesílá.
//
//  Odvolání souhlasu: tlačítko v zásadách zpracování osobních údajů volá
//  window.jskZmenitSouhlas(). Bez té možnosti by souhlas nebyl platný.
// =====================================================================
(function () {
  'use strict';

  var KLIC = 'jsk-souhlas';
  var MERAK = 'G-0FBG13R4FH';
  var ZASADY = '/zasady-osobnich-udaju.html#cookies';

  // ---- uložené rozhodnutí -------------------------------------------
  // Prohlížeč v anonymním okně nebo s vypnutým úložištěm hodí výjimku.
  // Pak se jen zeptáme znovu, což je bezpečnější než spadnout.
  function precti() {
    try {
      var s = window.localStorage.getItem(KLIC);
      return s ? JSON.parse(s) : null;
    } catch (e) { return null; }
  }
  function zapis(stav) {
    try {
      window.localStorage.setItem(KLIC, JSON.stringify({stav: stav, datum: new Date().toISOString()}));
    } catch (e) { /* bez úložiště se zeptáme příště znovu */ }
  }

  // ---- gtag fronta ---------------------------------------------------
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;

  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    functionality_storage: 'granted',
    security_storage: 'granted',
  });

  var nacteno = false;

  function nactiGA() {
    if (nacteno) return;
    nacteno = true;
    gtag('consent', 'update', {analytics_storage: 'granted'});
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + MERAK;
    document.head.appendChild(s);
    gtag('js', new Date());
    gtag('config', MERAK);
  }

  function vypniGA() {
    gtag('consent', 'update', {analytics_storage: 'denied'});
    // Cookies z už proběhlého měření smažeme rovnou, ať odvolání souhlasu
    // není jen formální. Doména se zapisuje i s tečkou — GA ji tak zakládá.
    var domena = location.hostname.replace(/^www\./, '');
    document.cookie.split(';').forEach(function (par) {
      var jmeno = par.split('=')[0].trim();
      if (jmeno.indexOf('_ga') !== 0) return;
      ['/', ''].forEach(function (cesta) {
        [domena, '.' + domena, location.hostname, ''].forEach(function (d) {
          document.cookie = jmeno + '=; max-age=0; path=' + (cesta || '/') + (d ? '; domain=' + d : '');
        });
      });
    });
  }

  // ---- veřejné rozhraní pro měření konverzí --------------------------
  // Vrací true, když událost skutečně odešla. Volající se tím může řídit,
  // ale nemusí — bez souhlasu je to prostě tichý no-op, nikdy chyba.
  window.jskUdalost = function (nazev, parametry) {
    if (!nacteno) return false;
    gtag('event', nazev, parametry || {});
    return true;
  };

  // Nákup se smí započítat jen jednou. Návratová stránka z platební brány má
  // v adrese `?platba=ok`, takže obyčejné obnovení stránky (F5) by událost
  // poslalo znovu a tržby v přehledu by narostly o platbu, která se nikdy
  // nestala. Proto si pamatujeme, co už odešlo — klíčem je číslo rezervace
  // nebo platební relace. Seznam se drží krátký, historie tu k ničemu není.
  var KLIC_MERENO = 'jsk-mereno';
  window.jskUdalostJednou = function (id, nazev, parametry) {
    if (!nacteno || !id) return false;
    var hotove;
    try { hotove = JSON.parse(window.localStorage.getItem(KLIC_MERENO) || '[]'); }
    catch (e) { hotove = []; }
    if (!Array.isArray(hotove)) hotove = [];
    if (hotove.indexOf(id) !== -1) return false;
    hotove.push(id);
    try { window.localStorage.setItem(KLIC_MERENO, JSON.stringify(hotove.slice(-20))); }
    catch (e) { /* bez úložiště radši změříme dvakrát než vůbec */ }
    return window.jskUdalost(nazev, parametry);
  };

  // ---- lišta ---------------------------------------------------------
  var STYL = [
    '.jsk-souhlas{',
    '  position:fixed;left:1.25rem;bottom:1.25rem;z-index:900;',
    '  width:min(26rem,calc(100vw - 2.5rem));',
    '  box-sizing:border-box;padding:1.15rem 1.25rem 1.1rem;',
    '  background:var(--surface,#FFFFFF);color:var(--ink,#1E231C);',
    '  border:1px solid var(--line,#E3DFD3);',
    '  border-radius:20px 24px 20px 26px;',
    '  box-shadow:0 1px 2px rgba(30,41,32,.07),0 14px 34px -14px rgba(30,41,32,.42);',
    '  font-family:"Hanken Grotesk",system-ui,sans-serif;',
    '  opacity:0;transform:translateY(10px);',
    '  transition:opacity .26s var(--ease,cubic-bezier(.22,.61,.36,1)),transform .26s var(--ease,cubic-bezier(.22,.61,.36,1));',
    '}',
    '.jsk-souhlas.je-videt{opacity:1;transform:none}',
    '.jsk-souhlas h2{',
    '  font-family:"Schibsted Grotesk",system-ui,sans-serif;',
    '  font-size:1.02rem;font-weight:600;letter-spacing:-.01em;',
    '  margin:0 0 .35rem;line-height:1.3;color:var(--forest,#2C3B2E);',
    '}',
    '.jsk-souhlas p{margin:0 0 .9rem;font-size:.88rem;line-height:1.55;color:var(--ink-soft,#5C6357)}',
    '.jsk-s-akce{display:flex;gap:.5rem;flex-wrap:wrap}',
    '.jsk-s-akce button{',
    '  flex:1 1 8rem;min-height:2.75rem;padding:.55rem 1.1rem;',
    '  font-family:"Hanken Grotesk",system-ui,sans-serif;',
    '  font-size:.92rem;font-weight:600;line-height:1.2;',
    '  border-radius:999px;cursor:pointer;',
    '  transition:background-color .22s var(--ease,ease),border-color .22s var(--ease,ease),transform .18s var(--ease,ease);',
    '}',
    '.jsk-s-ano{background:var(--forest,#2C3B2E);color:var(--cream,#F7F4EC);border:1px solid var(--forest,#2C3B2E)}',
    '.jsk-s-ano:hover{background:var(--forest-deep,#1E2920);border-color:var(--forest-deep,#1E2920)}',
    '.jsk-s-ne{background:transparent;color:var(--ink,#1E231C);border:1px solid var(--line,#E3DFD3)}',
    '.jsk-s-ne:hover{border-color:var(--forest,#2C3B2E);background:var(--cream,#F7F4EC)}',
    '.jsk-s-akce button:active{transform:translateY(1px)}',
    '.jsk-souhlas a{',
    '  display:inline-block;margin-top:.75rem;font-size:.8rem;',
    '  color:var(--ink-soft,#5C6357);text-underline-offset:3px;',
    '}',
    '.jsk-souhlas a:hover{color:var(--forest,#2C3B2E)}',
    '.jsk-souhlas :focus-visible{outline:2px solid var(--clover,#6E8A4E);outline-offset:3px;border-radius:999px}',
    '@media (max-width:560px){',
    '  .jsk-souhlas{left:.75rem;right:.75rem;bottom:.75rem;width:auto}',
    '}',
    '@media (prefers-reduced-motion:reduce){',
    '  .jsk-souhlas{transition:none;opacity:1;transform:none}',
    '  .jsk-s-akce button{transition:none}',
    '}',
  ].join('\n');

  var lista = null;

  function schovej() {
    if (!lista) return;
    var uzel = lista;
    lista = null;
    uzel.classList.remove('je-videt');
    window.setTimeout(function () { if (uzel.parentNode) uzel.parentNode.removeChild(uzel); }, 300);
  }

  function ukaz() {
    if (lista || !document.body) return;

    if (!document.getElementById('jsk-souhlas-styl')) {
      var st = document.createElement('style');
      st.id = 'jsk-souhlas-styl';
      st.textContent = STYL;
      document.head.appendChild(st);
    }

    lista = document.createElement('aside');
    lista.className = 'jsk-souhlas';
    lista.setAttribute('role', 'region');
    lista.setAttribute('aria-label', 'Souhlas se statistikami návštěvnosti');

    var h = document.createElement('h2');
    h.textContent = 'Můžeme počítat návštěvy?';

    var p = document.createElement('p');
    p.textContent = 'Google Analytics nám ukáže, kolik lidí na web přišlo a odkud. '
      + 'Bez vašeho souhlasu se vůbec nespustí. Rezervace i platba fungují tak jako tak.';

    var akce = document.createElement('div');
    akce.className = 'jsk-s-akce';

    var ano = document.createElement('button');
    ano.type = 'button';
    ano.className = 'jsk-s-ano';
    ano.textContent = 'Souhlasím';
    ano.addEventListener('click', function () { zapis('ano'); nactiGA(); schovej(); });

    var ne = document.createElement('button');
    ne.type = 'button';
    ne.className = 'jsk-s-ne';
    ne.textContent = 'Nechci';
    ne.addEventListener('click', function () { zapis('ne'); schovej(); });

    akce.appendChild(ano);
    akce.appendChild(ne);

    var odkaz = document.createElement('a');
    odkaz.href = ZASADY;
    odkaz.textContent = 'Co přesně sbíráme';

    lista.appendChild(h);
    lista.appendChild(p);
    lista.appendChild(akce);
    lista.appendChild(odkaz);

    // Na začátek stránky, ne na konec: lišta se tím dostane hned na začátek
    // pořadí tabulátoru, takže se k rozhodnutí dostane i ten, kdo nemyší.
    // Focus jí ale schválně nebereme — vytrhávat kurzor z rozečtené stránky
    // je horší než o jedno zmáčknutí tabulátoru navíc.
    document.body.insertBefore(lista, document.body.firstChild);

    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () { if (lista) lista.classList.add('je-videt'); });
    });
  }

  // ---- odvolání / změna rozhodnutí ------------------------------------
  window.jskZmenitSouhlas = function () {
    try {
      window.localStorage.removeItem(KLIC);
      window.localStorage.removeItem(KLIC_MERENO);
    } catch (e) {}
    if (nacteno) vypniGA();
    nacteno = false;
    ukaz();
  };

  // Tlačítko v zásadách zpracování osobních údajů. Wiring je tady, ne
  // v atributu onclick, aby stránky zůstaly bez inline handlerů — kdyby se
  // CSP jednou zpřísnila o 'unsafe-inline', tohle přežije.
  function pripojTlacitko() {
    var b = document.getElementById('zmenitSouhlas');
    if (b) b.addEventListener('click', window.jskZmenitSouhlas);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pripojTlacitko);
  else pripojTlacitko();

  // ---- start -----------------------------------------------------------
  var rozhodnuti = precti();
  if (rozhodnuti && rozhodnuti.stav === 'ano') nactiGA();
  else if (!rozhodnuti) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ukaz);
    else ukaz();
  }
})();
