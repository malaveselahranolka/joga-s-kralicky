// =====================================================================
//  Časová osa návodových videí
//
//  Všechno se počítá z času t, žádné CSS animace ani setTimeout. Recorder
//  pro každý snímek zavolá window.seek(t) a udělá screenshot, takže video
//  je plynulých 30 fps a pokaždé vyjde stejně.
//
//  seek(t): vrátí zaregistrované prvky do výchozího stavu a přehraje
//  všechny akce, které už začaly (hotové s p = 1, rozběhnuté s p < 1).
//  Scény se píšou jako scénář: kurzor `now` postupuje, jak přibývají kroky.
// =====================================================================
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const clamp = (x) => Math.max(0, Math.min(1, x));
  const lerp = (a, b, p) => a + (b - a) * p;
  const E = {
    inOut: (p) => (p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
    out: (p) => 1 - Math.pow(1 - p, 3),
    lin: (p) => p,
  };

  const acts = [];
  const snap = new Map();
  let dur = 0;

  function reg(el, html) {
    if (!el) throw new Error('reg: prvek neexistuje');
    const s = snap.get(el) || { css: el.style.cssText, cls: el.className, html: null };
    if (html && s.html === null) s.html = el.innerHTML;
    snap.set(el, s);
  }
  function at(t0, d, els, fn, ease = E.inOut, html = false) {
    els.forEach((e) => reg(e, html));
    acts.push({ t0, d, fn, ease });
    dur = Math.max(dur, t0 + d);
  }
  function seek(t) {
    for (const [el, s] of snap) {
      if (el.style.cssText !== s.css) el.style.cssText = s.css;
      if (el.className !== s.cls) el.className = s.cls;
      if (s.html !== null && el.innerHTML !== s.html) el.innerHTML = s.html;
    }
    for (const a of acts) {
      if (t < a.t0) continue;
      a.fn(a.d <= 0 ? 1 : a.ease(clamp((t - a.t0) / a.d)));
    }
  }

  // ---- režisér ------------------------------------------------------
  const D = {
    now: 0,
    E, $, lerp, at,
    wait(s) { this.now += s; return this; },
    set(el, fn) { at(this.now, 0, [el], () => fn(el)); return this; },
    text(el, txt) { at(this.now, 0, [el], () => { el.textContent = txt; }, E.lin, true); return this; },
    html(el, h) { at(this.now, 0, [el], () => { el.innerHTML = h; }, E.lin, true); return this; },
    cls(el, c, on = true) { at(this.now, 0, [el], () => el.classList.toggle(c, on)); return this; },

    // popisek kroku nahoře
    step(n, total, txt, sub) {
      const cap = $('.cap'), num = $('.cap .num'), t = $('.cap .txt'), bar = $('.progress i');
      const t0 = this.now;
      const w0 = this._bar || 0, w1 = n / total * 100; this._bar = w1;
      if (t0 > 0) at(t0, .22, [cap], (p) => { cap.style.opacity = 1 - p; cap.style.transform = `translateY(${-8 * p}px)`; });
      const t1 = t0 > 0 ? t0 + .22 : 0;
      at(t1, 0, [num], () => { num.textContent = n; }, E.lin, true);
      at(t1, 0, [t], () => { t.innerHTML = txt + (sub ? '<small>' + sub + '</small>' : ''); }, E.lin, true);
      at(t1, t0 > 0 ? .4 : 0, [cap], (p) => { cap.style.opacity = p; cap.style.transform = `translateY(${10 * (1 - p)}px)`; }, E.out);
      at(t0, .6, [bar], (p) => { bar.style.width = lerp(w0, w1, p) + '%'; });
      return this;
    },

    // přechod na jinou obrazovku (jako načtení stránky)
    cur: null,
    show(scr, how = 'slide') {
      const el = typeof scr === 'string' ? $(scr) : scr;
      const old = this.cur; this.cur = el;
      const d = .55, t0 = this.now;
      if (!old) { at(t0, 0, [el], () => { el.style.visibility = 'visible'; el.style.transform = 'none'; }); return this; }
      if (how === 'fade') {
        at(t0, d, [el], (p) => { el.style.visibility = 'visible'; el.style.transform = 'none'; el.style.opacity = p; });
      } else {
        at(t0, d, [el], (p) => { el.style.visibility = 'visible'; el.style.transform = `translateX(${(1 - p) * 100}%)`; el.style.boxShadow = '-20px 0 40px rgba(30,35,28,.12)'; });
        at(t0, d, [old], (p) => { old.style.transform = `translateX(${-28 * p}%)`; old.style.filter = `brightness(${1 - .1 * p})`; });
      }
      at(t0 + d, 0, [old], () => { old.style.visibility = 'hidden'; });
      const load = el.querySelector('.addr .load');
      if (load) at(t0, 1.0, [load], (p) => { load.style.width = p * 100 + '%'; load.style.opacity = p < .95 ? 1 : 1 - (p - .95) * 20; }, E.out);
      this.now += d;
      return this;
    },

    // posun obsahu obrazovky
    sy: new Map(),
    scroll(scr, y, d = 1.1) {
      const el = typeof scr === 'string' ? $(scr) : scr;
      const body = el.querySelector('.body');
      const y0 = this.sy.get(el) || 0; this.sy.set(el, y);
      at(this.now, d, [body], (p) => { body.style.transform = `translateY(${-lerp(y0, y, p)}px)`; });
      this.now += d;
      return this;
    },
    // posune tak, aby prvek byl ve svislé poloze `ratio` obrazovky
    scrollTo(el, ratio = .45, d = 1.1) {
      const scr = el.closest('.scr');
      this.measure();
      const sr = scr.getBoundingClientRect(), er = el.getBoundingClientRect();
      const y0 = this.sy.get(scr) || 0;
      const want = y0 + (er.top + er.height / 2) - (sr.top + sr.height * ratio);
      return this.scroll(scr, Math.max(0, Math.round(want)), d);
    },

    measure() { seek(this.now); },

    // prst
    fx: 300, fy: 1040, fingerOn: false,
    fingerIn() {
      const f = $('.finger');
      at(this.now, .4, [f], (p) => { f.style.opacity = p; });
      this.fingerOn = true;
      return this;
    },
    fingerOut() {
      const f = $('.finger');
      at(this.now, .4, [f], (p) => { f.style.opacity = 1 - p; });
      return this;
    },
    moveTo(el, d = .7, dx = 0, dy = 0) {
      this.measure();
      const r = el.getBoundingClientRect();
      const x1 = r.left + r.width / 2 + dx, y1 = r.top + r.height / 2 + dy;
      const x0 = this.fx, y0 = this.fy, f = $('.finger');
      // lehký oblouk, ať to nevypadá jako po pravítku
      const bow = Math.min(40, Math.hypot(x1 - x0, y1 - y0) * .12);
      at(this.now, d, [f], (p) => {
        f.style.left = lerp(x0, x1, p) + 'px';
        f.style.top = (lerp(y0, y1, p) - Math.sin(Math.PI * p) * bow) + 'px';
      });
      this.fx = x1; this.fy = y1; this.now += d;
      return this;
    },
    tap(el, opt = {}) {
      if (!opt.noMove) this.moveTo(el, opt.d || .7, opt.dx || 0, opt.dy || 0);
      const f = $('.finger'), rp = $('.ripple'), x = this.fx, y = this.fy, t0 = this.now;
      at(t0, .12, [f], (p) => { f.style.transform = `scale(${1 - .2 * p})`; });
      at(t0 + .12, .2, [f], (p) => { f.style.transform = `scale(${.8 + .2 * p})`; });
      at(t0 + .05, .55, [rp], (p) => {
        rp.style.left = x + 'px'; rp.style.top = y + 'px';
        rp.style.opacity = .8 * (1 - p); rp.style.transform = `scale(${.6 + 1.3 * p})`;
      }, E.out);
      const press = opt.press === undefined ? el : opt.press;
      if (press) at(t0, .3, [press], (p) => { press.style.transform = `scale(${1 - .045 * Math.sin(Math.PI * p)})`; });
      this.now += .35;
      return this;
    },

    // psaní do pole
    type(input, txt, cps = 13) {
      const v = input.querySelector('.v');
      at(this.now, 0, [input], () => input.classList.add('focus'));
      const d = txt.length / cps;
      at(this.now, d, [v], (p) => { v.textContent = txt.slice(0, Math.round(txt.length * p)); }, E.lin, true);
      this.now += d;
      return this;
    },
    blur(input) { at(this.now, 0, [input], () => input.classList.remove('focus')); return this; },

    // e-mailová notifikace sjede shora
    notify(el, d = .6) {
      at(this.now, d, [el], (p) => { el.style.transform = `translateY(${lerp(-160, 0, p)}px)`; }, E.out);
      this.now += d;
      return this;
    },
    hideNotify(el, d = .4) {
      at(this.now, d, [el], (p) => { el.style.transform = `translateY(${lerp(0, -160, p)}px)`; el.style.opacity = 1 - p; });
      return this;
    },

    fadeIn(el, d = .6) { at(this.now, d, [el], (p) => { el.style.opacity = p; }); this.now += d; return this; },
    fadeOut(el, d = .5) { at(this.now, d, [el], (p) => { el.style.opacity = 1 - p; }); this.now += d; return this; },

    endCard(d = .8) {
      const end = $('.end');
      const kids = [...end.children];
      at(this.now, d, [end], (p) => { end.style.opacity = p; });
      kids.forEach((k, i) => at(this.now + .2 + i * .12, .6, [k], (p) => { k.style.opacity = p; k.style.transform = `translateY(${16 * (1 - p)}px)`; }, E.out));
      this.now += d + kids.length * .12 + .6;
      return this;
    },
  };

  // Pseudo QR kód — wireframe, nic nekóduje. Skutečný QR v e-mailu vede
  // na stav rezervace konkrétního hosta, a ten do videa nepatří.
  function fakeQr(seed = 7) {
    const n = 25, c = 6;
    let s = seed;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    let r = '';
    const finder = (x, y) => r +=
      `<rect x="${x * c}" y="${y * c}" width="${7 * c}" height="${7 * c}" fill="#1E231C"/>` +
      `<rect x="${(x + 1) * c}" y="${(y + 1) * c}" width="${5 * c}" height="${5 * c}" fill="#fff"/>` +
      `<rect x="${(x + 2) * c}" y="${(y + 2) * c}" width="${3 * c}" height="${3 * c}" fill="#1E231C"/>`;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const inF = (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
      if (!inF && rnd() > .52) r += `<rect x="${x * c}" y="${y * c}" width="${c}" height="${c}" fill="#1E231C"/>`;
    }
    finder(0, 0); finder(n - 7, 0); finder(0, n - 7);
    const m = 4 * c, w = n * c + 2 * m;
    return `<svg viewBox="${-m} ${-m} ${w} ${w}" xmlns="http://www.w3.org/2000/svg">${r}</svg>`;
  }

  window.NAVOD = { D, fakeQr, $ };
  window.seek = seek;
  window.duration = () => dur;
})();
