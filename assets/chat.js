// =====================================================================
//  CHAT — AI asistent (odpovídá /api/chat)
//
//  Stavěné hlavně pro telefon: 80–90 % návštěv přichází z reklam na
//  Instagramu a Facebooku. Na telefonu je chat OVERLAY přes celou
//  obrazovku, který se rozbalí z bubliny; na počítači okénko vpravo dole.
//
//  Co se naučilo z provozu (proč je to postavené takhle):
//   * Stránka pod chatem se NESMÍ přesouvat. Dřívější zamykání přes
//     body { position: fixed } stránku pod chatem posunulo nahoru
//     a tápnutí pak propadalo na jiné prvky. Teď se stránka jen zmrazí
//     (overflow: hidden) a zůstane přesně tam, kde byla.
//   * Tah prstem v overlayi nesmí rolovat stránku pod ním — pohyb se
//     pustí jen uvnitř seznamu zpráv, a jen když má kam rolovat.
//   * Klávesnice: na Androidu viewport meta `interactive-widget=
//     resizes-content` zmenší rozvržení a overlay se přizpůsobí sám.
//     iPhone rozvržení nezmenší, jen posune viditelnou plochu —
//     overlay proto kopíruje visualViewport (výšku i posun).
//
//  Výkon: skript je `defer` a při načtení vytvoří jen bublinu.
//  Soukromí: konverzace žije jen v sessionStorage této karty.
// =====================================================================
(function () {
  if (window.__jskChat) return;
  window.__jskChat = true;

  var KLIC = 'jsk-chat-v1';
  var RYCHLE = [
    'Kdy je nejbližší lekce?',
    'Co si mám vzít s sebou?',
    'Jak funguje dárkový poukaz?',
    'Jak se k vám dostanu?'
  ];
  var UVOD = 'Dobrý den! Jsem AI asistent Jógy s králíčky. Zeptejte se na lekce, dárkový poukaz nebo cestu k nám. Na složitější věci vám rádi odpovíme osobně na info@jogaskralicky.cz.';

  var STYL = [
    // ---- bublina ----
    '.jsk-chat-btn{position:fixed;right:max(1rem,env(safe-area-inset-right));bottom:max(1rem,env(safe-area-inset-bottom));z-index:800;',
    '  display:inline-flex;align-items:center;gap:.55rem;height:56px;min-width:56px;padding:0 1.15rem 0 1rem;border:0;border-radius:999px;cursor:pointer;',
    '  background:var(--forest,#2C3B2E);color:var(--cream,#F7F4EC);font:600 .95rem/1 "Hanken Grotesk",system-ui,sans-serif;',
    '  -webkit-tap-highlight-color:transparent;touch-action:manipulation;',
    '  box-shadow:0 0 0 2px rgba(247,244,236,.9),0 10px 26px -10px rgba(20,28,20,.6),0 2px 6px rgba(20,28,20,.18);transition:transform .2s cubic-bezier(.23,1,.32,1),opacity .2s}',
    '.jsk-chat-btn:hover{transform:translateY(-2px)}',
    '.jsk-chat-btn:active{transform:scale(.96)}',
    '.jsk-chat-btn:focus-visible{outline:2px solid var(--clover,#6E8A4E);outline-offset:3px}',
    '.jsk-chat-btn svg{width:24px;height:24px;flex:none}',
    '@media (max-width:640px){.jsk-chat-btn{padding:0;width:56px;justify-content:center}.jsk-chat-btn .t{display:none}}',
    'body:has(.jsk-souhlas.je-videt) .jsk-chat-btn{opacity:0;pointer-events:none}',
    'html.jsk-chat-open .jsk-chat-btn{visibility:hidden}',
    // stránka pod chatem zamrzne na místě (žádné position: fixed = žádný posun)
    'html.jsk-chat-lock,html.jsk-chat-lock body{overflow:hidden!important;overscroll-behavior:none}',

    // ---- okno / overlay ----
    '.jsk-chat{position:fixed;z-index:950;right:1rem;bottom:1rem;width:min(400px,calc(100vw - 2rem));height:min(620px,calc(100vh - 2rem));',
    '  display:flex;flex-direction:column;background:var(--paper,#F1EEE5);color:var(--ink,#1E231C);border-radius:24px;overflow:hidden;',
    '  box-shadow:0 30px 70px -20px rgba(20,28,20,.55),0 0 0 1px rgba(30,41,32,.08);font-family:"Hanken Grotesk",system-ui,sans-serif;',
    '  opacity:0;transform:translateY(12px) scale(.97);transform-origin:bottom right;transition:opacity .2s,transform .26s cubic-bezier(.23,1,.32,1)}',
    '.jsk-chat.open{opacity:1;transform:none}',
    '.jsk-chat[hidden]{display:none}',
    // Telefon: overlay přes celou obrazovku, rozbalí se kruhem z bubliny.
    '@media (max-width:640px){',
    '  .jsk-chat{top:0;left:0;right:auto;bottom:auto;width:100%;height:var(--jsk-h,100%);border-radius:0;box-shadow:none;',
    '    transform:translateY(var(--jsk-top,0px));opacity:1;overscroll-behavior:contain;',
    '    clip-path:circle(28px at calc(100% - 44px) calc(100% - 44px));transition:clip-path .38s cubic-bezier(.65,0,.35,1)}',
    '  .jsk-chat.open{transform:translateY(var(--jsk-top,0px));clip-path:circle(150% at calc(100% - 44px) calc(100% - 44px))}',
    '}',

    // ---- hlavička: jen logo, název a zavřít ----
    '.jsk-chat-head{display:flex;align-items:center;gap:.65rem;padding:.7rem .5rem .7rem 1rem;border-bottom:1px solid var(--line,#E3DFD3);background:var(--paper,#F1EEE5);',
    '  padding-top:max(.7rem,env(safe-area-inset-top))}',
    '.jsk-chat-head img{width:32px;height:32px;flex:none}',
    '.jsk-chat-head b{font-family:"Schibsted Grotesk",system-ui,sans-serif;font-size:1.05rem;font-weight:600;letter-spacing:-.01em}',
    '.jsk-chat-x{margin-left:auto;width:44px;height:44px;border:0;border-radius:999px;background:transparent;color:var(--ink,#1E231C);cursor:pointer;display:grid;place-items:center;-webkit-tap-highlight-color:transparent}',
    '.jsk-chat-x:hover{background:rgba(30,41,32,.07)}',
    '.jsk-chat-x:focus-visible{outline:2px solid var(--clover,#6E8A4E);outline-offset:-2px}',

    // ---- zprávy ----
    '.jsk-chat-log{flex:1;min-height:0;overflow-y:auto;padding:1rem;display:flex;flex-direction:column;gap:.6rem;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}',
    '.jsk-m{max-width:86%;padding:.65rem .9rem;border-radius:18px;font-size:1rem;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}',
    '.jsk-m.bot{align-self:flex-start;background:#fff;border:1px solid var(--line,#E3DFD3);border-bottom-left-radius:6px}',
    '.jsk-m.ja{align-self:flex-end;background:var(--forest,#2C3B2E);color:var(--cream,#F7F4EC);border-bottom-right-radius:6px}',
    '.jsk-m.chyba{background:#FBF1E8;border-color:#EBCFB6}',
    '.jsk-m a{color:var(--forest,#2C3B2E);text-decoration:underline;text-underline-offset:2px;font-weight:600}',
    '.jsk-dots{display:inline-flex;gap:4px;padding:.2rem 0}',
    '.jsk-dots i{width:7px;height:7px;border-radius:50%;background:var(--clover,#6E8A4E);animation:jskDot 1.1s infinite ease-in-out}',
    '.jsk-dots i:nth-child(2){animation-delay:.15s}.jsk-dots i:nth-child(3){animation-delay:.3s}',
    '@keyframes jskDot{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}',
    '.jsk-chips{display:flex;flex-wrap:wrap;gap:.45rem;padding:0 1rem .6rem}',
    '.jsk-chips:empty{display:none}',
    '.jsk-chips button{min-height:40px;padding:.45rem .9rem;border-radius:999px;border:1px solid var(--line,#E3DFD3);background:#fff;color:var(--ink,#1E231C);',
    '  font:500 .9rem/1.2 "Hanken Grotesk",system-ui,sans-serif;cursor:pointer;touch-action:manipulation}',
    '.jsk-chips button:hover{border-color:var(--forest,#2C3B2E)}',

    // ---- psaní ----
    '.jsk-chat-form{display:flex;gap:.5rem;align-items:flex-end;padding:.7rem .8rem .35rem;border-top:1px solid var(--line,#E3DFD3);background:var(--cream,#F7F4EC)}',
    // 16 px = iPhone po klepnutí do pole nezoomuje
    '.jsk-chat-form textarea{flex:1;min-height:44px;max-height:120px;resize:none;padding:.65rem .9rem;border:1px solid var(--line,#E3DFD3);border-radius:22px;',
    '  background:#fff;color:var(--ink,#1E231C);font:16px/1.4 "Hanken Grotesk",system-ui,sans-serif}',
    '.jsk-chat-form textarea:focus{outline:none;border-color:var(--clover,#6E8A4E);box-shadow:0 0 0 3px rgba(110,138,78,.25)}',
    '.jsk-chat-form button{width:44px;height:44px;flex:none;border:0;border-radius:50%;background:var(--forest,#2C3B2E);color:var(--cream,#F7F4EC);cursor:pointer;display:grid;place-items:center;touch-action:manipulation}',
    '.jsk-chat-form button:disabled{opacity:.45;cursor:default}',
    '.jsk-chat-form button:focus-visible{outline:2px solid var(--clover,#6E8A4E);outline-offset:2px}',
    '.jsk-chat-note{margin:0;padding:.2rem 1rem .7rem;font-size:.76rem;line-height:1.4;color:var(--ink-soft,#5C6357);background:var(--cream,#F7F4EC);',
    '  padding-bottom:max(.7rem,env(safe-area-inset-bottom))}',
    '.jsk-chat-note a{color:inherit;text-decoration:underline}',
    '@media (prefers-reduced-motion:reduce){.jsk-chat,.jsk-chat-btn{transition:none!important}.jsk-dots i{animation:none;opacity:.6}}'
  ].join('\n');

  var IKONA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5z"/><path d="M8.5 9.5h.01M12 9.5h.01M15.5 9.5h.01"/></svg>';

  var mobil = function () { return window.matchMedia('(max-width: 640px)').matches; };
  var html = document.documentElement;

  function udalost(nazev) {
    try { if (typeof window.jskUdalost === 'function') window.jskUdalost(nazev); } catch (_e) {}
  }
  function nactiHistorii() {
    try { return JSON.parse(sessionStorage.getItem(KLIC) || '[]').filter(function (z) { return z && z.role && z.content; }); } catch (_e) { return []; }
  }
  function ulozHistorii(h) {
    try { sessionStorage.setItem(KLIC, JSON.stringify(h.slice(-20))); } catch (_e) {}
  }

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

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'jsk-chat-btn';
  btn.setAttribute('aria-label', 'Otevřít AI asistenta');
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = IKONA + '<span class="t">Máte otázku?</span>';

  var styl = document.createElement('style');
  styl.textContent = STYL;
  document.head.appendChild(styl);
  document.body.appendChild(btn);

  var panel, log, pole, odeslat, chips, historie = nactiHistorii(), ceka = false, zaviraniCasovac = null;

  // ---- telefon: overlay kopíruje viditelnou plochu (klávesnice na iPhonu) ----
  function prizpusob() {
    if (!panel || panel.hidden) return;
    var vv = window.visualViewport;
    if (!mobil() || !vv) {
      panel.style.removeProperty('--jsk-h');
      panel.style.removeProperty('--jsk-top');
      return;
    }
    panel.style.setProperty('--jsk-h', vv.height + 'px');
    panel.style.setProperty('--jsk-top', Math.max(0, vv.offsetTop) + 'px');
    if (document.activeElement === pole) log.scrollTop = log.scrollHeight;
  }

  // Tah prstem v overlayi nerolluje stránku pod ním. Pustí se jen uvnitř
  // seznamu zpráv (a v poli na psaní), a jen když je tam co rolovat.
  var startY = 0;
  function dotykStart(e) { startY = e.touches[0].clientY; }
  function dotykPohyb(e) {
    var el = e.target.closest ? e.target.closest('.jsk-chat-log, textarea') : null;
    if (!el) { e.preventDefault(); return; }
    var dolu = e.touches[0].clientY < startY;
    var naKonci = dolu ? el.scrollTop + el.clientHeight >= el.scrollHeight - 1 : el.scrollTop <= 0;
    if (el.scrollHeight <= el.clientHeight || naKonci) e.preventDefault();
  }

  function bublina(text, kdo, tridy) {
    var m = document.createElement('div');
    m.className = 'jsk-m ' + kdo + (tridy ? ' ' + tridy : '');
    naplnText(m, text);
    log.appendChild(m);
    log.scrollTop = log.scrollHeight;
    return m;
  }

  function postav() {
    panel = document.createElement('div');
    panel.className = 'jsk-chat';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'jskChatTitul');
    panel.innerHTML =
      '<div class="jsk-chat-head">' +
        '<img src="/assets/logo.svg" alt="" width="32" height="32" />' +
        '<b id="jskChatTitul">AI asistent</b>' +
        '<button type="button" class="jsk-chat-x" aria-label="Zavřít"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>' +
      '</div>' +
      '<div class="jsk-chat-log" role="log" aria-live="polite"></div>' +
      '<div class="jsk-chips"></div>' +
      '<form class="jsk-chat-form">' +
        '<textarea rows="1" maxlength="500" placeholder="Napište dotaz…" aria-label="Váš dotaz" enterkeyhint="send"></textarea>' +
        '<button type="submit" aria-label="Odeslat"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>' +
      '</form>' +
      '<p class="jsk-chat-note">Odpovídá AI, může se splést. Nepište sem osobní ani zdravotní údaje, zprávy neukládáme. <a href="/zasady-osobnich-udaju.html">Osobní údaje</a></p>';
    document.body.appendChild(panel);

    log = panel.querySelector('.jsk-chat-log');
    chips = panel.querySelector('.jsk-chips');
    pole = panel.querySelector('textarea');
    odeslat = panel.querySelector('.jsk-chat-form button');

    bublina(UVOD, 'bot');
    historie.forEach(function (z) { bublina(z.content, z.role === 'user' ? 'ja' : 'bot'); });
    if (!historie.length) {
      RYCHLE.forEach(function (q) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = q;
        b.addEventListener('click', function () { posli(q); });
        chips.appendChild(b);
      });
    }

    panel.querySelector('.jsk-chat-x').addEventListener('click', function () { zavri(true); });
    panel.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { zavri(true); return; }
      if (e.key !== 'Tab') return;
      var prvky = panel.querySelectorAll('button, textarea, a[href]');
      var prvni = prvky[0], posledni = prvky[prvky.length - 1];
      if (e.shiftKey && document.activeElement === prvni) { e.preventDefault(); posledni.focus(); }
      else if (!e.shiftKey && document.activeElement === posledni) { e.preventDefault(); prvni.focus(); }
    });
    panel.addEventListener('touchstart', dotykStart, {passive: true});
    panel.addEventListener('touchmove', dotykPohyb, {passive: false});
    panel.querySelector('form').addEventListener('submit', function (e) { e.preventDefault(); posli(pole.value); });
    pole.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) { e.preventDefault(); posli(pole.value); }
    });
    pole.addEventListener('input', function () {
      pole.style.height = 'auto';
      pole.style.height = Math.min(pole.scrollHeight, 120) + 'px';
    });
    pole.addEventListener('focus', function () { prizpusob(); setTimeout(prizpusob, 150); setTimeout(prizpusob, 400); });
    pole.addEventListener('blur', function () { setTimeout(prizpusob, 150); });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', prizpusob);
      window.visualViewport.addEventListener('scroll', prizpusob);
    }
  }

  function otevri() {
    if (!panel) postav();
    clearTimeout(zaviraniCasovac);
    if (mobil()) html.classList.add('jsk-chat-lock');
    html.classList.add('jsk-chat-open');
    panel.hidden = false;
    prizpusob();
    // o snímek později, ať se rozbalení z bubliny opravdu přehraje
    requestAnimationFrame(function () { requestAnimationFrame(function () { panel.classList.add('open'); }); });
    btn.setAttribute('aria-expanded', 'true');
    // na telefonu klávesnici hned nevyskakovat — nejdřív ať člověk vidí rychlé otázky
    if (window.matchMedia('(pointer: fine)').matches) pole.focus({preventScroll: true});
    else panel.querySelector('.jsk-chat-x').focus({preventScroll: true});
    udalost('chat_otevren');
  }

  function zavri(vratitFokus) {
    if (!panel || panel.hidden) return;
    if (document.activeElement && panel.contains(document.activeElement)) document.activeElement.blur();
    panel.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
    var dobeh = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 380;
    zaviraniCasovac = setTimeout(function () {
      panel.hidden = true;
      html.classList.remove('jsk-chat-lock', 'jsk-chat-open');
      panel.style.removeProperty('--jsk-h');
      panel.style.removeProperty('--jsk-top');
      if (vratitFokus) btn.focus({preventScroll: true});
    }, dobeh);
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
    udalost('chat_dotaz');

    var tecky = document.createElement('div');
    tecky.className = 'jsk-m bot';
    tecky.setAttribute('aria-label', 'Asistent píše');
    tecky.innerHTML = '<span class="jsk-dots"><i></i><i></i><i></i></span>';
    log.appendChild(tecky);
    log.scrollTop = log.scrollHeight;

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
    });
  }

  btn.addEventListener('click', otevri);
})();
