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
    assert.equal(data.costRules.length, 2);
    assert.equal(data.changeLog[0].action, 'DELETE');
  } finally {
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  }
});
