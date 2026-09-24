// Společné chování podstránek (poukaz, skupinové lekce, O nás):
// menu, hlavička při scrollu, postupné odhalování sekcí, FAQ a poptávka.
// Kopíruje chování z index.html, jen bez galerie, parallaxu a newsletteru.
(function () {
  // ============ HLAVIČKA A MENU ============
  const nav = document.getElementById('nav');
  const onScroll = () => nav && nav.classList.toggle('scrolled', window.scrollY > 40);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  const toggle = document.getElementById('menuToggle');
  const links = document.getElementById('navLinks');
  const backdrop = document.getElementById('navBackdrop');
  function setMenu(open, returnFocus) {
    nav.classList.toggle('open', open);
    links.classList.toggle('open', open);
    backdrop.classList.toggle('open', open);
    document.body.style.overflow = open ? 'hidden' : '';
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Zavřít menu' : 'Otevřít menu');
    links.inert = !open;
    if (open) {
      const first = links.querySelector('a');
      if (first) first.focus();
    } else if (returnFocus) {
      toggle.focus();
    }
  }
  if (toggle && links && backdrop) {
    links.inert = true;
    toggle.addEventListener('click', () => setMenu(!nav.classList.contains('open'), true));
    backdrop.addEventListener('click', () => setMenu(false, true));
    links.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setMenu(false, false)));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav.classList.contains('open')) setMenu(false, true); });
  }

  // ============ ODHALOVÁNÍ SEKCÍ ============
  const items = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const groups = new Map();
    items.forEach((el) => {
      const i = groups.get(el.parentElement) || 0;
      groups.set(el.parentElement, i + 1);
      if (i > 0) el.style.setProperty('--rv-d', Math.min(i * 0.09, 0.45) + 's');
    });
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    items.forEach((el) => io.observe(el));
  } else {
    items.forEach((el) => el.classList.add('in'));
  }

  // ============ FAQ — vždy jen jedna otevřená ============
  document.querySelectorAll('.faq-list').forEach((list) => {
    list.querySelectorAll('.faq-q').forEach((q) => {
      q.addEventListener('click', () => {
        const item = q.closest('.faq-item');
        const willOpen = !item.classList.contains('open');
        list.querySelectorAll('.faq-item.open').forEach((other) => {
          other.classList.remove('open');
          other.querySelector('.faq-q').setAttribute('aria-expanded', 'false');
        });
        item.classList.toggle('open', willOpen);
        q.setAttribute('aria-expanded', String(willOpen));
      });
    });
  });

  // ============ POPTÁVKA SKUPINOVÉ LEKCE ============
  // Web nemá server na posílání poptávek a přidávat ho kvůli jednomu
  // formuláři nechceme. Formulář proto složí hotový e-mail a otevře ho
  // v poštovním programu návštěvníka — nic se neukládá ani neodesílá
  // za jeho zády. Kdo poštu v prohlížeči nemá, vidí adresu hned vedle.
  const form = document.getElementById('poptavkaForm');
  if (form) {
    const msg = document.getElementById('poptavkaMsg');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = (name) => (form.elements[name] && form.elements[name].value || '').trim();
      if (!val('jmeno') || !val('email')) {
        msg.textContent = 'Vyplňte prosím jméno a e-mail, ať máme kam odpovědět.';
        msg.classList.add('err');
        return;
      }
      msg.classList.remove('err');
      const radky = [
        'Dobrý den,',
        '',
        'měl(a) bych zájem o skupinovou lekci jógy s králíčky.',
        '',
        'Příležitost: ' + (val('typ') || '—'),
        'Počet lidí: ' + (val('pocet') || '—'),
        'Termín, který by se nám hodil: ' + (val('termin') || '—'),
        '',
        val('zprava'),
        '',
        val('jmeno'),
        val('email'),
        val('telefon'),
      ].filter((r, i, a) => !(r === '' && a[i - 1] === ''));
      const predmet = 'Skupinová lekce — ' + (val('typ') || 'poptávka');
      const adresa = form.getAttribute('data-to');
      window.location.href = 'mailto:' + adresa
        + '?subject=' + encodeURIComponent(predmet)
        + '&body=' + encodeURIComponent(radky.join('\n'));
      msg.textContent = 'Otevírá se váš e-mail s připravenou zprávou. Stačí ji odeslat.';
    });
  }
})();
