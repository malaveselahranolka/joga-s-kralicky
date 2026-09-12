import test from 'node:test';
import assert from 'node:assert/strict';
import {
  connectionFreshness,
  isPublicTrafficPath,
  mapStripeMovement,
  metricEnvelope,
  normalizeMetric,
  reconcileExternalRows,
} from '../business/integration-contracts.js';
import {
  assertPeriod,
  ga4Bodies,
  googleAdsQuery,
  mapGa4Period,
  mapStripeBalance,
  mapVercelPeriod,
  metaInsightsUrl,
  safeZapierPayload,
  sklikCalls,
  stripeBalanceUrl,
  tiktokReportUrl,
  vercelUrls,
} from '../supabase/functions/_shared/business-sync-contracts.js';

test('internal, business, preview and test traffic is excluded', () => {
  assert.equal(isPublicTrafficPath('/rezervace.html'), true);
  for (const path of ['/admin.html', '/business', '/business.html', '/vstupenka.html', '/studio/desk']) assert.equal(isPublicTrafficPath(path), false);
  assert.equal(isPublicTrafficPath('/', { preview: true }), false);
  assert.equal(isPublicTrafficPath('/', { test: true }), false);
});

test('zero remains zero while unavailable provider metric remains null', () => {
  assert.equal(normalizeMetric(0), 0);
  assert.equal(normalizeMetric(''), null);
  assert.equal(normalizeMetric('n/a'), null);
});

test('period users reject a sum of daily uniques', () => {
  assert.throws(() => metricEnvelope({ provider: 'ga4', from: '2026-09-01', to: '2026-09-30', metrics: { users: 20 }, method: 'daily_unique_sum' }), /cannot be a sum/);
  const value = metricEnvelope({ provider: 'ga4', from: '2026-09-01', to: '2026-09-30', metrics: { users: 10, sessions: 20 } });
  assert.equal(value.metrics.users, 10);
});

test('Stripe payout is a transfer and amounts keep minor units', () => {
  const row = mapStripeMovement({ id: 'txn_1', created: 1_788_825_600, amount: 77_000, currency: 'czk', type: 'payout', status: 'available' });
  assert.equal(row.kind, 'transfer');
  assert.equal(row.amount_minor, 77_000);
  assert.equal(row.external_id, 'txn_1');
});

test('duplicate and older external event cannot overwrite newest state', () => {
  const existing = [{ id: 'local-1', source: 'stripe', external_id: 'txn_1', status: 'posted', amount_minor: 1000, source_updated_at: '2026-09-10T10:00:00Z' }];
  const incoming = [
    { source: 'stripe', external_id: 'txn_1', status: 'pending', amount_minor: 1000, source_updated_at: '2026-09-09T10:00:00Z' },
    { source: 'stripe', external_id: 'txn_1', status: 'posted', amount_minor: 800, source_updated_at: '2026-09-11T10:00:00Z' },
    { source: 'stripe', external_id: 'txn_2', status: 'posted', amount_minor: 500, source_updated_at: '2026-09-11T10:00:00Z' },
  ];
  const result = reconcileExternalRows(existing, incoming);
  assert.deepEqual({ inserted: result.inserted, updated: result.updated, stale: result.stale }, { inserted: 1, updated: 1, stale: 1 });
  assert.equal(result.rows.find((row) => row.external_id === 'txn_1').amount_minor, 800);
  assert.equal(result.rows.find((row) => row.external_id === 'txn_1').id, 'local-1');
});

test('connection freshness separates missing, current and stale', () => {
  const now = Date.parse('2026-09-11T12:00:00Z');
  assert.equal(connectionFreshness(null, { now }), 'not_connected');
  assert.equal(connectionFreshness('2026-09-11T00:00:00Z', { now }), 'connected');
  assert.equal(connectionFreshness('2026-09-08T00:00:00Z', { now }), 'stale');
});

test('server request builders use bounded periods and read-only reporting endpoints', () => {
  assert.deepEqual(assertPeriod('2026-09-01', '2026-09-30'), { start: 1788220800000, end: 1790812799000 });
  assert.throws(() => assertPeriod('2025-01-01', '2026-09-30'), /invalid_period/);
  assert.match(stripeBalanceUrl('2026-09-01', '2026-09-30', 'txn_1'), /balance_transactions/);
  assert.match(stripeBalanceUrl('2026-09-01', '2026-09-30', 'txn_1'), /starting_after=txn_1/);
  assert.equal(ga4Bodies('2026-09-01', '2026-09-30').period.dimensions, undefined);
  assert.match(vercelUrls('2026-09-01', '2026-09-30', 'prj_x', 'team_x').daily, /visits%2Faggregate|visits\/aggregate/);
  assert.match(vercelUrls('2026-09-01', '2026-09-30', 'prj_x', 'team_x').daily, /limit=100/);
  assert.match(metaInsightsUrl('2026-09-01', '2026-09-30', 'act_1'), /\/insights\?/);
  assert.match(tiktokReportUrl('2026-09-01', '2026-09-30', '1'), /report\/integrated\/get/);
  assert.match(googleAdsQuery('2026-09-01', '2026-09-30'), /campaign\.status != 'REMOVED'/);
  assert.equal(sklikCalls('2026-09-01', '2026-09-30', 'secret').login.method, 'client.loginByToken');
  assert.equal(sklikCalls('2026-09-01', '2026-09-30', 'secret').login.params, 'secret');
});

test('Zapier summary strips personal and unknown fields', () => {
  const payload = safeZapierPayload('weekly_summary', { from: '2026-09-01', to: '2026-09-07' }, { revenue_minor: 10000, paid_spots: 4, email: 'private@example.test', arbitrary: 1 });
  assert.deepEqual(payload.summary, { revenue_minor: 10000, paid_spots: 4 });
  assert.equal('email' in payload.summary, false);
});

test('provider mappers preserve period uniques and Stripe signs', () => {
  const ga = mapGa4Period({ rows: [{ metricValues: [{ value: '10' }, { value: '21' }, { value: '40' }] }] }, '2026-09-01', '2026-09-30');
  assert.deepEqual(ga.metrics, { users: 10, sessions: 21, views: 40 });
  const vercel = mapVercelPeriod({ data: { visitors: 12, pageviews: 35 } }, '2026-09-01', '2026-09-30');
  assert.deepEqual(vercel.metrics, { users: 12, views: 35 });
  const refund = mapStripeBalance({ id: 'txn_refund', created: 1788220800, amount: -20000, currency: 'czk', type: 'refund', status: 'available' });
  assert.equal(refund.kind, 'refund');
  assert.equal(refund.amount_minor, 20000);
});
