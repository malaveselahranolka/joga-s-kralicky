// =====================================================================
//  AI ASISTENT — logika stránky asistent.html (odpovídá /api/chat)
//
//  Konverzace žije jen v sessionStorage této karty, takže když člověk
//  chat zavře a za chvíli otevře znovu, najde ji tam. Server nic neukládá.
// =====================================================================
(function () {
  var KLIC = 'jsk-chat-v1';
  var RYCHLE = [
    'Kdy je nejbližší lekce?',
    'Co si mám vzít s sebou?',
    'Jak funguje dárkový poukaz?',
    'Jak se k vám dostanu?'
  ];

  var log = document.getElementById('log');
  var chips = document.getElementById('chips');
  var form = document.getElementById('form');
  var pole = document.getElementById('pole');
  var odeslat = document.getElementById('odeslat');
  var zpet = document.getElementById('zpet');
  var ceka = false;

  // ---- zpět na původní stránku --------------------------------------
  // Křížek vrátí prohlížeč o krok zpět: stránka se obnoví z paměti
  // přesně na místě, kde člověk byl. Když přišel odjinud (odkaz, nová
  // karta), pošleme ho na stránku z parametru ?z=, nebo na homepage.
  var z = new URLSearchParams(location.search).get('z') || '';
  var cil = /^\/(?!\/)[a-z0-9\-\/.]*$/i.test(z) ? z : '/';
  zpet.href = cil;
  zpet.addEventListener('click', function (e) {
    var zWebu = false;
    try { zWebu = !!document.referrer && new URL(document.referrer).origin === location.origin; } catch (_e) {}
    if (zWebu && history.length > 1) { e.preventDefault(); history.back(); }
  });

  function nactiHistorii() {
    try { return JSON.parse(sessionStorage.getItem(KLIC) || '[]').filter(function (m) { return m && m.role && m.content; }); } catch (_e) { return []; }
  }
  function ulozHistorii(h) {
    try { sessionStorage.setItem(KLIC, JSON.stringify(h.slice(-20))); } catch (_e) {}
  }
  var historie = nactiHistorii();

  // Text z modelu se NIKDY nevkládá jako HTML. Odkazy se skládají z uzlů:
  // jen cesty na tomhle webu, e-mail a telefon studia.
  var ODKAZ = /(\/[a-z0-9\-]+\.html(?:#[a-zA-Z0-9\-]+)?|info@jogaskralicky\.cz|\+420 ?603 ?340 ?860)/g;
  function naplnText(el, text) {
    el.textContent = '';
    var casti = String(text).split(ODKAZ);
    for (var i = 0; i < casti.length; i++) {
      var c = casti[i];
      if (!c) continue;
      if (i % 2 === 1) {
        var a = document.createElement('a');
        if (c.charAt(0) === '/') a.href = c;
        else if (c.indexOf('@') > 0) a.href = 'mailto:' + c;
        else a.href = 'tel:' + c.replace(/\s/g, '');
        a.textContent = c;
        el.appendChild(a);
      } else {
        el.appendChild(document.createTextNode(c));
      }
    }
  }

  function nakonec() {
    // pole na psaní dole na obrazovce, poslední zpráva nad ním
    form.scrollIntoView({block: 'end'});
  }

  function bublina(text, kdo, tridy) {
    var m = document.createElement('div');
    m.className = 'as-m ' + kdo + (tridy ? ' ' + tridy : '');
    naplnText(m, text);
    log.appendChild(m);
    return m;
  }

  historie.forEach(function (m) { bublina(m.content, m.role === 'user' ? 'ja' : 'bot'); });
  if (historie.length) nakonec();
  else {
    RYCHLE.forEach(function (q) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = q;
      b.addEventListener('click', function () { posli(q); });
      chips.appendChild(b);
    });
  }

  function posli(text) {
    text = String(text || '').trim();
    if (!text || ceka) return;
    ceka = true;
    odeslat.disabled = true;
    chips.innerHTML = '';
    pole.value = '';
    pole.style.height = '';
    bublina(text, 'ja');
    historie.push({role: 'user', content: text.slice(0, 500)});
    ulozHistorii(historie);

    var tecky = document.createElement('div');
    tecky.className = 'as-m bot';
    tecky.setAttribute('aria-label', 'Asistent píše');
    tecky.innerHTML = '<span class="as-dots"><i></i><i></i><i></i></span>';
    log.appendChild(tecky);
    nakonec();

    fetch('/api/chat', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({zpravy: historie.slice(-10)})
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { return {ok: r.ok, d: d}; });
    }).then(function (v) {
      tecky.remove();
      if (v.ok && v.d.odpoved) {
        bublina(v.d.odpoved, 'bot');
        historie.push({role: 'assistant', content: v.d.odpoved});
      } else {
        bublina(v.d.chyba || 'Něco se pokazilo. Napište nám prosím na info@jogaskralicky.cz.', 'bot', 'chyba');
        historie.pop();   // nezodpovězený dotaz neposílat příště znovu
      }
      ulozHistorii(historie);
    }).catch(function () {
      tecky.remove();
      bublina('Nepodařilo se spojit. Zkontrolujte připojení, nebo nám napište na info@jogaskralicky.cz.', 'bot', 'chyba');
      historie.pop();
      ulozHistorii(historie);
    }).then(function () {
      ceka = false;
      odeslat.disabled = false;
      nakonec();
    });
  }

  form.addEventListener('submit', function (e) { e.preventDefault(); posli(pole.value); });
  pole.addEventListener('keydown', function (e) {
    // na počítači Enter odešle, Shift+Enter nový řádek; na telefonu Enter = nový řádek
    if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) { e.preventDefault(); posli(pole.value); }
  });
  pole.addEventListener('input', function () {
    pole.style.height = 'auto';
    pole.style.height = Math.min(pole.scrollHeight, 140) + 'px';
  });
  // na počítači rovnou psát; na telefonu klávesnici hned nevysouvat
  if (window.matchMedia('(pointer: fine)').matches) pole.focus({preventScroll: true});
})();
