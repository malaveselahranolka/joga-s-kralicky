import {
  breakEven,
  budgetStatus,
  formatMoney,
  integer,
  proposeAdBudget,
  recommendChannels,
  trafficSummary,
} from './domain.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const date = (value) => value ? new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${String(value).slice(0, 10)}T12:00:00`)) : '—';
const pct = (value) => Number.isFinite(Number(value)) ? `${new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 1 }).format(Number(value))} %` : '—';
const num = (value) => Number.isFinite(Number(value)) ? integer.format(Number(value)) : '—';

export const viewMeta = {
  overview: ['Přehled', 'Jak se daří?'],
  finance: ['Finance', 'Co studio opravdu vydělalo?'],
  marketing: ['Marketing', 'Kde peníze přivádějí hosty?'],
  audience: ['Publikum', 'Kdo se vrací a odkud přichází?'],
  plan: ['Plán', 'Co unese příští období?'],
  reports: ['Reporty', 'Co potřebujete předat dál?'],
  sources: ['Zdroje dat', 'Čemu lze v číslech věřit?'],
  settings: ['Nastavení', 'Jaká pravidla řídí výpočty?'],
};

function completeness(summary) {
  return summary.completeness === 'complete'
    ? '<span class="status-dot"></span> Úplná data'
    : `<span class="status-dot partial"></span> Částečná data · ${num(summary.missingPaymentAmounts)} plateb bez částky`;
}

function kpis(summary) {
  const items = [
    ['Výnosy z lekcí', formatMoney(summary.recognizedRevenueMinor), 'Podle data uskutečnění'],
    ['Provozní náklady', formatMoney(summary.operatingCostsMinor), 'Včetně reklamy a poplatků'],
    ['Provozní výsledek', formatMoney(summary.operatingResultMinor), summary.operatingResultMinor >= 0 ? 'Rezerva po provozu' : 'Náklady převyšují výnosy'],
    ['Zaplacená místa', num(summary.paidSpots), 'Kapacita, ne počet kupujících'],
  ];
  return `<section class="kpi-strip" aria-label="Klíčové ukazatele">${items.map(([label, value, meta]) => `<article class="kpi"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-meta">${meta}</div></article>`).join('')}</section>`;
}

function errors(rows = []) {
  if (!rows.length) return '';
  const sources = [...new Set(rows.map((row) => row.source))].join(', ');
  return `<div class="notice notice-warning"><strong>Některá napojení vyžadují kontrolu:</strong> ${esc(sources)}. Zobrazené hodnoty jsou poslední dostupný stav.</div>`;
}

function trendChart(data, metric = 'result') {
  const byDay = new Map(data.dailyMetrics.map((row) => [row.metric_date, { ...row, ...(row.metrics || {}) }]));
  const lessonById = new Map(data.lessons.map((row) => [row.id, row]));
  for (const booking of data.bookings.filter((row) => row.payment_status === 'paid' && row.status !== 'cancelled' && row.payment_amount != null)) {
    const day = lessonById.get(booking.lesson_id)?.starts_at?.slice(0, 10);
    if (!day) continue;
    const row = byDay.get(day) || { metric_date: day };
    row.revenue_minor = Number(row.revenue_minor || 0) + Number(booking.payment_amount);
    byDay.set(day, row);
  }
  for (const occurrence of data.occurrences.filter((row) => row.status === 'paid' && row.include_in_operating !== false)) {
    const day = String(occurrence.period_start || occurrence.scheduled_on).slice(0, 10);
    const row = byDay.get(day) || { metric_date: day };
    row.costs_minor = Number(row.costs_minor || 0) + Number(occurrence.amount_minor || 0);
    byDay.set(day, row);
  }
  for (const entry of data.ledger.filter((row) => row.status !== 'void' && ['refund','fee','ad_spend','expense'].includes(row.kind) && !row.cost_occurrence_id)) {
    const day = String(entry.occurred_at).slice(0, 10);
    const row = byDay.get(day) || { metric_date: day };
    row.costs_minor = Number(row.costs_minor || 0) + Math.abs(Number(entry.amount_minor || 0));
    byDay.set(day, row);
  }
  const rows = [...byDay.values()].sort((a, b) => String(a.metric_date).localeCompare(String(b.metric_date)));
  const values = rows.map((row) => metric === 'revenue' ? Number(row.revenue_minor || 0) : metric === 'costs' ? Number(row.costs_minor || 0) : Number(row.revenue_minor || 0) - Number(row.costs_minor || 0));
  if (!rows.length || values.every((value) => value === 0)) return '<div class="empty-state"><h3>Zatím bez časové řady</h3><p>Graf se objeví po prvním denním souhrnu.</p></div>';
  const width = 880, height = 250, left = 54, right = 18, top = 14, bottom = 38;
  const min = Math.min(0, ...values), max = Math.max(1, ...values);
  const x = (index) => left + index * (width - left - right) / Math.max(1, rows.length - 1);
  const y = (value) => top + (max - value) * (height - top - bottom) / Math.max(1, max - min);
  const points = values.map((value, index) => `${x(index)},${y(value)}`).join(' ');
  const area = `${left},${y(0)} ${points} ${x(rows.length - 1)},${y(0)}`;
  const grid = [0, .5, 1].map((part) => {
    const value = min + (max - min) * part;
    return `<line class="chart-grid" x1="${left}" y1="${y(value)}" x2="${width - right}" y2="${y(value)}"/><text class="chart-axis" x="${left - 8}" y="${y(value) + 4}" text-anchor="end">${esc(formatMoney(value))}</text>`;
  }).join('');
  const labels = rows.filter((_, index) => index === 0 || index === rows.length - 1 || index === Math.floor(rows.length / 2)).map((row) => {
    const index = rows.indexOf(row);
    return `<text class="chart-axis" x="${x(index)}" y="${height - 9}" text-anchor="middle">${esc(date(row.metric_date))}</text>`;
  }).join('');
  const metricLabel = metric === 'revenue' ? 'Výnosy' : metric === 'costs' ? 'Náklady' : 'Provozní výsledek';
  return `<div class="chart-wrap"><svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="trendTitle trendDesc"><title id="trendTitle">${metricLabel} po dnech</title><desc id="trendDesc">Časová řada ukazatele ${metricLabel.toLowerCase()} za zvolené období. Přesná čísla jsou v tabulce pod grafem.</desc>${grid}<line class="chart-zero" x1="${left}" y1="${y(0)}" x2="${width - right}" y2="${y(0)}"/><polygon class="chart-area" points="${area}"/><polyline class="chart-line" points="${points}"/>${values.map((value, index) => `<circle class="chart-point" cx="${x(index)}" cy="${y(value)}" r="3.5"><title>${date(rows[index].metric_date)}: ${formatMoney(value)}</title></circle>`).join('')}${labels}</svg></div><details class="chart-table-toggle"><summary>Přesná data grafu</summary><div class="table-scroll chart-table"><table><thead><tr><th>Den</th><th class="numeric">${metricLabel}</th><th class="numeric">Návštěvy</th></tr></thead><tbody>${rows.map((row, index) => `<tr><td>${date(row.metric_date)}</td><td class="numeric">${formatMoney(values[index])}</td><td class="numeric">${num(row.sessions)}</td></tr>`).join('')}</tbody></table></div></details>`;
}

function overview(data, options) {
  const s = data.summary;
  const rate = data.settings.find((row) => row.key === 'advertising_budget_rate')?.value?.percent ?? 15;
  const proposal = proposeAdBudget(s.operatingResultMinor, rate, { basisKnown: s.completeness === 'complete', cashLimitMinor: Math.max(0, s.cashFlowMinor) });
  const lessonCapacity = data.lessons.reduce((sum, row) => sum + Number(row.capacity || 0), 0);
  const occupancy = lessonCapacity ? s.paidSpots / lessonCapacity * 100 : null;
  const traffic = trafficSummary(data.dailyMetrics.map((row) => ({ ...row, ...(row.metrics || {}) })), data.periodMetrics.find((row) => row.complete)?.metrics);
  return `<div class="view-stack">${errors(data.errors)}${kpis(s)}
    <div class="overview-grid"><section class="panel"><div class="chart-toolbar"><div><p class="section-label">Rytmus studia</p><h2>Vývoj výsledku</h2></div><div><div class="segmented" aria-label="Ukazatel grafu">${[['result','Výsledek'],['revenue','Výnosy'],['costs','Náklady']].map(([key,label]) => `<button type="button" data-action="chart-mode" data-mode="${key}" aria-pressed="${options.chartMetric === key}">${label}</button>`).join('')}</div><div class="status-tag">${completeness(s)}</div></div></div>${trendChart(data, options.chartMetric)}</section>
    <aside class="panel"><div class="section-head"><div><p class="section-label">Dnes důležité</p><h2>Signály</h2></div></div><div class="insight-list">
      <div class="insight"><strong>Obsazenost ${pct(occupancy)}</strong><p>${num(s.paidSpots)} zaplacených míst z kapacity ${num(lessonCapacity)}.</p><a href="?view=plan">Otevřít plán →</a></div>
      <div class="insight"><strong>${num(s.buyerCount)} skutečných kupujících</strong><p>Skupinová rezervace se počítá jako jeden kupující, místa samostatně.</p><a href="?view=audience">Rozebrat publikum →</a></div>
      <div class="insight"><strong>${traffic.users === null ? 'Uživatelé nejsou dostupní' : `${num(traffic.users)} unikátních uživatelů`}</strong><p>${num(traffic.sessions)} návštěv a ${num(traffic.views)} zobrazení veřejného webu.</p><a href="?view=sources">Zkontrolovat zdroje →</a></div>
    </div></aside></div>
    <section class="panel panel-quiet budget-callout"><div><p class="section-label">Další krok</p><h2>Návrh rozpočtu na reklamu</h2><p>${proposal.proposedMinor === null ? 'Výsledek není úplný, proto automatický návrh nevznikl.' : `${rate} % z kladného výsledku, omezeno dostupnou hotovostí.`}</p></div><div><div class="amount">${formatMoney(proposal.proposedMinor)}</div><a href="?view=marketing">Rozdělit rozpočet →</a></div></section>
  </div>`;
}

function finance(data) {
  const s = data.summary;
  const expenses = [
    ['Provozní výskyty', s.operatingCostsMinor - s.feesMinor - s.adSpendMinor],
    ['Reklama', s.adSpendMinor], ['Platební poplatky', s.feesMinor], ['Refundace', s.refundsMinor],
  ].filter(([, value]) => value > 0);
  const max = Math.max(1, ...expenses.map(([, value]) => value));
  return `<div class="view-stack">${errors(data.errors)}<nav class="context-tabs" aria-label="Finance"><a href="#result" aria-current="page">Výsledek</a><a href="#costs">Náklady</a><a href="#cash">Pohyby</a></nav>
    <section class="panel" id="result"><div class="section-head"><div><p class="section-label">Manažerský pohled</p><h2>Rozklad výsledku studia</h2><p>Výnos vzniká uskutečněním lekce. Peněžní tok sleduje datum úhrady.</p></div><span class="status-tag">${completeness(s)}</span></div><div class="result-trace"><div class="trace-step"><div class="label">Výnosy lekcí</div><div class="value">${formatMoney(s.recognizedRevenueMinor)}</div></div><div class="trace-op">−</div><div class="trace-step"><div class="label">Provozní náklady a refundace</div><div class="value">${formatMoney(s.operatingCostsMinor + s.refundsMinor)}</div></div><div class="trace-op">=</div><div class="trace-step result"><div class="label">Provozní výsledek</div><div class="value">${formatMoney(s.operatingResultMinor)}</div></div></div><div class="planning-step"><strong>Prodej poukazů: ${formatMoney(s.voucherSalesMinor)}</strong><p>Je v peněžním toku, ne ve výnosech lekcí. Čerpání poukazu se nezapočítá podruhé.</p></div></section>
    <div class="split-grid"><section class="panel" id="costs"><div class="section-head"><div><p class="section-label">Struktura</p><h2>Náklady</h2></div><button class="button button-primary" data-action="open-cost">Přidat náklad</button></div>${expenses.length ? `<div class="bar-list">${expenses.map(([label, value]) => `<div class="bar-row"><span>${label}</span><span class="bar-track"><span class="bar-fill" style="width:${Math.round(value / max * 100)}%"></span></span><strong class="bar-value">${formatMoney(value)}</strong></div>`).join('')}</div>` : '<div class="empty-state"><h3>Žádné náklady</h3><p>V období nejsou zaplacené nákladové položky.</p></div>'}</section>
    <section class="panel" id="cash"><div class="section-head"><div><p class="section-label">Hotovost</p><h2>Peněžní pohyby</h2></div><button class="button button-secondary" data-action="open-import">Import CSV</button></div><div class="summary-grid"><div class="summary-item"><div class="label">Příjem z prodejů</div><div class="value">${formatMoney(s.cashSalesMinor)}</div></div><div class="summary-item"><div class="label">Peněžní tok</div><div class="value">${formatMoney(s.cashFlowMinor)}</div></div><div class="summary-item"><div class="label">Payouty</div><div class="value">Nejsou výnos</div></div></div></section></div>
    <section class="panel"><div class="section-head"><div><p class="section-label">Platnost a verze</p><h2>Pravidla nákladů</h2><p>Úprava vytvoří novou verzi od zvoleného data. Staré skutečné výskyty zůstanou beze změny.</p></div></div>${table(data.costRules,[['name','Náklad'],['amount_minor','Sazba',formatMoney],['recurrence','Opakování'],['valid_from','Platí od',date],['version','Verze',num]], (row) => `${row.status === 'active' ? `<button class="text-button" data-action="edit-cost" data-id="${esc(row.id)}">Upravit</button>` : '<span class="muted">Archiv</span>'}${row.attachment_path ? ` <button class="text-button" data-action="open-attachment" data-path="${esc(row.attachment_path)}">Doklad</button>` : ''}`)}</section>
    <section class="panel"><div class="section-head"><div><p class="section-label">Kontrola plateb</p><h2>Výskyty nákladů</h2></div></div>${table(data.occurrences, [['scheduled_on','Datum',date],['amount_minor','Částka',formatMoney],['status','Stav',statusLabel]], (row) => `<button class="text-button" data-action="toggle-paid" data-id="${esc(row.id)}" data-paid="${row.status === 'paid'}">${row.status === 'paid' ? 'Vrátit na plán' : 'Označit zaplaceno'}</button>`)}</section>
  </div>`;
}

function statusLabel(value) {
  const labels = { paid: 'Zaplaceno', planned: 'Plán', active: 'Aktivní', connected: 'Připojeno', syncing: 'Synchronizace', error: 'Chyba', not_connected: 'Nepřipojeno', stale: 'Data zastaralá', paused: 'Pozastaveno' };
  return esc(labels[value] || value || '—');
}

function table(rows, columns, action) {
  if (!rows?.length) return '<div class="empty-state"><h3>Bez záznamů</h3><p>Pro zvolené období tu zatím nic není.</p></div>';
  return `<div class="table-scroll"><table><thead><tr>${columns.map(([, label]) => `<th>${label}</th>`).join('')}${action ? '<th>Akce</th>' : ''}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map(([key,, formatter]) => `<td>${formatter ? formatter(row[key], row) : esc(row[key])}</td>`).join('')}${action ? `<td>${action(row)}</td>` : ''}</tr>`).join('')}</tbody></table></div>`;
}

function marketing(data) {
  const budget = data.budgets[0];
  const accepted = Number(budget?.accepted_minor || 0), spent = data.summary.adSpendMinor;
  const state = budgetStatus(accepted, spent, 0);
  const recommendation = recommendChannels(state.remainingMinor, data.campaigns);
  return `<div class="view-stack">${errors(data.errors)}<section class="panel panel-quiet budget-callout"><div><p class="section-label">Schválený rámec</p><h2>Reklamní rozpočet</h2><p>Utraceno ${formatMoney(spent)} · ${state.overspentMinor ? `překročeno ${formatMoney(state.overspentMinor)}` : `zbývá ${formatMoney(state.remainingMinor)}`}.</p></div><div class="amount">${formatMoney(accepted)}</div></section>
    <section class="panel"><div class="section-head"><div><p class="section-label">Podložené rozdělení</p><h2>Doporučení kanálů</h2><p>Kanál se doporučí až od pěti nákupů. Menší vzorek zůstává experiment.</p></div></div>${recommendation.allocations.length ? `<div class="three-grid">${recommendation.allocations.map((row) => `<article class="mini-card"><h3>${esc(row.channel)}</h3><span class="big">${formatMoney(row.amountMinor)}</span><p>ROAS ${row.roas.toFixed(2)} · ${num(row.purchases)} nákupů</p></article>`).join('')}</div>` : '<div class="notice notice-info">Není dost dat pro automatické rozdělení. Zbývající částka patří do malých měřitelných experimentů.</div>'}</section>
    <section class="panel"><div class="section-head"><div><p class="section-label">Výkon</p><h2>Kampaně</h2></div></div>${table(data.campaigns,[['name','Kampaň'],['channel','Kanál'],['spend_minor','Útrata',formatMoney],['revenue_minor','Přiřazené tržby',formatMoney],['purchases','Nákupy',num]])}</section>
    <section class="panel"><div class="section-head"><div><p class="section-label">Obsah</p><h2>Příspěvky</h2></div></div>${table(data.posts,[['published_at','Publikováno',date],['channel','Síť'],['format','Formát'],['metrics','Zhlédnutí',(_, row) => num(row.metrics?.views)],['saves','Uložení',(_, row) => num(row.metrics?.saves)],['interactions','Interakce',(_, row) => num(row.metrics?.interactions)]])}</section></div>`;
}

function audience(data) {
  const paid = data.bookings.filter((row) => row.payment_status === 'paid' && row.status !== 'cancelled');
  const byEmail = new Map();
  for (const row of paid) {
    const email = String(row.email || '').toLowerCase();
    if (!email || email.startsWith('rucne')) continue;
    const current = byEmail.get(email) || { email, orders: 0, spots: 0, value: 0 };
    current.orders += 1; current.spots += Number(row.spots || 0); current.value += Number(row.payment_amount || 0); byEmail.set(email, current);
  }
  const repeat = [...byEmail.values()].filter((row) => row.orders > 1);
  const traffic = trafficSummary(data.dailyMetrics.map((row) => ({ ...row, ...(row.metrics || {}) })), data.periodMetrics.find((row) => row.complete)?.metrics);
  return `<div class="view-stack">${errors(data.errors)}<section class="kpi-strip"><article class="kpi"><div class="kpi-label">Kupující</div><div class="kpi-value">${num(byEmail.size)}</div><div class="kpi-meta">Unikátní ověřitelné e-maily</div></article><article class="kpi"><div class="kpi-label">Opakovaní</div><div class="kpi-value">${num(repeat.length)}</div><div class="kpi-meta">Alespoň dva nákupy</div></article><article class="kpi"><div class="kpi-label">Uživatelé webu</div><div class="kpi-value">${num(traffic.users)}</div><div class="kpi-meta">Nesčítáno z denních unikátů</div></article><article class="kpi"><div class="kpi-label">Návštěvy</div><div class="kpi-value">${num(traffic.sessions)}</div><div class="kpi-meta">Pouze veřejné stránky</div></article></section>
    <div class="split-grid"><section class="panel"><div class="section-head"><div><p class="section-label">Retence</p><h2>Opakovaní kupující</h2></div></div>${table(repeat,[['email','E-mail'],['orders','Nákupy',num],['spots','Místa',num],['value','Hodnota',formatMoney]])}</section><section class="panel"><div class="section-head"><div><p class="section-label">Metodika</p><h2>Co se nepočítá dvakrát</h2></div></div><div class="insight-list"><div class="insight"><strong>Jedna skupina = jeden kupující</strong><p>Počet míst zůstává zachovaný pro kapacitu.</p></div><div class="insight"><strong>Ruční zástupné e-maily vyloučeny</strong><p>Retenci nezkreslí záznamy bez skutečné identity.</p></div><div class="insight"><strong>Unikátní uživatelé za celé období</strong><p>Denní hodnoty se nesčítají.</p></div></div></section></div></div>`;
}

function plan(data) {
  const lessons = data.lessons.length;
  const capacity = data.lessons.reduce((sum, row) => sum + Number(row.capacity || 0), 0);
  const averageCapacity = lessons ? capacity / lessons : 0;
  const averageSpots = lessons ? data.summary.paidSpots / lessons : 0;
  const fixed = data.occurrences.filter((row) => !row.source_lesson_id).reduce((sum, row) => sum + Number(row.amount_minor || 0), 0);
  const unit = breakEven({ fixedCostsMinor: fixed, priceMinor: 49900, variableCostMinor: 7000, capacity: averageCapacity });
  return `<div class="view-stack"><section class="panel"><div class="section-head"><div><p class="section-label">Bod zvratu</p><h2>Kolik míst zaplatí běžný provoz?</h2><p>Model používá pracovní cenu 499 Kč a proměnný náklad 70 Kč na místo. Před rozhodnutím upravte scénář.</p></div></div><div class="summary-grid"><div class="summary-item"><div class="label">Fixní náklady období</div><div class="value">${formatMoney(fixed)}</div></div><div class="summary-item"><div class="label">Míst k bodu zvratu</div><div class="value">${num(unit.seats)}</div></div><div class="summary-item"><div class="label">Průměr na lekci</div><div class="value">${averageSpots.toFixed(1)} / ${averageCapacity.toFixed(0)}</div></div></div></section>
    <section class="panel"><div class="section-head"><div><p class="section-label">Kapacita</p><h2>Lekce v období</h2></div></div>${table(data.lessons,[['starts_at','Datum',date],['title','Lekce'],['capacity','Kapacita',num],['status','Stav',statusLabel]])}</section>
    <section class="panel"><div class="section-head"><div><p class="section-label">Varianty</p><h2>Uložené scénáře</h2></div></div>${data.scenarios.length ? `<div class="three-grid">${data.scenarios.map((row) => `<article class="mini-card"><h3>${esc(row.name)}</h3><span class="big">${formatMoney(row.result?.revenue_minor)}</span><p>${date(row.period_start)}–${date(row.period_end)}</p></article>`).join('')}</div>` : '<div class="empty-state"><h3>Bez scénářů</h3><p>Scénáře vzniknou po zadání růstu kapacity nebo ceny.</p></div>'}</section></div>`;
}

function reports(data) {
  return `<div class="view-stack"><section class="panel"><div class="section-head"><div><p class="section-label">Tisk a export</p><h2>Měsíční podklad</h2><p>Souhrn používá stejné definice jako přehled. Export nese období, jednotku, zdroj a stav úplnosti.</p></div><div><button class="button button-secondary" data-action="export-summary">Export CSV</button> <button class="button button-primary" data-action="print">Vytisknout / uložit PDF</button></div></div>${kpis(data.summary)}</section><section class="panel"><div class="section-head"><div><p class="section-label">Uložené filtry</p><h2>Pohledy</h2></div><button class="button button-secondary" data-action="save-view">Uložit aktuální pohled</button></div>${table(data.savedViews,[['name','Název'],['view_key','Sekce']])}</section><section class="panel"><div class="section-head"><div><p class="section-label">Rozhodnutí</p><h2>Poznámky v období</h2></div></div>${table(data.notes,[['note_date','Datum',date],['note_type','Typ'],['body','Poznámka']])}</section><section class="panel"><div class="section-head"><div><p class="section-label">Audit</p><h2>Poslední změny</h2></div></div>${table(data.changeLog,[['changed_at','Čas',date],['table_name','Tabulka'],['action','Operace']])}</section></div>`;
}

function sources(data) {
  const syncable = new Set(['stripe', 'ga4', 'vercel', 'meta_ads', 'instagram', 'facebook_page', 'tiktok_ads', 'tiktok_organic', 'google_ads', 'sklik']);
  const required = [
    ['supabase','Supabase'], ['stripe','Stripe'], ['ga4','GA4'], ['vercel','Vercel'],
    ['meta_ads','Meta Ads'], ['instagram','Instagram'], ['facebook_page','Facebook'],
    ['tiktok_ads','TikTok Ads'], ['tiktok_organic','TikTok obsah'], ['google_ads','Google Ads'],
    ['sklik','Sklik'], ['zapier','Zapier'],
  ];
  const byProvider = new Map(data.connections.map((row) => [row.provider, row]));
  return `<div class="view-stack">${errors(data.errors)}<section class="panel"><div class="section-head"><div><p class="section-label">Stav</p><h2>Napojení</h2><p>Dashboard nezobrazuje vymyšlené hodnoty. Nepřipojený zdroj zůstane výslovně prázdný.</p></div></div><div class="connection-list">${required.map(([provider, label]) => {
    const row = byProvider.get(provider) || { provider, status: provider === 'supabase' ? 'connected' : 'not_connected' };
    const kind = row.status === 'connected' ? 'good' : row.status === 'error' ? 'warn' : '';
    const syncButton = syncable.has(provider) ? `<button class="button button-secondary button-small" type="button" data-action="sync-provider" data-provider="${esc(provider)}" data-label="${esc(label)}" aria-label="Načíst data: ${esc(label)}">Načíst data</button>` : '';
    return `<div class="connection"><strong>${esc(label)}</strong><span class="connection-status"><span class="status-dot ${row.status === 'connected' ? '' : 'partial'}"></span>${statusLabel(row.status)}</span><span class="connection-detail">${row.last_success_at ? `Naposledy ${date(row.last_success_at)}` : 'Čeká na bezpečné připojení'} ${row.last_error ? `· ${esc(row.last_error)}` : ''}</span><span class="connection-actions"><span class="badge ${kind}">${row.status === 'connected' ? 'živé' : 'bez hodnot'}</span>${syncButton}</span></div>`;
  }).join('')}</div></section><div class="notice notice-info">API klíče a přihlášení zůstávají pouze v serverových secrets. Synchronizace běží mimo prohlížeč a její selhání neovlivní rezervace.</div></div>`;
}

function settings(data) {
  const rate = data.settings.find((row) => row.key === 'advertising_budget_rate')?.value?.percent ?? 15;
  return `<div class="view-stack"><section class="panel"><div class="section-head"><div><p class="section-label">Plánovací pravidlo</p><h2>Podíl výsledku pro reklamu</h2><p>Použije se pouze na kladný a úplný provozní výsledek.</p></div></div><form data-action="save-setting"><div class="field"><label for="adRate">Procento</label><input id="adRate" name="percent" type="number" min="0" max="100" step="0.1" value="${esc(rate)}"></div><div class="modal-actions"><button class="button button-primary" type="submit">Uložit pravidlo</button></div></form></section><section class="panel"><div class="section-head"><div><p class="section-label">Dohledatelnost</p><h2>Uložené pohledy</h2></div></div>${table(data.savedViews,[['name','Název'],['view_key','Sekce']])}</section><div class="notice notice-warning">Měnu a časové pásmo nelze z tohoto rozhraní měnit. Výpočty používají CZK a Europe/Prague.</div></div>`;
}

export function renderView(view, data, options = { chartMetric: 'result' }) {
  if (view === 'finance') return finance(data);
  if (view === 'marketing') return marketing(data);
  if (view === 'audience') return audience(data);
  if (view === 'plan') return plan(data);
  if (view === 'reports') return reports(data);
  if (view === 'sources') return sources(data);
  if (view === 'settings') return settings(data);
  return overview(data, options);
}
