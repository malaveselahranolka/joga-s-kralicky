// =====================================================================
//  KOUPĚ DÁRKOVÉHO POUKAZU — logika stránky koupit-poukaz.html
//
//  1) Výběr druhu (na jakou lekci), počtu a e-mailu → funkce stripe-voucher
//     založí platbu u Stripu a vrátí adresu brány.
//  2) Po zaplacení vrátí Stripe hosta sem s ?voucher=ok&session_id=…
//     a funkce stripe-confirm ověří platbu, uloží poukazy a vrátí kódy.
//
//  Částku NIKDY nepočítá prohlížeč. Tady se jen ukazuje; server si ji
//  spočítá sám z počtu kusů a svého ceníku.
// =====================================================================
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var PAY = window.PAYMENTS || {};
  var CENA = Number(PAY.voucherCzk || 499);
  var MAX = Math.min(10, Math.max(1, Number(PAY.maxVouchers) || 10));
  var DRUHY = (Array.isArray(PAY.voucherDruhy) && PAY.voucherDruhy.length
    ? PAY.voucherDruhy
    : [{ id: 'klasik', nazev: 'Jóga s králíčky', popis: '', aktivni: true }]
  ).filter(function (d) { return d && d.aktivni; });

  var URL_OK = /^https:\/\/.+\.supabase\.co/.test(window.SUPABASE_URL || '') && String(window.SUPABASE_ANON_KEY || '').length > 20;
  var ZAPNUTO = !!PAY.enabled && URL_OK && DRUHY.length > 0;
  var FN = String(window.SUPABASE_URL || '').replace(/\/$/, '') + '/functions/v1/';

  var pocet = 1;
  // ?druh=deti v adrese (odkaz z dětské lekce) rovnou předvybere dětský poukaz
  var chci = new URLSearchParams(location.search).get('druh');
  var druh = DRUHY.filter(function (d) { return d.id === chci; })[0] || DRUHY[0] || null;
  // Cena za kus podle druhu (dětský poukaz = zástupce + 1 dítě).
  var cenaKus = function () { return Number((druh && druh.cenaCzk) || CENA); };

  // Úložiště prohlížeče umí vyhodit chybu (anonymní režim, přísné cookies).
  var ls = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var kc = function (n) { return Number(n).toLocaleString('cs-CZ') + ' Kč'; };
  var kusy = function (n) { return n === 1 ? '1 poukaz' : (n < 5 ? n + ' poukazy' : n + ' poukazů'); };

  function fnPost(jmeno, telo) {
    return fetch(FN + jmeno, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: window.SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + window.SUPABASE_ANON_KEY
      },
      body: JSON.stringify(telo)
    }).then(function (r) {
      return r.json().catch(function () { return null; });
    }).catch(function () { return null; });
  }

  // Kódy poukazů. Počítá se to STEJNĚ ve funkcích stripe-webhook
  // a stripe-confirm — tady jen jako záloha, kdyby stripe-confirm
  // neodpověděla. Měníš-li vzorec, změň ho na všech třech místech.
  function kodyPoukazu(sid, n) {
    var kmen = 'DK-' + String(sid).replace(/[^A-Za-z0-9]/g, '').slice(-8).toUpperCase();
    var c = Math.max(1, Number(n) || 1);
    if (c === 1) return [kmen];
    var out = [];
    for (var i = 1; i <= c; i++) out.push(kmen + '-' + i);
    return out;
  }

  // ---- výběr druhu ---------------------------------------------------
  function vykresliDruhy() {
    var box = $('druhBox');
    if (DRUHY.length < 2) { box.hidden = true; return; }
    var html = '';
    DRUHY.forEach(function (d, i) {
      html += '<label class="druh"><input type="radio" name="druh" value="' + esc(d.id) + '"' + (d === druh ? ' checked' : '') + ' />' +
        '<span class="dot" aria-hidden="true"></span><span><b>' + esc(d.nazev) + ' <em class="cena">' + kc(d.cenaCzk || CENA) + '</em></b>' +
        (d.popis ? '<span class="t">' + esc(d.popis) + '</span>' : '') + '</span></label>';
    });
    $('druhy').innerHTML = html;
    box.hidden = false;
    $('druhy').addEventListener('change', function (e) {
      var id = e.target && e.target.value;
      for (var i = 0; i < DRUHY.length; i++) if (DRUHY[i].id === id) druh = DRUHY[i];
      prekresli();
    });
  }

  // ---- souhrn a ukázka poukazu ---------------------------------------
  // Ukázka je skutečný poukaz z e-mailu (PDF), pro každý druh vlastní.
  var OBRAZKY = {
    klasik: { src: 'assets/photos/poukaz-ukazka', alt: 'Ukázka dárkového poukazu Jóga s králíčky: kód poukazu a platnost 6 měsíců' },
    deti: { src: 'assets/photos/poukaz-ukazka-deti', alt: 'Ukázka dárkového poukazu na lekci Děti & králíčci pro zákonného zástupce s jedním dítětem' }
  };
  function prekresli() {
    $('pocet').textContent = pocet;
    $('minus').disabled = pocet <= 1;
    $('plus').disabled = pocet >= MAX;
    var c = cenaKus();
    $('souhrn').textContent = kusy(pocet) + ' × ' + kc(c);
    $('celkem').textContent = kc(c * pocet);
    $('zaplatit').innerHTML = 'Zaplatit ' + kc(c * pocet) + ' <span class="arrow">→</span>';
    $('lPocet').textContent = kusy(pocet);
    var o = OBRAZKY[druh && druh.id === 'deti' ? 'deti' : 'klasik'];
    var img = $('lObr');
    if (img.getAttribute('data-src') !== o.src) {
      img.setAttribute('data-src', o.src);
      img.srcset = o.src + '-640.webp 640w, ' + o.src + '.webp 1200w';
      img.src = o.src + '.webp';
      img.alt = o.alt;
    }
    $('oSub').textContent = druh && druh.id === 'deti'
      ? 'Dětský poukaz platí na zákonného zástupce s jedním dítětem na lekci Děti & králíčci.'
      : 'Každý poukaz platí na jeden vstup na lekci.';
  }

  // ---- platba ---------------------------------------------------------
  function zaplat() {
    var em = $('email').value.trim();
    var msg = $('zprava');
    var btn = $('zaplatit');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) {
      msg.textContent = 'Zadejte prosím e-mail, kam kód poukazu poslat.';
      $('email').setAttribute('aria-invalid', 'true');
      $('email').focus();
      return;
    }
    $('email').removeAttribute('aria-invalid');
    msg.textContent = '';

    // po návratu z brány z toho poskládáme e-mail a počet (když by
    // stripe-confirm neodpověděla)
    ls.set('voucherEmail', em);
    ls.set('voucherCount', String(pocet));
    ls.set('voucherDruh', druh ? druh.id : 'klasik');

    var puvodni = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'Otevírám platbu…';

    if (window.jskUdalost) window.jskUdalost('begin_checkout', {
      currency: 'CZK', value: cenaKus() * pocet,
      items: [{ item_id: 'poukaz', item_name: 'Dárkový poukaz na lekci', item_variant: druh ? druh.id : 'klasik', price: cenaKus(), quantity: pocet }]
    });

    fnPost('stripe-voucher', { email: em, count: pocet, druh: druh ? druh.id : 'klasik' }).then(function (b) {
      if (b && b.ok && b.url) { window.location.href = b.url; return; }
      btn.disabled = false;
      btn.innerHTML = puvodni;
      msg.textContent = 'Platbu se teď nepodařilo otevřít. Zkuste to prosím znovu, nebo nám napište na info@jogaskralicky.cz.';
    });
  }

  // ---- stav po návratu z platby --------------------------------------
  function stav(ikona, nadpis, html, akce) {
    var box = $('stav');
    box.innerHTML =
      '<div class="icon' + (ikona === 'ok' ? '' : ' info') + '">' +
        (ikona === 'ok'
          ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'
          : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>') +
      '</div><h2>' + esc(nadpis) + '</h2>' + (html || '') + (akce ? '<div class="acts">' + akce + '</div>' : '');
    $('orderForm').hidden = true;
    box.hidden = false;
    // Na telefonu je karta až pod nadpisem — dojet k ní a dát jí fokus,
    // ať ji čtečka obrazovky přečte.
    try { box.focus({ preventScroll: true }); } catch (e) {}
    var y = $('order').getBoundingClientRect().top + window.scrollY - 90;
    if (window.innerWidth <= 900) window.scrollTo(0, Math.max(0, y));
  }

  var ZNOVU = '<a class="btn btn-ghost" href="koupit-poukaz.html">Koupit další poukaz</a>';

  function navrat(q) {
    var v = q.get('voucher');
    var sid = q.get('session_id') || '';
    if (v === 'zrus') {
      stav('info', 'Nákup poukazu nedokončen', '<p>Platba neproběhla a nic se nestrhlo. Klidně to zkuste znovu.</p>',
        '<a class="btn btn-primary" href="koupit-poukaz.html">Zkusit znovu <span class="arrow">→</span></a>');
      return;
    }
    if (v !== 'ok') return;

    var em = ls.get('voucherEmail') || '';
    var n = Math.max(1, Number(ls.get('voucherCount')) || 1);
    stav('info', 'Ověřujeme platbu…', '<p>Chviličku strpení, ptáme se platební brány na potvrzení.</p>', '');

    // Poukaz musí vzniknout v databázi, jinak ho majitelka u dveří nenajde.
    // stripe-confirm si stav ověří přímo u Stripu (prohlížeči nevěří nic)
    // a vrátí kódy, které opravdu uložila. Webhook to umí taky, tohle je
    // druhá, rychlejší cesta.
    fnPost('stripe-confirm', { session_id: sid }).then(function (vb) {
      var kody = (vb && vb.ok && Array.isArray(vb.codes) && vb.codes.length) ? vb.codes : kodyPoukazu(sid, n);
      var vic = kody.length > 1;

      // Klíčem je ID platební relace, takže obnovení stránky nákup nezapočítá dvakrát.
      if (window.jskUdalostJednou && sid) window.jskUdalostJednou(sid, 'purchase', {
        transaction_id: sid, currency: 'CZK', value: CENA * kody.length,
        items: [{ item_id: 'poukaz', item_name: 'Dárkový poukaz na lekci', item_variant: ls.get('voucherDruh') || 'klasik', price: CENA, quantity: kody.length }]
      });

      stav('ok', vic ? 'Poukazy jsou zaplacené 🐰' : 'Poukaz je zaplacený 🐰',
        '<p>Děkujeme! Tady ' + (vic ? 'jsou kódy dárkových poukazů' : 'je kód dárkového poukazu') +
        '. Obdarovaný ' + (vic ? 'je' : 'ho') + ' uplatní v rezervaci u pole „Mám dárkový poukaz“.</p>' +
        '<div class="code-list">' + kody.map(function (c) { return '<span class="code-box">' + esc(c) + '</span>'; }).join('') + '</div>' +
        // Věta o e-mailu se řídí tím, co odpověděl server — neslibovat
        // odeslání, o kterém nevíme.
        '<p>' + (em && vb && vb.serverEmail
          ? ('Poslali jsme ' + (vic ? 'je' : 'ho') + ' i na ' + esc(em) + '.')
          : ('Uložte si ' + (vic ? 'je' : 'ho') + ' prosím (opište nebo udělejte snímek obrazovky).')) + '</p>',
        '<a class="btn btn-primary" href="rezervace.html">Vybrat termín <span class="arrow">→</span></a>' + ZNOVU);
      ls.del('voucherEmail'); ls.del('voucherCount'); ls.del('voucherDruh');
    });
  }

  // ---- start ----------------------------------------------------------
  var q = new URLSearchParams(location.search);
  if (q.has('voucher')) { navrat(q); }

  vykresliDruhy();
  prekresli();

  if (!ZAPNUTO) {
    $('vypnuto').hidden = false;
    $('zaplatit').disabled = true;
    $('plus').disabled = true;
    $('email').disabled = true;
    return;
  }

  var ulozeny = ls.get('voucherEmail');
  if (ulozeny && !$('email').value) $('email').value = ulozeny;

  $('minus').addEventListener('click', function () { if (pocet > 1) { pocet--; prekresli(); } });
  $('plus').addEventListener('click', function () { if (pocet < MAX) { pocet++; prekresli(); } });
  $('zaplatit').addEventListener('click', zaplat);
  $('email').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); zaplat(); } });
  $('email').addEventListener('input', function () { $('email').removeAttribute('aria-invalid'); $('zprava').textContent = ''; });
})();
