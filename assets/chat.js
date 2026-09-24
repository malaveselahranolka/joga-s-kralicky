// =====================================================================
//  CHAT — bublina, která otevře stránku s AI asistentem (/asistent.html)
//
//  Dřív se chat otevíral jako okno přes stránku. Na telefonu s klávesnicí
//  se ale pořád něco posouvalo a propadalo, tak je chat teď samostatná
//  stránka: bublina je obyčejný odkaz, křížek na asistent.html vrátí
//  prohlížeč zpět na stejné místo. Tenhle skript jen vykreslí bublinu.
//
//  Výkon: `defer`, žádné okno ani historie se tu nestaví. Stránku chatu
//  si prohlížeč přednačte, až se k bublině přiblíží prst nebo myš.
// =====================================================================
(function () {
  if (window.__jskChat) return;
  window.__jskChat = true;

  var STYL = [
    '.jsk-chat-btn{position:fixed;right:max(1rem,env(safe-area-inset-right));bottom:max(1rem,env(safe-area-inset-bottom));z-index:800;',
    '  display:inline-flex;align-items:center;gap:.55rem;height:56px;min-width:56px;padding:0 1.15rem 0 1rem;border-radius:999px;text-decoration:none;',
    '  background:var(--forest,#2C3B2E);color:var(--cream,#F7F4EC);font:600 .95rem/1 "Hanken Grotesk",system-ui,sans-serif;',
    '  -webkit-tap-highlight-color:transparent;touch-action:manipulation;',
    '  box-shadow:0 0 0 2px rgba(247,244,236,.9),0 10px 26px -10px rgba(20,28,20,.6),0 2px 6px rgba(20,28,20,.18);transition:transform .2s cubic-bezier(.23,1,.32,1),opacity .2s}',
    '.jsk-chat-btn:hover{transform:translateY(-2px)}',
    '.jsk-chat-btn:active{transform:scale(.96)}',
    '.jsk-chat-btn:focus-visible{outline:2px solid var(--clover,#6E8A4E);outline-offset:3px}',
    '.jsk-chat-btn svg{width:24px;height:24px;flex:none}',
    '@media (max-width:640px){.jsk-chat-btn{padding:0;width:56px;justify-content:center}.jsk-chat-btn .t{display:none}}',
    // lišta souhlasu s měřením sedí taky dole — dokud je vidět, bublina se schová
    'body:has(.jsk-souhlas.je-videt) .jsk-chat-btn{opacity:0;pointer-events:none}',
    '@media (prefers-reduced-motion:reduce){.jsk-chat-btn{transition:none}}',
    // Plynulý přechod na stránku chatu a zpět (View Transitions mezi
    // stránkami). Sem se vždycky vrací jen z chatu — ostatní přechody
    // mezi stránkami se níž v „pageswap" ruší — takže tu stačí popsat
    // zavírání: chat sjede dolů a pod ním zůstane stránka, kde host byl.
    // Otevírání popisuje asistent.html. Prohlížeč, který to neumí, prostě
    // přejde bez animace jako dřív.
    '@media (prefers-reduced-motion:no-preference){',
    '  @view-transition{navigation:auto}',
    '  ::view-transition-new(root){animation:none}',
    '  ::view-transition-old(root){z-index:1;animation:jskChatVen .28s cubic-bezier(.4,0,.9,.6) both}',
    '}',
    '@keyframes jskChatVen{to{opacity:0;transform:translateY(64px)}}'
  ].join('\n');

  var styl = document.createElement('style');
  styl.textContent = STYL;
  document.head.appendChild(styl);

  var a = document.createElement('a');
  a.className = 'jsk-chat-btn';
  // ?z= = kam se vrátit, kdyby „zpět“ v prohlížeči nešlo (nová karta apod.)
  a.href = '/asistent.html?z=' + encodeURIComponent(location.pathname);
  a.setAttribute('aria-label', 'Otevřít AI asistenta');
  a.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5z"/><path d="M8.5 9.5h.01M12 9.5h.01M15.5 9.5h.01"/></svg><span class="t">Máte otázku?</span>';
  document.body.appendChild(a);

  // Animovat jen cestu do chatu. Bez tohohle by se kvůli @view-transition
  // prolínaly i všechny ostatní přechody mezi stránkami, které chat mají.
  window.addEventListener('pageswap', function (e) {
    if (!e.viewTransition) return;
    var cil = '';
    try { cil = new URL(e.activation.entry.url).pathname; } catch (_e) {}
    if (cil !== '/asistent.html' && cil !== '/asistent') e.viewTransition.skipTransition();
  });

  var prednacteno = false;
  function prednacti() {
    if (prednacteno) return;
    prednacteno = true;
    var l = document.createElement('link');
    l.rel = 'prefetch';
    l.href = '/asistent.html';
    document.head.appendChild(l);
  }
  a.addEventListener('pointerenter', prednacti, {passive: true});
  a.addEventListener('touchstart', prednacti, {passive: true});
  a.addEventListener('focus', prednacti);
  a.addEventListener('click', function () {
    try { if (typeof window.jskUdalost === 'function') window.jskUdalost('chat_otevren'); } catch (_e) {}
  });
})();
