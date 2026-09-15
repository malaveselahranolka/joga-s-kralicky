import test from 'node:test';
import assert from 'node:assert/strict';
import {
  breakEven,
  budgetStatus,
  buyerStats,
  computeFinancials,
  forecastSeats,
  mergeLedgerEntries,
  proposeAdBudget,
  recommendChannels,
  recurrenceOccurrences,
  trafficSummary,
} from '../business/domain.js';
import { inferMapping, mapCsvRows, parseCsv } from '../business/csv.js';

const period2026 = { from: '2026-01-01', to: '2026-12-31' };

test('100 000 Kč minus 60 000 Kč gives 40 000 Kč and 15% proposal gives 6 000 Kč', () => {
  const summary = computeFinancials({
    lessons: [{ id: 'l1', starts_at: '2026-09-05T08:00:00Z', status: 'active' }],
    bookings: [{ id: 'b1', lesson_id: 'l1', status: 'confirmed', payment_status: 'paid', payment_amount: 10_000_000, paid_at: '2026-09-01T08:00:00Z', spots: 1, email: 'a@example.cz' }],
    occurrences: [{ id: 'c1', occurrence_key: 'rent:2026-09', amount_minor: 6_000_000, status: 'paid', scheduled_on: '2026-09-01', period_start: '2026-09-01', paid_on: '2026-09-01' }],
  }, { from: '2026-09-01', to: '2026-09-30' });
  assert.equal(summary.operatingResultMinor, 4_000_000);
  assert.equal(proposeAdBudget(summary.operatingResultMinor, 15, { basisKnown: true }).proposedMinor, 600_000);
  assert.equal(summary.operatingResultMinor, 4_000_000, 'proposal must not mutate actual result');
});

test('zero and negative bases produce zero proposal', () => {
  assert.equal(proposeAdBudget(0, 15, { basisKnown: true }).proposedMinor, 0);
  assert.equal(proposeAdBudget(-100_000, 15, { basisKnown: true }).proposedMinor, 0);
});

test('weekly and monthly calendar rules use real calendar dates', () => {
  const weekly = recurrenceOccurrences({ rule_key: 'weekly', version: 1, recurrence: 'weekly', valid_from: '2026-01-05', valid_to: '2026-12-31', amount_minor: 100_000 }, period2026);
  assert.equal(weekly.length, 52);
  assert.equal(weekly.reduce((sum, row) => sum + row.amount_minor, 0), 5_200_000);
  assert.equal(weekly.filter((row) => row.scheduled_on.startsWith('2026-01')).length, 4);

  const monthly = recurrenceOccurrences({ rule_key: 'monthly', version: 1, recurrence: 'monthly', valid_from: '2026-01-01', valid_to: '2026-12-31', amount_minor: 500_000 }, period2026);
  assert.equal(monthly.length, 12);
  assert.equal(monthly.reduce((sum, row) => sum + row.amount_minor, 0), 6_000_000);
});

test('day 31 and leap day clamp to last valid day', () => {
  const monthly = recurrenceOccurrences({ rule_key: 'm31', recurrence: 'monthly', valid_from: '2026-01-31', valid_to: '2026-03-31', day_of_month: 31, amount_minor: 1 }, { from: '2026-01-01', to: '2026-03-31' });
  assert.deepEqual(monthly.map((row) => row.scheduled_on), ['2026-01-31', '2026-02-28', '2026-03-31']);
  const annual = recurrenceOccurrences({ rule_key: 'leap', recurrence: 'yearly', valid_from: '2024-02-29', valid_to: '2028-12-31', month_of_year: 2, day_of_month: 29, amount_minor: 1 }, { from: '2024-01-01', to: '2028-12-31' });
  assert.deepEqual(annual.map((row) => row.scheduled_on), ['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
});

test('per-paid-seat rule reports used units', () => {
  const rows = recurrenceOccurrences({ rule_key: 'teacher', recurrence: 'per_paid_spot', valid_from: '2026-01-01', amount_minor: 20_000 }, period2026, {
    lessons: [{ id: 'l1', starts_at: '2026-03-29T00:30:00Z', status: 'active' }],
    bookings: [
      { lesson_id: 'l1', status: 'confirmed', payment_status: 'paid', spots: 3 },
      { lesson_id: 'l1', status: 'cancelled', payment_status: 'paid', spots: 2 },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].unit_count, 3);
  assert.equal(rows[0].amount_minor, 60_000);
});

test('percentage rule uses only its explicit non-circular monthly basis', () => {
  const rows = recurrenceOccurrences({
    rule_key: 'revenue-share', version: 1, recurrence: 'percentage', valid_from: '2026-01-01',
    day_of_month: 31, rate_basis_points: 1500, percentage_basis: 'recognized_revenue', amount_minor: 0,
  }, { from: '2026-01-01', to: '2026-02-28' }, { percentageBases: { '2026-01': 4_000_000 } });
  assert.equal(rows.length, 1, 'missing February basis must stay missing, not become zero');
  assert.equal(rows[0].scheduled_on, '2026-01-31');
  assert.equal(rows[0].amount_minor, 600_000);
});

test('payment, refund, fee and payout are counted exactly once', () => {
  const result = computeFinancials({
    lessons: [{ id: 'l1', starts_at: '2026-05-10T08:00:00Z', status: 'active' }],
    bookings: [{ id: 'b1', lesson_id: 'l1', status: 'confirmed', payment_status: 'paid', payment_amount: 100_000, paid_at: '2026-05-01T08:00:00Z', spots: 1, email: 'host@example.cz' }],
    ledger: [
      { id: 'r1', source: 'stripe', external_id: 're_1', kind: 'refund', amount_minor: 20_000, occurred_at: '2026-05-03T08:00:00Z' },
      { id: 'f1', source: 'stripe', external_id: 'fee_1', kind: 'fee', amount_minor: 3_000, occurred_at: '2026-05-01T08:00:00Z' },
      { id: 'p1', source: 'stripe', external_id: 'po_1', kind: 'transfer', amount_minor: 77_000, occurred_at: '2026-05-05T08:00:00Z' },
    ],
  }, { from: '2026-05-01', to: '2026-05-31' });
  assert.equal(result.cashSalesMinor, 80_000);
  assert.equal(result.cashFlowMinor, 77_000);
});

test('voucher sale and redemption remain one cash receipt', () => {
  const result = computeFinancials({
    vouchers: [{ id: 'v1', code: 'DK-1', amount: 50_000, created_at: '2026-04-01T08:00:00Z', redeemed: true, redeemed_at: '2026-05-01T08:00:00Z' }],
  }, { from: '2026-01-01', to: '2026-12-31' });
  assert.equal(result.cashSalesMinor, 50_000);
  assert.equal(result.recognizedRevenueMinor, 0);
});

test('paid booking without amount stays incomplete and is not priced from current price', () => {
  const result = computeFinancials({
    lessons: [{ id: 'l1', starts_at: '2026-05-10T08:00:00Z', status: 'active' }],
    bookings: [{ id: 'b1', lesson_id: 'l1', status: 'confirmed', payment_status: 'paid', payment_amount: null, paid_at: '2026-05-01T08:00:00Z', spots: 2, email: 'a@example.cz' }],
  }, { from: '2026-05-01', to: '2026-05-31' });
  assert.equal(result.recognizedRevenueMinor, 0);
  assert.equal(result.paidSpots, 2);
  assert.equal(result.completeness, 'partial');
});

test('budget separates remaining and overspend', () => {
  assert.deepEqual(budgetStatus(600_000, 200_000), { remainingMinor: 400_000, overspentMinor: 0 });
  assert.deepEqual(budgetStatus(600_000, 700_000), { remainingMinor: 0, overspentMinor: 100_000 });
});

test('duplicate imported movement is rejected', () => {
  const merged = mergeLedgerEntries(
    [{ source: 'csv', external_id: 'row-1' }],
    [{ source: 'csv', external_id: 'row-1' }, { source: 'csv', external_id: 'row-2' }],
  );
  assert.equal(merged.accepted.length, 1);
  assert.equal(merged.duplicates.length, 1);
});

test('period unique users are not sum of daily uniques', () => {
  const summary = trafficSummary([{ users: 10, sessions: 12, views: 20 }, { users: 10, sessions: 13, views: 21 }], null);
  assert.equal(summary.users, null);
  assert.equal(summary.sessions, 25);
  assert.equal(summary.views, 41);
});

test('group booking is one buyer and three paid spots', () => {
  assert.deepEqual(buyerStats([{ email: 'kupujici@example.cz', payment_status: 'paid', paid_at: '2026-06-01', spots: 3 }], { from: '2026-06-01', to: '2026-06-30' }), { buyers: 1, paidSpots: 3 });
  assert.deepEqual(buyerStats([{ email: 'rucne@studio', payment_status: 'paid', paid_at: '2026-06-01', spots: 3 }], { from: '2026-06-01', to: '2026-06-30' }), { buyers: 0, paidSpots: 3 });
});

test('channel recommendation never exceeds budget and weak sample stays experimental', () => {
  const weak = recommendChannels(600_000, [{ channel: 'Meta', purchases: 1, spend_minor: 20_000, revenue_minor: 100_000 }]);
  assert.equal(weak.allocations.length, 0);
  assert.equal(weak.unallocatedMinor, 600_000);
  const measured = recommendChannels(600_000, [
    { channel: 'Meta', purchases: 8, spend_minor: 100_000, revenue_minor: 300_000 },
    { channel: 'Sklik', purchases: 5, spend_minor: 80_000, revenue_minor: 160_000 },
  ]);
  assert.equal(measured.allocations.reduce((sum, row) => sum + row.amountMinor, 0), 600_000);
});

test('break-even handles non-positive contribution and capacity', () => {
  assert.equal(breakEven({ fixedCostsMinor: 100_000, priceMinor: 50_000, variableCostMinor: 50_000 }).seats, null);
  assert.deepEqual(breakEven({ fixedCostsMinor: 100_000, priceMinor: 50_000, variableCostMinor: 30_000, capacity: 4 }), { seats: 5, attainable: false, contributionMinor: 20_000 });
  assert.equal(forecastSeats(10, 50, 12), 12);
});

test('CSV parser keeps quoted delimiters and maps Czech columns', () => {
  const parsed = parseCsv('Datum;Částka;Typ;Popis;ID\n01.09.2026;1 000,50;výdaj;"Nájem; září";tx-1\n');
  assert.equal(parsed.rows[0].Popis, 'Nájem; září');
  const mapping = inferMapping(parsed.headers);
  const mapped = mapCsvRows(parsed.rows, mapping);
  assert.equal(mapped[0].valid, true);
  assert.equal(mapped[0].entry.amount_minor, 100_050);
  assert.equal(mapped[0].entry.kind, 'expense');
});
