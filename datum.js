// =====================================================================
//  Čas lekcí — VŽDYCKY v pražském pásmu, nikdy v pásmu návštěvníka
//
//  PROČ TENHLE SOUBOR EXISTUJE
//  Stránky si čas formátovaly přes new Date(...).getHours(), což vrací
//  hodinu podle nastavení POČÍTAČE NÁVŠTĚVNÍKA. Host s telefonem přepnutým
//  na jiné pásmo — na dovolené, po přeletu, nebo prostě se špatně
//  nastavenými hodinami — tak viděl na webu jiný čas, než kdy lekce
//  opravdu začíná. Změřeno: prohlížeč v pásmu Europe/London ukazoval
//  „09:30 – 10:30" u lekce, která začíná v 10:30 pražského času.
//
//  Server přitom potvrzovací e-mail formátuje tvrdě v Europe/Prague
//  (supabase/functions/_shared/email.ts), takže hostovi chodily dva různé
//  časy pro tutéž rezervaci.
//
//  Lekce se koná ve studiu v Ostravě. Její čas je tedy pražský bez ohledu
//  na to, odkud se na web někdo dívá — a tenhle soubor je jediné místo,
//  kde se to na webu převádí.
//
//  POUŽITÍ
//    CAS.cas(x)        → "10:30"
//    CAS.datum(x)      → "05. 09. 2026"
//    CAS.denVTydnu(x)  → "sobota"
//    CAS.klicDne(x)    → "2026-09-05"   (seskupování termínů podle dne)
//    CAS.proInputDate(x) / CAS.proInputTime(x)   (formuláře v adminu)
//    CAS.zPrahyNaISO('2026-09-05', '10:30') → ISO v UTC
//
//  Vstupem může být ISO řetězec i Date. Neplatný vstup vrátí prázdno,
//  ne „NaN" nebo „Invalid Date" — ať se rozbitý údaj nedostane hostovi
//  před oči.
// =====================================================================
(function () {
  var TZ = 'Europe/Prague';

  function naDate(x) {
    var d = (x instanceof Date) ? x : new Date(x);
    return isNaN(d.getTime()) ? null : d;
  }

  // Rozloží okamžik na složky tak, jak je vidí Praha.
  // Intl je jediná cesta, jak to udělat správně i přes přechod na letní čas.
  var fmtCasti = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  });

  function casti(x) {
    var d = naDate(x);
    if (!d) return null;
    var out = {};
    fmtCasti.formatToParts(d).forEach(function (p) { out[p.type] = p.value; });
    // Půlnoc hlásí část prohlížečů jako 24, ne 00.
    if (out.hour === '24') out.hour = '00';
    return {
      rok: Number(out.year), mesic: Number(out.month), den: Number(out.day),
      hodina: Number(out.hour), minuta: Number(out.minute)
    };
  }

  var dva = function (n) { return String(n).padStart(2, '0'); };

  var fmtDen = new Intl.DateTimeFormat('cs-CZ', { timeZone: TZ, weekday: 'long' });

  var CAS = {
    TZ: TZ,
    casti: casti,

    cas: function (x) {
      var c = casti(x);
      return c ? dva(c.hodina) + ':' + dva(c.minuta) : '';
    },

    datum: function (x) {
      var c = casti(x);
      return c ? dva(c.den) + '. ' + dva(c.mesic) + '. ' + c.rok : '';
    },

    denVTydnu: function (x) {
      var d = naDate(x);
      return d ? fmtDen.format(d) : '';
    },

    // Klíč pro seskupení termínů do dnů. Musí být pražský, jinak by se
    // lekce pozdě večer mohla návštěvníkovi z jiného pásma zařadit
    // pod následující den.
    klicDne: function (x) {
      var c = casti(x);
      return c ? c.rok + '-' + dva(c.mesic) + '-' + dva(c.den) : '';
    },

    proInputDate: function (x) {
      var c = casti(x);
      return c ? c.rok + '-' + dva(c.mesic) + '-' + dva(c.den) : '';
    },

    proInputTime: function (x) {
      var c = casti(x);
      return c ? dva(c.hodina) + ':' + dva(c.minuta) : '';
    },

    // Konec lekce = začátek + délka. Vrací Date, ať se dá poslat zpátky sem.
    konec: function (x, minut) {
      var d = naDate(x);
      if (!d) return null;
      return new Date(d.getTime() + (Number(minut) || 60) * 60000);
    },

    // '2026-09-05' + '10:30' zadané jako PRAŽSKÝ čas → ISO v UTC.
    //
    // Postup: začneme s odhadem, zeptáme se, jak ten okamžik vypadá
    // v Praze, a o rozdíl posuneme. Druhý průchod dorovná i případ,
    // kdy odhad spadl na druhou stranu přechodu letního času.
    zPrahyNaISO: function (datumStr, casStr) {
      var dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(datumStr || ''));
      var tm = /^(\d{1,2}):(\d{2})$/.exec(String(casStr || ''));
      if (!dm || !tm) return null;
      var y = +dm[1], mo = +dm[2], d = +dm[3], hh = +tm[1], mi = +tm[2];
      if (hh > 23 || mi > 59 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;

      var cil = Date.UTC(y, mo - 1, d, hh, mi);
      var ts = cil;
      for (var i = 0; i < 3; i++) {
        var c = casti(new Date(ts));
        if (!c) return null;
        var vidime = Date.UTC(c.rok, c.mesic - 1, c.den, c.hodina, c.minuta);
        var rozdil = cil - vidime;
        if (rozdil === 0) break;
        ts += rozdil;
      }
      return new Date(ts).toISOString();
    }
  };

  window.CAS = CAS;
})();
