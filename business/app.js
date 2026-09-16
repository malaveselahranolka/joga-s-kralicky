import { mapCsvRows, inferMapping, parseCsv, SIGN_CONVENTIONS } from './csv.js';
import { monthPeriod, parseMoneyToMinor, pragueDate, pragueToday } from './domain.js';
import { createBusinessStore } from './data.js';
import { renderView, viewMeta } from './ui.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const countLabel = (value, one, few, other) => `${value} ${{ one, few, other }[new Intl.PluralRules('cs-CZ').select(value)] || other}`;
const localHost = ['localhost', '127.0.0.1'].includes(location.hostname);
const params = new URLSearchParams(location.search);
const demo = params.get('demo') === '1' && localHost;
const configured = /^https:\/\/.+\.supabase\.co$/.test(window.SUPABASE_URL || '')
  && Boolean(window.SUPABASE_ANON_KEY) && window.SUPABASE_ANON_KEY.length > 20
  && typeof window.supabase !== 'undefined';
const client = configured ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY) : null;
const store = createBusinessStore({ client, demo });

let period = periodFromUrl() || monthPeriod();
let currentData = null;
let importRows = [];
let toastTimer;
let chartMetric = 'result';
let pendingCostDelete = null;
let costDeleteTrigger = null;
let costDeleteCompleted = false;

function periodFromUrl() {
  const liveParams = new URLSearchParams(location.search);
  const from = liveParams.get('from'), to = liveParams.get('to');
  return /^\d{4}-\d{2}-\d{2}$/.test(from || '') && /^\d{4}-\d{2}-\d{2}$/.test(to || '') && from <= to ? { from, to } : null;
}

function currentView() {
  const view = new URLSearchParams(location.search).get('view') || 'overview';
  return viewMeta[view] ? view : 'overview';
}

// Popisek ukazuje období, které se opravdu počítalo. Když ho datum zahájení
// oříznulo, je to vidět hned pod nadpisem, ne až v poznámce uprostřed stránky.
function labelPeriod() {
  const formatter = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' });
  const den = (value) => formatter.format(new Date(`${value}T12:00:00`));
  const effective = effectivePeriod();
  if (effective.empty) return `${den(period.from)} – ${den(period.to)} · celé před zahájením provozu`;
  const base = `${den(effective.from)} – ${den(effective.to)}`;
  return effective.clamped ? `${base} · zkráceno zahájením provozu` : base;
}

// Ořezané období, jak ho vrátil store. Než se data načtou, platí zvolené.
function effectivePeriod() {
  const loaded = currentData?.period;
  return loaded && loaded.to === period.to && loaded.requestedFrom === period.from
    ? loaded
    : { from: period.from, to: period.to, requestedFrom: period.from, clamped: false, empty: false };
}

function setUrl(patch, replace = false) {
  const url = new URL(location.href);
  Object.entries(patch).forEach(([key, value]) => value == null ? url.searchParams.delete(key) : url.searchParams.set(key, value));
  if (demo) url.searchParams.set('demo', '1');
  history[replace ? 'replaceState' : 'pushState']({}, '', url);
}

function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').classList.add('show');
  toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 3000);
}

function syncErrorMessage(error) {
  const message = String(error?.message || error || '');
  if (message.startsWith('missing_secret:')) return 'Zdroj čeká na bezpečné připojení účtu.';
  if (message === 'provider_sync_failed') return 'Zdroj synchronizaci odmítl. Zkontrolujte přístup a zkuste to znovu.';
  if (message === 'forbidden' || message.includes('non-2xx status code')) return 'Přihlášení nemá oprávnění spustit synchronizaci.';
  return message || 'Synchronizace se nezdařila.';
}

function showAuth(reason) {
  $('#authScreen').hidden = false;
  $('#businessApp').hidden = true;
  $('#configNotice').hidden = reason !== 'not_configured' && reason !== 'migration_missing' && reason !== 'forbidden';
  if (reason === 'migration_missing') $('#configNotice').textContent = 'Business databázová migrace zatím není nasazená. Skutečná data proto nejsou dostupná.';
  if (reason === 'forbidden') $('#configNotice').textContent = 'Účet je přihlášený, ale nemá povolený přístup k business údajům.';
  $('#loginForm').hidden = reason === 'migration_missing' || reason === 'forbidden';
  // Kdo se přihlásí účtem bez oprávnění, musí mít cestu ven.
  $('#authSignOut').hidden = !['migration_missing', 'forbidden'].includes(reason);
}

function showApp(access) {
  $('#authScreen').hidden = true;
  $('#businessApp').hidden = false;
  $('#demoBanner').hidden = !demo;
  $('#accountEmail').textContent = access.email || '';
}

async function boot() {
  $('#localDemoLink').hidden = !localHost;
  const access = await store.hasAccess();
  if (!access.allowed) return showAuth(access.reason);
  showApp(access);
  await load();
}

async function load() {
  $('#loadingState').hidden = false;
  $('#viewContent').hidden = true;
  try {
    currentData = await store.load(period);
    render();
  } catch (error) {
    $('#viewContent').innerHTML = `<div class="error-state"><h3>Data se nepodařilo načíst</h3><p>${escapeHtml(error.message)}</p><button class="button button-secondary" data-action="retry">Zkusit znovu</button></div>`;
    $('#viewContent').hidden = false;
  } finally {
    $('#loadingState').hidden = true;
  }
}

function matchingPreset() {
  for (const value of ['week', 'month', '3m', '6m', '12m']) {
    const preset = presetPeriod(value);
    if (preset && preset.from === period.from && preset.to === period.to) return value;
  }
  return 'custom';
}

function render() {
  const view = currentView();
  $('#periodPreset').value = matchingPreset();
  const [title, question] = viewMeta[view];
  $('#viewTitle').textContent = title;
  $('#viewQuestion').textContent = question;
  $('#dateRangeLabel').textContent = labelPeriod();
  document.title = `${title} — Business — Jóga s králíčky`;
  $$('[data-view]').forEach((link) => {
    if (link.dataset.view === view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
    const url = new URL(link.href);
    url.searchParams.set('from', period.from); url.searchParams.set('to', period.to);
    if (demo) url.searchParams.set('demo', '1');
    link.href = `${url.pathname}${url.search}`;
  });
  $('#viewContent').innerHTML = renderView(view, currentData, { chartMetric });
  // Graf se na 390 px zmenší tak, že popisky os nejsou čitelné. Tam je
  // přesná tabulka jediná použitelná podoba, takže je rovnou otevřená.
  if (window.matchMedia('(max-width: 640px)').matches) {
    $$('[data-open-on-narrow]').forEach((node) => { node.open = true; });
  }
  $('#viewContent').hidden = false;
  fillCostCategories();
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = String(value || '');
  return div.innerHTML;
}

function exportSummary() {
  const effective = effectivePeriod();
  const rows = [
    // Vyvezené číslo musí nést i to, za jaké dny platí. Bez „zvolene_od"
    // by se z exportu nedalo poznat, že zahájení provozu období zkrátilo.
    ['obdobi_od', effective.from], ['obdobi_do', effective.to],
    ['zvolene_od', period.from], ['zvolene_do', period.to],
    ['zahajeni_provozu', currentData.summary.startDate || ''],
    ['jednotka', 'CZK_minor'], ['zdroj', 'business_period_summary'],
    ['uplnost', currentData.summary.completeness], ['vynosy_lekci', currentData.summary.recognizedRevenueMinor],
    ['provozni_naklady', currentData.summary.operatingCostsMinor], ['provozni_vysledek', currentData.summary.operatingResultMinor],
    ['zaplacena_mista', currentData.summary.paidSpots], ['penezni_tok', currentData.summary.cashFlowMinor],
  ];
  const csv = `metrika;hodnota\n${rows.map((row) => row.join(';')).join('\n')}\n`;
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `business-${period.from}-${period.to}.csv`; link.click(); URL.revokeObjectURL(url);
}

function closeMenu() {
  $('#sidebar').classList.remove('open');
  $('#sidebarScrim').classList.remove('show');
  $('#openMenu').setAttribute('aria-expanded', 'false');
}

function openMenu() {
  $('#sidebar').classList.add('open');
  $('#sidebarScrim').classList.add('show');
  $('#openMenu').setAttribute('aria-expanded', 'true');
  $('#closeMenu').focus();
}

function presetPeriod(value) {
  const now = new Date();
  const end = pragueDate(now);
  if (value === 'month') return monthPeriod(now);
  if (value === 'week') {
    const today = pragueDate(now);
    const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
    const shift = (days) => {
      const cursor = new Date(`${today}T12:00:00Z`);
      cursor.setUTCDate(cursor.getUTCDate() + days);
      return cursor.toISOString().slice(0, 10);
    };
    return { from: shift(-weekday), to: shift(6 - weekday) };
  }
  const months = { '3m': 3, '6m': 6, '12m': 12 }[value];
  if (months) {
    const start = new Date(now); start.setMonth(now.getMonth() - months + 1, 1);
    return { from: pragueDate(start), to: end };
  }
  return null;
}

function openPeriodDialog() {
  $('#periodFrom').value = period.from;
  $('#periodTo').value = period.to;
  $('#periodMessage').textContent = '';
  $('#periodDialog').showModal();
}

function fillCostCategories() {
  const selected = $('#costCategory').value;
  $('#costCategory').innerHTML = (currentData?.categories || []).filter((row) => row.active !== false).map((row) => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.name)}</option>`).join('');
  if (selected) $('#costCategory').value = selected;
}

function openCostDialog(rule = null) {
  $('#costForm').reset();
  $('#costRuleKey').value = rule?.rule_key || '';
  $('#costVersion').value = String(rule ? Number(rule.version || 1) + 1 : 1);
  $('#costName').value = rule?.name || '';
  $('#costAmount').value = rule ? String(Number(rule.amount_minor || 0) / 100).replace('.', ',') : '';
  $('#costDate').value = pragueToday();
  $('#costValidTo').value = rule?.valid_to || '';
  $('#costRecurrence').value = rule?.recurrence || 'once';
  $('#costClass').value = rule?.cost_class || 'operation';
  $('#percentageBasis').value = rule?.percentage_basis || 'recognized_revenue';
  $('#percentageRate').value = rule?.rate_basis_points != null ? String(Number(rule.rate_basis_points) / 100) : '15';
  $('#costNote').value = rule?.note || '';
  $('#costExistingAttachment').value = rule?.attachment_path || '';
  $('#costPaid').checked = true;
  $('#costOperating').checked = rule?.include_in_operating !== false;
  $('#costTitle').textContent = rule ? 'Upravit náklad od nového data' : 'Přidat náklad';
  $('#costMessage').textContent = '';
  fillCostCategories();
  if (rule?.category_id) $('#costCategory').value = rule.category_id;
  togglePercentageFields();
  $('#costDialog').showModal();
  $('#costName').focus();
}

function togglePercentageFields() {
  const percentage = $('#costRecurrence').value === 'percentage';
  $('#percentageBasisField').hidden = !percentage;
  $('#percentageRateField').hidden = !percentage;
  $('#costAmount').disabled = percentage;
  $('#costAmount').required = !percentage;
}

async function saveCost(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const amount = $('#costRecurrence').value === 'percentage' ? 0 : parseMoneyToMinor($('#costAmount').value);
  if (amount === null) return void ($('#costMessage').textContent = 'Zadejte platnou částku.');
  const validFrom = $('#costDate').value;
  const [year, month, day] = validFrom.split('-').map(Number);
  const recurrence = $('#costRecurrence').value;
  const payload = {
    rule_key: $('#costRuleKey').value || crypto.randomUUID(),
    version: Number($('#costVersion').value || 1), name: $('#costName').value.trim(),
    category_id: $('#costCategory').value || null, amount_minor: amount, currency: 'CZK', recurrence,
    valid_from: validFrom, valid_to: $('#costValidTo').value || null,
    day_of_month: day, month_of_year: month, rate_basis_points: recurrence === 'percentage' ? Math.round(Number($('#percentageRate').value) * 100) : null,
    percentage_basis: recurrence === 'percentage' ? $('#percentageBasis').value : null,
    cost_class: $('#costClass').value, include_in_operating: $('#costOperating').checked,
    note: $('#costNote').value.trim() || null, attachment_path: $('#costExistingAttachment').value || null, paid: $('#costPaid').checked,
  };
  $('#saveCost').disabled = true;
  try {
    await store.saveCost(payload, period, currentData, $('#costAttachment').files[0] || null);
    $('#costDialog').close(); toast('Náklad uložen.'); await load();
  } catch (error) { $('#costMessage').textContent = error.message; }
  finally { $('#saveCost').disabled = false; }
}

async function openDeleteCostDialog(rule, trigger) {
  if (!rule) return;
  pendingCostDelete = null;
  costDeleteTrigger = trigger;
  costDeleteCompleted = false;
  $('#deleteCostSummary').textContent = `Náklad „${rule.name}“: zjišťuji počet verzí a výskytů…`;
  $('#deleteCostMessage').textContent = '';
  $('#confirmDeleteCost').disabled = true;
  $('#confirmDeleteCost').removeAttribute('aria-busy');
  $('#deleteCostDialog').showModal();
  $('#cancelDeleteCost').focus();
  try {
    const impact = await store.costDeletionImpact(rule.rule_key);
    if (!$('#deleteCostDialog').open || costDeleteTrigger !== trigger) return;
    if (!impact.ruleCount) throw new Error('Náklad už neexistuje. Obnovte stránku.');
    pendingCostDelete = impact;
    const versions = countLabel(impact.ruleCount, 'pravidlo', 'verze pravidla', 'verzí pravidla');
    const occurrences = countLabel(impact.occurrenceCount, 'výskyt', 'výskyty', 'výskytů');
    const attachments = impact.attachmentCount ? ` a ${countLabel(impact.attachmentCount, 'soukromý doklad', 'soukromé doklady', 'soukromých dokladů')}` : '';
    $('#deleteCostSummary').textContent = `„${impact.name}“: smaže se ${versions}, ${occurrences}${attachments}.`;
    $('#confirmDeleteCost').disabled = false;
  } catch (error) {
    $('#deleteCostMessage').textContent = error.message;
  }
}

async function confirmDeleteCost() {
  if (!pendingCostDelete) return;
  const button = $('#confirmDeleteCost');
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  $('#cancelDeleteCost').disabled = true;
  $('#deleteCostMessage').textContent = '';
  try {
    const result = await store.deleteCost(pendingCostDelete.ruleKey);
    costDeleteCompleted = true;
    $('#deleteCostDialog').close();
    await load();
    $('[data-action="open-cost"]')?.focus();
    toast(result.attachmentCleanupFailed ? 'Náklad smazán. Soukromý doklad se nepodařilo odstranit.' : 'Náklad včetně výskytů smazán.');
  } catch (error) {
    $('#deleteCostMessage').textContent = error.message;
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    $('#cancelDeleteCost').disabled = false;
  }
}

async function readCsv(file) {
  $('#importMessage').textContent = '';
  const parsed = parseCsv(await file.text());
  if (!parsed.headers.length || !parsed.rows.length) return void ($('#importMessage').textContent = 'Soubor neobsahuje hlavičku a datové řádky.');
  const mapping = inferMapping(parsed.headers);
  const fields = [['date','Datum'],['amount','Částka'],['kind','Typ'],['note','Poznámka'],['externalId','Externí ID']];
  const signOptions = Object.entries(SIGN_CONVENTIONS).map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join('');
  $('#importMapping').innerHTML = `<div class="mapping-grid">${fields.map(([key, label]) => `<div class="field"><label for="map-${key}">${label}</label><select id="map-${key}" data-map="${key}"><option value="">— nevybráno —</option>${parsed.headers.map((header) => `<option value="${escapeHtml(header)}" ${mapping[key] === header ? 'selected' : ''}>${escapeHtml(header)}</option>`).join('')}</select></div>`).join('')}<div class="field"><label for="map-signConvention">Znaménko částky</label><select id="map-signConvention" data-map="signConvention">${signOptions}</select><span class="field-help">Bankovní i Stripe exporty obvykle píšou příjem kladně. Zkontrolujte v náhledu, že typy sedí.</span></div></div>`;
  $('#importMapping').hidden = false;
  $('#importMapping').dataset.rows = JSON.stringify(parsed.rows);
  updateImportPreview();
}

function updateImportPreview() {
  const rows = JSON.parse($('#importMapping').dataset.rows || '[]');
  const mapping = Object.fromEntries($$('[data-map]').map((select) => [select.dataset.map, select.value]));
  importRows = mapCsvRows(rows, mapping);
  const valid = importRows.filter((row) => row.valid).length;
  $('#importPreview').innerHTML = `<table><thead><tr><th>Řádek</th><th>Datum</th><th>Typ</th><th class="numeric">Částka</th><th>Kontrola</th></tr></thead><tbody>${importRows.slice(0, 12).map((row) => `<tr><td>${row.rowNumber}</td><td>${row.entry.occurred_at?.slice(0,10) || '—'}</td><td>${escapeHtml(row.entry.kind)}</td><td class="numeric">${new Intl.NumberFormat('cs-CZ').format(row.entry.amount_minor / 100)} Kč</td><td>${row.valid ? '<span class="badge good">Platný</span>' : `<span class="badge warn">${escapeHtml(row.errors.join(' '))}</span>`}</td></tr>`).join('')}</tbody></table>${importRows.length > 12 ? `<p class="field-help">Ukázáno prvních 12 z ${importRows.length} řádků.</p>` : ''}`;
  $('#importPreview').hidden = false;
  $('#runImport').disabled = valid === 0;
  $('#importMessage').textContent = `${valid} platných · ${importRows.length - valid} chybných řádků.`;
}

async function runImport() {
  const valid = importRows.filter((row) => row.valid).map((row) => row.entry);
  if (!valid.length) return;
  $('#runImport').disabled = true;
  try {
    const file = $('#csvFile').files[0];
    const result = await store.importLedger(valid, { source: 'csv', fileName: file?.name || 'import.csv' });
    $('#importDialog').close(); toast(`Import: ${result.imported} nových, ${result.duplicates} duplicit, ${result.failed} chyb.`); await load();
  } catch (error) { $('#importMessage').textContent = error.message; }
  finally { $('#runImport').disabled = false; }
}

async function handleViewAction(target) {
  const action = target.closest('[data-action]')?.dataset.action;
  const button = target.closest('[data-action]');
  if (!action) return;
  if (action === 'retry') return load();
  if (action === 'open-cost') return openCostDialog();
  if (action === 'edit-cost') return openCostDialog(currentData.costRules.find((row) => row.id === button.dataset.id));
  if (action === 'delete-cost') return openDeleteCostDialog(currentData.costRules.find((row) => row.id === button.dataset.id), button);
  if (action === 'chart-mode') { chartMetric = button.dataset.mode; return render(); }
  if (action === 'open-import') { $('#importForm').reset(); $('#importMapping').hidden = true; $('#importPreview').hidden = true; $('#runImport').disabled = true; $('#importMessage').textContent = ''; return $('#importDialog').showModal(); }
  if (action === 'print') return window.print();
  if (action === 'export-summary') { exportSummary(); return toast('Souhrn exportován.'); }
  if (action === 'save-view') { await store.saveView({ name: `${viewMeta[currentView()][0]} ${period.from}–${period.to}`, view_key: currentView(), filters: { from: period.from, to: period.to } }); toast('Pohled uložen.'); return load(); }
  if (action === 'sync-provider') {
    const provider = button.dataset.provider;
    const label = button.dataset.label || provider;
    button.disabled = true;
    button.textContent = 'Načítám…';
    try {
      const result = await store.syncProvider(provider, period);
      toast(`${label}: načteno ${Number(result.imported || 0)} záznamů.`);
    } catch (error) {
      toast(`${label}: ${syncErrorMessage(error)}`);
    }
    await load();
    return;
  }
  if (action === 'accept-budget') {
    const amount = Number(button.dataset.amount);
    if (!Number.isFinite(amount)) return toast('Návrh rozpočtu není k dispozici.');
    button.disabled = true;
    try {
      await store.saveBudget({
        period_start: period.from, period_end: period.to, kind: 'advertising',
        basis_period_start: period.from, basis_period_end: period.to,
        basis_result_minor: currentData.summary.operatingResultMinor,
        rate_basis_points: Math.round(Number(button.dataset.rate || 0) * 100),
        proposed_minor: amount, accepted_minor: amount, status: 'accepted',
      });
      toast('Rozpočet přijat.');
      await load();
    } catch (error) { button.disabled = false; toast(error.message); }
    return;
  }
  if (action === 'toggle-paid') { button.disabled = true; await store.markOccurrencePaid(button.dataset.id, button.dataset.paid !== 'true'); toast('Stav nákladu změněn.'); return load(); }
  if (action === 'open-attachment') {
    const popup = window.open('', '_blank');
    if (popup) popup.opener = null;
    button.disabled = true;
    try {
      const url = await store.attachmentUrl(button.dataset.path);
      if (popup) popup.location.href = url;
      else toast('Prohlížeč zablokoval otevření dokladu. Povolte vyskakovací okna.');
    } catch (error) {
      if (popup) popup.close();
      throw error;
    } finally { button.disabled = false; }
    return;
  }
}

$('#loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!client) return void ($('#loginMessage').textContent = 'Supabase není nastavený.');
  $('#loginButton').disabled = true; $('#loginMessage').textContent = '';
  const { error } = await client.auth.signInWithPassword({ email: $('#loginEmail').value.trim(), password: $('#loginPassword').value });
  if (error) { $('#loginMessage').textContent = 'Přihlášení se nezdařilo. Zkontrolujte e-mail a heslo.'; $('#loginButton').disabled = false; return; }
  location.reload();
});

const signOut = async () => { if (client) await client.auth.signOut(); location.href = '/business.html'; };
$('#logoutButton').addEventListener('click', signOut);
$('#authSignOut').addEventListener('click', signOut);
$('#openMenu').addEventListener('click', openMenu); $('#closeMenu').addEventListener('click', closeMenu); $('#sidebarScrim').addEventListener('click', closeMenu);
$('.sidebar').addEventListener('click', (event) => {
  const link = event.target.closest('a[data-view]');
  closeMenu();
  // Data pro všechny pohledy jsou už načtená. Plné načtení stránky by znovu
  // spustilo 19 dotazů i generování kalendáře nákladů.
  if (!link || !currentData || event.metaKey || event.ctrlKey || event.shiftKey || event.button) return;
  event.preventDefault();
  history.pushState({}, '', link.href);
  render();
  $('#mainContent').focus();
});
$('#openPeriod').addEventListener('click', openPeriodDialog);
$('#periodPreset').addEventListener('change', async (event) => { const next = presetPeriod(event.target.value); if (!next) return openPeriodDialog(); period = next; setUrl({ from: period.from, to: period.to }); await load(); });
$('#periodForm').addEventListener('submit', async (event) => { event.preventDefault(); const next = { from: $('#periodFrom').value, to: $('#periodTo').value }; if (!next.from || !next.to || next.from > next.to) return void ($('#periodMessage').textContent = 'Konec období musí být stejný nebo pozdější než začátek.'); period = next; $('#periodDialog').close(); setUrl({ from: period.from, to: period.to }); await load(); });
$('#costRecurrence').addEventListener('change', togglePercentageFields); $('#costForm').addEventListener('submit', saveCost);
$('#confirmDeleteCost').addEventListener('click', confirmDeleteCost);
$('#deleteCostDialog').addEventListener('close', () => {
  if (!costDeleteCompleted) costDeleteTrigger?.focus();
  pendingCostDelete = null;
  costDeleteTrigger = null;
});
$('#csvFile').addEventListener('change', (event) => event.target.files[0] && readCsv(event.target.files[0]));
$('#importMapping').addEventListener('change', updateImportPreview); $('#runImport').addEventListener('click', runImport);
$('#viewContent').addEventListener('click', (event) => handleViewAction(event.target).catch((error) => toast(error.message)));
$('#viewContent').addEventListener('submit', async (event) => {
  if (event.target.dataset.action !== 'save-setting') return;
  event.preventDefault();
  const form = new FormData(event.target);
  const key = event.target.dataset.setting || 'advertising_budget_rate';
  let value;
  if (key === 'payment_fee') {
    const fixed = parseMoneyToMinor(form.get('fixed_czk'));
    const rate = Number(form.get('rate_percent'));
    if (fixed === null || fixed < 0) return toast('Pevná část musí být platná částka.');
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) return toast('Procento musí být mezi 0 a 100.');
    value = { fixed_minor: fixed, rate_percent: rate };
  } else if (key === 'business_start') {
    const den = String(form.get('date') || '').trim();
    if (den && !/^\d{4}-\d{2}-\d{2}$/.test(den)) return toast('Zadejte platné datum.');
    value = { date: den || null };
  } else {
    const percent = Number(form.get('percent'));
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) return toast('Procento musí být mezi 0 a 100.');
    value = { percent };
  }
  await store.saveSetting(key, value);
  toast('Nastavení uloženo.');
  await load();
});
$('#resetDemo').addEventListener('click', async () => { store.resetDemo(); toast('Ukázková data obnovena.'); await load(); });
window.addEventListener('popstate', async () => { period = periodFromUrl() || period; await load(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMenu(); });

boot();
