import { ledgerIdentity } from './domain.js';

const INTERNAL_PREFIXES = ['/admin', '/business', '/vstupenka', '/studio'];

export function isPublicTrafficPath(pathname, { preview = false, test = false } = {}) {
  const path = String(pathname || '/').split('?')[0].toLowerCase();
  if (preview || test) return false;
  return !INTERNAL_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}.`));
}

export function normalizeMetric(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function metricEnvelope({ provider, from, to, metrics, method, complete = true, timeZone = 'Europe/Prague', currency = null }) {
  if (!provider || !/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '') || from > to) throw new Error('Invalid metric period.');
  if (method === 'daily_unique_sum' && Object.hasOwn(metrics || {}, 'users')) throw new Error('Period users cannot be a sum of daily uniques.');
  return {
    provider, period_start: from, period_end: to, time_zone: timeZone, currency,
    complete: Boolean(complete), methodology: method || 'provider_period_aggregate',
    metrics: Object.fromEntries(Object.entries(metrics || {}).map(([key, value]) => [key, normalizeMetric(value)])),
  };
}

export function mapStripeMovement(row) {
  if (!row?.id || !row?.created) throw new Error('Stripe movement requires stable id and created time.');
  const type = String(row.type || '').toLowerCase();
  const kind = type.includes('refund') ? 'refund'
    : type.includes('fee') ? 'fee'
      : type.includes('payout') || type.includes('transfer') ? 'transfer'
        : type.includes('charge') || type.includes('payment') ? 'income'
          : 'adjustment';
  const raw = Number(row.amount);
  if (!Number.isFinite(raw) || raw === 0) throw new Error('Stripe movement requires a non-zero amount.');
  return {
    source: 'stripe', external_id: row.id, source_created_at: new Date(Number(row.created) * 1000).toISOString(),
    source_updated_at: new Date(Number(row.updated || row.created) * 1000).toISOString(),
    occurred_at: new Date(Number(row.created) * 1000).toISOString(), currency: String(row.currency || 'czk').toUpperCase(),
    amount_minor: Math.abs(raw), kind, status: row.status === 'pending' ? 'pending' : 'posted',
    note: row.description || null,
  };
}

export function reconcileExternalRows(existing, incoming) {
  const rows = existing.map((row) => ({ ...row }));
  const index = new Map(rows.map((row, position) => [ledgerIdentity(row), position]).filter(([key]) => key));
  const result = { inserted: 0, updated: 0, stale: 0, duplicates: 0 };
  for (const candidate of incoming) {
    const key = ledgerIdentity(candidate);
    if (!key || !index.has(key)) {
      index.set(key, rows.length); rows.push({ ...candidate }); result.inserted += 1; continue;
    }
    const position = index.get(key), current = rows[position];
    const currentVersion = Date.parse(current.source_updated_at || current.imported_at || 0);
    const nextVersion = Date.parse(candidate.source_updated_at || candidate.imported_at || 0);
    if (Number.isFinite(currentVersion) && Number.isFinite(nextVersion) && nextVersion < currentVersion) { result.stale += 1; continue; }
    if ((!Number.isFinite(nextVersion) && !Number.isFinite(currentVersion)) || JSON.stringify(current) === JSON.stringify(candidate)) { result.duplicates += 1; continue; }
    rows[position] = { ...current, ...candidate, id: current.id || candidate.id }; result.updated += 1;
  }
  return { rows, ...result };
}

export function connectionFreshness(lastSuccessAt, { now = Date.now(), expectedHours = 24 } = {}) {
  if (!lastSuccessAt) return 'not_connected';
  const age = Number(now) - Date.parse(lastSuccessAt);
  if (!Number.isFinite(age) || age < 0) return 'error';
  return age > expectedHours * 2 * 60 * 60 * 1000 ? 'stale' : 'connected';
}
