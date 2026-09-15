const DEMO_VERSION = 1;

function iso(day, hour = 16) {
  return `2026-09-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00+02:00`;
}

export function createDemoData() {
  const lessons = Array.from({ length: 8 }, (_, index) => ({
    id: `lesson-${index + 1}`,
    title: index % 3 === 0 ? 'Ranní jóga s králíčky' : 'Hatha s králíčky',
    starts_at: iso(2 + index * 3, index % 2 ? 18 : 9),
    status: 'active',
    capacity: 12,
  }));
  const bookings = [];
  let bookingIndex = 0;
  for (const [lessonIndex, lesson] of lessons.entries()) {
    const count = lessonIndex < 4 ? 5 + lessonIndex : 3;
    for (let index = 0; index < count; index += 1) {
      bookingIndex += 1;
      const spots = index === 1 && lessonIndex % 2 === 0 ? 2 : 1;
      bookings.push({
        id: `booking-${bookingIndex}`,
        lesson_id: lesson.id,
        email: `host${bookingIndex}@example.cz`,
        spots,
        status: 'confirmed',
        payment_status: lessonIndex === 3 && index === 0 ? 'pending' : 'paid',
        payment_amount: 49_900 * spots,
        paid_at: iso(Math.max(1, 1 + lessonIndex * 3), 10),
        created_at: iso(Math.max(1, lessonIndex * 3), 9),
      });
    }
  }

  const categories = ['Nájem','Lektoři','Úklid','Péče o králíčky','Materiál','Software','Reklama','Vybavení','Ostatní']
    .map((name, index) => ({ id: `category-${index + 1}`, name, active: true, sort_order: (index + 1) * 10 }));

  const costRules = [
    { id: 'rule-rent', rule_key: 'rule-rent', version: 1, name: 'Nájem studia', category_id: 'category-1', amount_minor: 700_000, recurrence: 'monthly', valid_from: '2026-01-01', day_of_month: 1, cost_class: 'operation', include_in_operating: true, status: 'active' },
    { id: 'rule-clean', rule_key: 'rule-clean', version: 1, name: 'Úklid', category_id: 'category-3', amount_minor: 120_000, recurrence: 'monthly', valid_from: '2026-01-01', day_of_month: 5, cost_class: 'operation', include_in_operating: true, status: 'active' },
    { id: 'rule-rabbits', rule_key: 'rule-rabbits', version: 1, name: 'Péče o králíčky', category_id: 'category-4', amount_minor: 180_000, recurrence: 'monthly', valid_from: '2026-01-01', day_of_month: 7, cost_class: 'operation', include_in_operating: true, status: 'active' },
  ];

  const occurrences = costRules.map((rule) => ({
    id: `occ-${rule.id}`,
    rule_id: rule.id,
    occurrence_key: `${rule.rule_key}:1:2026-09`,
    scheduled_on: `2026-09-${String(rule.day_of_month).padStart(2, '0')}`,
    period_start: '2026-09-01',
    paid_on: `2026-09-${String(rule.day_of_month).padStart(2, '0')}`,
    amount_minor: rule.amount_minor,
    currency: 'CZK',
    unit_count: 1,
    status: 'paid',
    include_in_operating: true,
  }));

  return {
    demoVersion: DEMO_VERSION,
    lessons,
    bookings,
    vouchers: [
      { id: 'voucher-1', code: 'DK-DEMO001', amount: 49_900, created_at: iso(4), redeemed: false, expires_at: '2027-09-04T16:00:00+02:00' },
      { id: 'voucher-2', code: 'DK-DEMO002', amount: 49_900, created_at: iso(8), redeemed: true, redeemed_at: iso(10), expires_at: '2027-09-08T16:00:00+02:00' },
    ],
    categories,
    costRules,
    occurrences,
    ledger: [
      { id: 'ledger-fee', source: 'stripe', external_id: 'fee_demo', occurred_at: iso(6), amount_minor: 59_000, currency: 'CZK', kind: 'fee', status: 'posted', note: 'Souhrn poplatků Stripe' },
      { id: 'ledger-refund', source: 'stripe', external_id: 'refund_demo', occurred_at: iso(9), amount_minor: 49_900, currency: 'CZK', kind: 'refund', status: 'posted', note: 'Vrácená platba za zrušenou lekci' },
      { id: 'ledger-ad', source: 'meta', external_id: 'ad_demo', occurred_at: iso(10), amount_minor: 200_000, currency: 'CZK', kind: 'ad_spend', status: 'posted', campaign_id: 'campaign-meta', note: 'Spotřeba reklamy 1.–10. září' },
    ],
    budgets: [{ id: 'budget-1', budget_key: 'budget-sep', version: 1, kind: 'advertising', period_start: '2026-09-01', period_end: '2026-09-30', basis_period_start: '2026-08-01', basis_period_end: '2026-08-31', basis_result_minor: 1_800_000, rate_basis_points: 1500, proposed_minor: 270_000, accepted_minor: 300_000, carryover_minor: 0, status: 'accepted' }],
    campaigns: [
      { id: 'campaign-meta', name: 'Zářijová videa', channel: 'Meta', starts_on: '2026-09-01', ends_on: '2026-09-30', status: 'active', spend_minor: 200_000, revenue_minor: 648_700, purchases: 13 },
      { id: 'campaign-sklik', name: 'Hledání Ostrava', channel: 'Sklik', starts_on: '2026-09-01', ends_on: '2026-09-30', status: 'active', spend_minor: 80_000, revenue_minor: 249_500, purchases: 5 },
    ],
    posts: [
      { id: 'post-1', channel: 'Instagram', published_at: iso(2, 19), format: 'Reel', topic_tags: ['králíčci','zákulisí'], paid_support: true, metrics: { views: 12800, saves: 94, interactions: 643 }, measurement_window_hours: 168 },
      { id: 'post-2', channel: 'Facebook', published_at: iso(5, 18), format: 'Video', topic_tags: ['lekce','atmosféra'], paid_support: false, metrics: { views: 3400, saves: 21, interactions: 184 }, measurement_window_hours: 168 },
    ],
    dailyMetrics: Array.from({ length: 10 }, (_, index) => ({ id: `metric-${index + 1}`, source: 'vercel', metric_date: `2026-09-${String(index + 1).padStart(2, '0')}`, dimension_key: 'public-only', complete: true, metrics: { sessions: 52 + index * 3, views: 78 + index * 5 } })),
    periodMetrics: [{ id: 'period-1', source: 'ga4', period_start: '2026-09-01', period_end: '2026-09-10', dimension_key: 'public-only', complete: true, metrics: { users: 417, sessions: 655, views: 1015 }, methodology: 'Agregace za celé období; interní cesty vyloučené.' }],
    connections: [
      { id: 'connection-supabase', provider: 'supabase', status: 'connected', external_account_label: 'Rezervace', last_success_at: iso(11, 8) },
      { id: 'connection-ga4', provider: 'ga4', status: 'connected', external_account_label: 'Veřejný web', last_success_at: iso(11, 7) },
      { id: 'connection-vercel', provider: 'vercel', status: 'stale', external_account_label: 'Web Analytics', last_success_at: iso(8, 7), last_error: 'Ukázka zastaralého zdroje' },
      { id: 'connection-meta', provider: 'meta_ads', status: 'not_connected' },
      { id: 'connection-sklik', provider: 'sklik', status: 'not_connected' },
    ],
    goals: [{ id: 'goal-1', metric: 'operating_result', period_start: '2026-09-01', period_end: '2026-09-30', target_minor: 1_200_000, note: 'Měsíční provozní rezerva' }],
    scenarios: [{ id: 'scenario-1', name: 'O jednu lekci týdně více', period_start: '2026-10-01', period_end: '2026-10-31', assumptions: { extra_lessons: 4, paid_spots_per_lesson: 7, price_minor: 49900 }, result: { revenue_minor: 1_397_200 } }],
    notes: [{ id: 'note-1', note_date: '2026-09-03', note_type: 'decision', body: 'Spuštěna menší kampaň na zářijové termíny.', campaign_id: 'campaign-meta' }],
    savedViews: [{ id: 'view-1', name: 'Měsíční finance', view_key: 'finance', filters: { preset: 'month' } }],
    settings: [{ key: 'advertising_budget_rate', value: { percent: 15 }, updated_at: iso(1) }],
    changeLog: [],
  };
}
