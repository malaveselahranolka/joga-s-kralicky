import { mapCsvRows, inferMapping, parseCsv } from './csv.js';
import { monthPeriod, parseMoneyToMinor, pragueDate } from './domain.js';
import { createBusinessStore } from './data.js';
import { renderView, viewMeta } from './ui.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
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

function periodFromUrl() {
  const liveParams = new URLSearchParams(location.search);
  const from = liveParams.get('from'), to = liveParams.get('to');
  return /^\d{4}-\d{2}-\d{2}$/.test(from || '') && /^\d{4}-\d{2}-\d{2}$/.test(to || '') && from <= to ? { from, to } : null;
}

function currentView() {
  const view = new URLSearchParams(location.search).get('view') || 'overview';
  return viewMeta[view] ? view : 'overview';
}

function labelPeriod() {
  const formatter = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' });
  return `${formatter.format(new Date(`${period.from}T12:00:00`))} – ${formatter.format(new Date(`${period.to}T12:00:00`))}`;
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

function render() {
  const view = currentView();
  const [title, question] = viewMeta[view];
  $('#viewTitle').textContent = title;
  $('#viewQuestion').textContent = question;
  $('#dateRangeLabel').textContent = labelPeriod();
  document.title = `${title} — Business — Jóga s králíčky`;
  $$('[data-view]').forEach((link) => {
    link.toggleAttribute('aria-current', link.dataset.view === view);
    const url = new URL(link.href);
    url.searchParams.set('from', period.from); url.searchParams.set('to', period.to);
    if (demo) url.searchParams.set('demo', '1');
    link.href = `${url.pathname}${url.search}`;
  });
  $('#viewContent').innerHTML = renderView(view, currentData, { chartMetric });
  $('#viewContent').hidden = false;
  fillCostCategories();
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = String(value || '');
  return div.innerHTML;
}

function exportSummary() {
  const rows = [
    ['obdobi_od', period.from], ['obdobi_do', period.to], ['jednotka', 'CZK_minor'], ['zdroj', 'business_period_summary'],
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
    const weekday = (now.getDay() + 6) % 7;
    const start = new Date(now); start.setDate(now.getDate() - weekday);
    const finish = new Date(start); finish.setDate(start.getDate() + 6);
    return { from: pragueDate(start), to: pragueDate(finish) };
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
  $('#costDate').value = rule ? pragueDate(new Date()) : pragueDate(new Date());
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
    category_id: $('#costCategory').value, amount_minor: amount, currency: 'CZK', recurrence,
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

async function readCsv(file) {
  $('#importMessage').textContent = '';
  const parsed = parseCsv(await file.text());
  if (!parsed.headers.length || !parsed.rows.length) return void ($('#importMessage').textContent = 'Soubor neobsahuje hlavičku a datové řádky.');
  const mapping = inferMapping(parsed.headers);
  const fields = [['date','Datum'],['amount','Částka'],['kind','Typ'],['note','Poznámka'],['externalId','Externí ID']];
  $('#importMapping').innerHTML = `<div class="mapping-grid">${fields.map(([key, label]) => `<div class="field"><label for="map-${key}">${label}</label><select id="map-${key}" data-map="${key}"><option value="">— nevybráno —</option>${parsed.headers.map((header) => `<option value="${escapeHtml(header)}" ${mapping[key] === header ? 'selected' : ''}>${escapeHtml(header)}</option>`).join('')}</select></div>`).join('')}</div>`;
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

$('#logoutButton').addEventListener('click', async () => { if (client) await client.auth.signOut(); location.href = '/business.html'; });
$('#openMenu').addEventListener('click', openMenu); $('#closeMenu').addEventListener('click', closeMenu); $('#sidebarScrim').addEventListener('click', closeMenu);
$('.sidebar').addEventListener('click', (event) => { if (event.target.closest('a')) closeMenu(); });
$('#openPeriod').addEventListener('click', openPeriodDialog);
$('#periodPreset').addEventListener('change', async (event) => { const next = presetPeriod(event.target.value); if (!next) return openPeriodDialog(); period = next; setUrl({ from: period.from, to: period.to }); await load(); });
$('#periodForm').addEventListener('submit', async (event) => { event.preventDefault(); const next = { from: $('#periodFrom').value, to: $('#periodTo').value }; if (!next.from || !next.to || next.from > next.to) return void ($('#periodMessage').textContent = 'Konec období musí být stejný nebo pozdější než začátek.'); period = next; $('#periodDialog').close(); setUrl({ from: period.from, to: period.to }); await load(); });
$('#costRecurrence').addEventListener('change', togglePercentageFields); $('#costForm').addEventListener('submit', saveCost);
$('#csvFile').addEventListener('change', (event) => event.target.files[0] && readCsv(event.target.files[0]));
$('#importMapping').addEventListener('change', updateImportPreview); $('#runImport').addEventListener('click', runImport);
$('#viewContent').addEventListener('click', (event) => handleViewAction(event.target).catch((error) => toast(error.message)));
$('#viewContent').addEventListener('submit', async (event) => { if (event.target.dataset.action !== 'save-setting') return; event.preventDefault(); const percent = Number(new FormData(event.target).get('percent')); if (!Number.isFinite(percent) || percent < 0 || percent > 100) return toast('Procento musí být mezi 0 a 100.'); await store.saveSetting('advertising_budget_rate', { percent }); toast('Pravidlo uloženo.'); await load(); });
$('#resetDemo').addEventListener('click', async () => { store.resetDemo(); toast('Ukázková data obnovena.'); await load(); });
window.addEventListener('popstate', async () => { period = periodFromUrl() || period; await load(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMenu(); });

boot();
