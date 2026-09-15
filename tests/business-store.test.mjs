import test from 'node:test';
import assert from 'node:assert/strict';
import { createBusinessStore } from '../business/data.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

test('syncProvider invokes the protected business sync function for the selected period', async () => {
  let invocation;
  const client = {
    functions: {
      async invoke(name, options) {
        invocation = { name, options };
        return { data: { ok: true, provider: 'stripe', status: 'success', imported: 4 }, error: null };
      },
    },
  };
  const store = createBusinessStore({ client });
  const result = await store.syncProvider('stripe', { from: '2026-09-01', to: '2026-09-11' });
  assert.deepEqual(invocation, {
    name: 'business-sync',
    options: { body: { provider: 'stripe', from: '2026-09-01', to: '2026-09-11' } },
  });
  assert.equal(result.imported, 4);
});

test('syncProvider preserves the server error code for actionable UI copy', async () => {
  const client = {
    functions: {
      async invoke() {
        return {
          data: null,
          error: {
            message: 'Edge Function returned a non-2xx status code',
            context: { clone: () => ({ json: async () => ({ error: 'missing_secret:GA4_PROPERTY_ID' }) }) },
          },
        };
      },
    },
  };
  const store = createBusinessStore({ client });
  await assert.rejects(
    store.syncProvider('ga4', { from: '2026-09-01', to: '2026-09-11' }),
    /missing_secret:GA4_PROPERTY_ID/,
  );
});

test('deleteCost removes every version and occurrence but keeps unrelated demo costs', async () => {
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = memoryStorage();
  try {
    const store = createBusinessStore({ demo: true });
    const impact = await store.costDeletionImpact('rule-rent');
    assert.deepEqual(impact, { ruleKey: 'rule-rent', name: 'Nájem studia', ruleCount: 1, occurrenceCount: 1, attachmentCount: 0 });
    await store.deleteCost('rule-rent');
    const data = await store.load({ from: '2026-09-01', to: '2026-09-30' });
    assert.equal(data.costRules.some((row) => row.rule_key === 'rule-rent'), false);
    assert.equal(data.occurrences.some((row) => row.rule_id === 'rule-rent'), false);
    assert.equal(data.costRules.length, 3);
    assert.equal(data.changeLog[0].action, 'DELETE');
  } finally {
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  }
});

// ---------------------------------------------------------------------
//  Regrese k auditu: načítací vrstva musí omezit období, přiznat useknutý
//  dotaz a poznat chybějící přístup k rezervacím.
// ---------------------------------------------------------------------

// Minimální dvojník PostgREST řetězu. Zaznamená filtry každého dotazu
// a vrátí řádky, které test nachystal pro danou tabulku.
function fakeClient({ tables = {}, summary = {}, calls = [] } = {}) {
  const builder = (table) => {
    const record = { table, filters: [], limit: null };
    calls.push(record);
    const chain = {
      select() { return chain; },
      order() { return chain; },
      eq(column, value) { record.filters.push(`eq:${column}=${value}`); return chain; },
      in(column, values) { record.filters.push(`in:${column}=${values.length}`); return chain; },
      gte(column, value) { record.filters.push(`gte:${column}=${value}`); return chain; },
      lte(column, value) { record.filters.push(`lte:${column}=${value}`); return chain; },
      or(expression) { record.filters.push(`or:${expression}`); return chain; },
      limit(value) { record.limit = value; return chain; },
      maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve) => resolve({ data: tables[table] ?? [], error: null }),
    };
    return chain;
  };
  return {
    from: builder,
    async rpc(name) {
      if (name === 'business_generate_calendar_costs') return { data: 0, error: null };
      return { data: summary, error: null };
    },
  };
}

const PERIOD = { from: '2026-09-01', to: '2026-09-30' };

test('regrese: rezervace se načítají podle období, ne celá historie', async () => {
  const calls = [];
  const client = fakeClient({
    calls,
    tables: {
      lessons: [{ id: 'l1', starts_at: '2026-09-10T08:00:00Z', status: 'active', capacity: 12 }],
      bookings: [{ id: 'b1', lesson_id: 'l1', payment_status: 'paid', payment_amount: 49_900, spots: 1, status: 'confirmed', email: 'a@b.cz', paid_at: '2026-09-09T10:00:00Z' }],
    },
  });
  const data = await createBusinessStore({ client }).load(PERIOD);
  const bookingCalls = calls.filter((row) => row.table === 'bookings');
  assert.equal(bookingCalls.length, 2, 'lekce období + úhrady období');
  assert.ok(bookingCalls.some((row) => row.filters.some((f) => f.startsWith('in:lesson_id'))));
  assert.ok(bookingCalls.some((row) => row.filters.includes('gte:paid_at=2026-09-01T00:00:00')));
  // Stejná rezervace ze dvou dotazů se nesmí započítat dvakrát.
  assert.equal(data.bookings.length, 1);
  // Poukazy i výskyty nákladů jsou také omezené obdobím.
  assert.ok(calls.find((row) => row.table === 'vouchers').filters.includes('gte:created_at=2026-09-01T00:00:00'));
  assert.ok(calls.find((row) => row.table === 'business_cost_occurrences').filters.some((f) => f.startsWith('or:') && f.includes('paid_on')));
});

test('regrese: useknutý dotaz se přizná místo tiché neúplnosti', async () => {
  const client = fakeClient({
    tables: {
      lessons: [{ id: 'l1', starts_at: '2026-09-10T08:00:00Z', status: 'active' }],
      // Přesně tolik řádků, kolik je limit: dál už se nevešly.
      bookings: Array.from({ length: 5000 }, (_, index) => ({ id: `b${index}`, lesson_id: 'l1', payment_status: 'none', spots: 1, status: 'confirmed', email: `h${index}@b.cz` })),
    },
  });
  const data = await createBusinessStore({ client }).load(PERIOD);
  const truncated = data.errors.filter((row) => row.kind === 'truncated');
  assert.ok(truncated.length, 'dotaz na limitu musí hlásit neúplnost');
  assert.match(truncated[0].message, /maximum 5000/);
});

test('regrese: chybějící přístup k rezervacím není nula, ale blokující chyba', async () => {
  // business_access projde, ale RLS na rezervacích vrátí prázdno bez chyby.
  const client = fakeClient({ summary: { recognized_revenue_minor: 0, paid_spots: 0, complete: false, source_access: false } });
  const data = await createBusinessStore({ client }).load(PERIOD);
  assert.equal(data.summary.sourceAccess, false);
  assert.equal(data.summary.completeness, 'partial', 'nuly bez přístupu nesmí projít jako úplná data');
  assert.ok(data.errors.some((row) => row.kind === 'blocking'), 'musí vzniknout blokující hláška');
});

test('regrese: plný přístup zůstává úplný', async () => {
  const client = fakeClient({ summary: { recognized_revenue_minor: 120_000, paid_spots: 3, complete: true, source_access: true } });
  const data = await createBusinessStore({ client }).load(PERIOD);
  assert.equal(data.summary.completeness, 'complete');
  assert.equal(data.errors.filter((row) => row.kind === 'blocking').length, 0);
});
