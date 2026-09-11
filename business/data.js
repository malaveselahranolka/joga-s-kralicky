import { computeFinancials, ledgerIdentity, recurrenceOccurrences } from './domain.js';
import { createDemoData } from './demo-data.js';

const DEMO_KEY = 'jsk:business-demo:v1';

function readDemo() {
  try {
    const saved = JSON.parse(localStorage.getItem(DEMO_KEY));
    if (saved?.demoVersion === 1) return saved;
  } catch (_error) { /* obnoví se čistá ukázka */ }
  const data = createDemoData();
  localStorage.setItem(DEMO_KEY, JSON.stringify(data));
  return data;
}

function writeDemo(data) {
  localStorage.setItem(DEMO_KEY, JSON.stringify(data));
}

function camelizeRow(row) {
  return row;
}

async function queryOrError(name, promise, errors) {
  const result = await promise;
  if (result.error) {
    errors.push({ source: name, message: result.error.message, code: result.error.code });
    return [];
  }
  return result.data || [];
}

function calendarMonths(period) {
  const rows = [];
  const cursor = new Date(`${period.from.slice(0, 7)}-01T12:00:00Z`);
  const last = new Date(`${period.to.slice(0, 7)}-01T12:00:00Z`);
  while (cursor <= last) {
    const year = cursor.getUTCFullYear(), month = cursor.getUTCMonth() + 1;
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const monthEnd = new Date(Date.UTC(year, month, 0, 12)).toISOString().slice(0, 10);
    rows.push({ key, period: { from: period.from > `${key}-01` ? period.from : `${key}-01`, to: period.to < monthEnd ? period.to : monthEnd } });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return rows;
}

function contextForRule(rule, source, period) {
  const percentageBases = {};
  for (const month of calendarMonths(period)) {
    const summary = computeFinancials(source, month.period);
    percentageBases[month.key] = rule.percentage_basis === 'cash_sales'
      ? summary.cashSalesMinor
      : rule.percentage_basis === 'ad_spend'
        ? summary.adSpendMinor
        : summary.recognizedRevenueMinor;
  }
  return { lessons: source.lessons || [], bookings: source.bookings || [], percentageBases };
}

function missingDerivedOccurrences(rules, source, period) {
  const known = new Set((source.occurrences || []).map((row) => row.occurrence_key || row.key).filter(Boolean));
  const rows = [];
  for (const rule of rules.filter((row) => row.status === 'active' && ['per_lesson','per_paid_spot','percentage'].includes(row.recurrence))) {
    for (const occurrence of recurrenceOccurrences(rule, period, contextForRule(rule, source, period))) {
      if (known.has(occurrence.key)) continue;
      known.add(occurrence.key);
      rows.push({
        rule_id: rule.id, occurrence_key: occurrence.key, scheduled_on: occurrence.scheduled_on,
        period_start: occurrence.period_start, amount_minor: occurrence.amount_minor,
        currency: rule.currency || 'CZK', unit_count: occurrence.unit_count,
        source_lesson_id: occurrence.source_lesson_id, status: 'planned', paid_on: null,
        include_in_operating: rule.include_in_operating !== false,
      });
    }
  }
  return rows;
}

export function createBusinessStore({ client = null, demo = false } = {}) {
  let demoData = demo ? readDemo() : null;

  async function hasAccess() {
    if (demo) return { allowed: true, demo: true, email: 'ukazka@jogaskralicky.cz' };
    if (!client) return { allowed: false, reason: 'not_configured' };
    const { data: sessionData } = await client.auth.getSession();
    const session = sessionData?.session;
    if (!session) return { allowed: false, reason: 'signed_out' };
    const { data, error } = await client.from('business_access').select('role,active').maybeSingle();
    if (error) return { allowed: false, reason: error.code === '42P01' ? 'migration_missing' : 'forbidden', detail: error.message, session };
    return { allowed: Boolean(data?.active && data?.role === 'owner'), reason: data ? null : 'forbidden', session, email: session.user.email };
  }

  async function load(period) {
    if (demo) {
      demoData = readDemo();
      const derived = missingDerivedOccurrences(demoData.costRules, demoData, period).map((row) => ({ ...row, id: `occ-${crypto.randomUUID()}` }));
      if (derived.length) { demoData.occurrences.push(...derived); writeDemo(demoData); }
      return {
        ...demoData,
        summary: computeFinancials({
          bookings: demoData.bookings,
          lessons: demoData.lessons,
          vouchers: demoData.vouchers,
          ledger: demoData.ledger,
          occurrences: demoData.occurrences,
        }, period),
        errors: demoData.connections.filter((item) => item.status === 'error').map((item) => ({ source: item.provider, message: item.last_error })),
      };
    }

    const errors = [];
    const calendarGeneration = await client.rpc('business_generate_calendar_costs', { p_from: period.from, p_to: period.to });
    if (calendarGeneration.error) errors.push({ source: 'Kalendář nákladů', message: calendarGeneration.error.message, code: calendarGeneration.error.code });
    const [lessons, bookings, vouchers, categories, costRules, occurrences, ledger, budgets, campaigns, posts, dailyMetrics, periodMetrics, connections, goals, scenarios, notes, savedViews, settings, changeLog] = await Promise.all([
      queryOrError('Lekce', client.from('lessons').select('id,title,starts_at,status,capacity').gte('starts_at', `${period.from}T00:00:00`).lte('starts_at', `${period.to}T23:59:59`).order('starts_at'), errors),
      queryOrError('Rezervace', client.from('bookings').select('id,lesson_id,email,spots,status,payment_status,payment_amount,paid_at,created_at').order('created_at', { ascending: false }).limit(5000), errors),
      queryOrError('Poukazy', client.from('vouchers').select('id,code,amount,created_at,redeemed,redeemed_at,expires_at').order('created_at', { ascending: false }).limit(1000), errors),
      queryOrError('Kategorie nákladů', client.from('business_cost_categories').select('*').order('sort_order'), errors),
      queryOrError('Pravidla nákladů', client.from('business_cost_rules').select('*').order('created_at', { ascending: false }), errors),
      queryOrError('Náklady', client.from('business_cost_occurrences').select('*').lte('period_start', period.to).gte('scheduled_on', period.from).order('scheduled_on'), errors),
      queryOrError('Peněžní pohyby', client.from('business_ledger_entries').select('*').gte('occurred_at', `${period.from}T00:00:00`).lte('occurred_at', `${period.to}T23:59:59`).order('occurred_at', { ascending: false }).limit(5000), errors),
      queryOrError('Rozpočty', client.from('business_budgets').select('*').lte('period_start', period.to).gte('period_end', period.from).order('created_at', { ascending: false }), errors),
      queryOrError('Kampaně', client.from('business_campaigns').select('*').order('starts_on', { ascending: false }), errors),
      queryOrError('Sociální obsah', client.from('business_social_posts').select('*').order('published_at', { ascending: false }).limit(500), errors),
      queryOrError('Denní návštěvnost', client.from('business_daily_metrics').select('*').gte('metric_date', period.from).lte('metric_date', period.to).order('metric_date'), errors),
      queryOrError('Unikátní metriky období', client.from('business_period_metrics').select('*').eq('period_start', period.from).eq('period_end', period.to), errors),
      queryOrError('Zdroje dat', client.from('business_connections').select('*').order('provider'), errors),
      queryOrError('Cíle', client.from('business_goals').select('*').lte('period_start', period.to).gte('period_end', period.from), errors),
      queryOrError('Scénáře', client.from('business_scenarios').select('*').order('updated_at', { ascending: false }), errors),
      queryOrError('Poznámky', client.from('business_notes').select('*').gte('note_date', period.from).lte('note_date', period.to).order('note_date', { ascending: false }), errors),
      queryOrError('Uložené pohledy', client.from('business_saved_views').select('*').order('created_at', { ascending: false }), errors),
      queryOrError('Nastavení', client.from('business_settings').select('*').order('key'), errors),
      queryOrError('Deník změn', client.from('business_change_log').select('*').order('changed_at', { ascending: false }).limit(200), errors),
    ]);

    const source = { lessons, bookings, vouchers, ledger, occurrences };
    const derived = missingDerivedOccurrences(costRules, source, period);
    if (derived.length) {
      const { data: inserted, error } = await client.from('business_cost_occurrences').upsert(derived, { onConflict: 'occurrence_key', ignoreDuplicates: true }).select();
      if (error) errors.push({ source: 'Odvozené náklady', message: error.message, code: error.code });
      else occurrences.push(...(inserted || []));
    }

    const localSummary = computeFinancials({ bookings, lessons, vouchers, ledger, occurrences }, period);
    const rpc = await client.rpc('business_period_summary', { p_from: period.from, p_to: period.to });
    if (rpc.error) errors.push({ source: 'Souhrnný výpočet', message: rpc.error.message, code: rpc.error.code });
    const rawSummary = rpc.data || {};
    const summary = rpc.error ? localSummary : {
      recognizedRevenueMinor: Number(rawSummary.recognized_revenue_minor || 0),
      cashSalesMinor: Number(rawSummary.cash_sales_minor || 0),
      operatingCostsMinor: Number(rawSummary.operating_costs_minor || 0),
      operatingResultMinor: Number(rawSummary.operating_result_minor || 0),
      cashFlowMinor: Number(rawSummary.cash_flow_minor || 0),
      paidSpots: Number(rawSummary.paid_spots || 0),
      voucherSalesMinor: Number(rawSummary.voucher_sales_minor || 0),
      refundsMinor: Number(rawSummary.refunds_minor || 0),
      feesMinor: Number(rawSummary.fees_minor || 0),
      adSpendMinor: Number(rawSummary.ad_spend_minor || 0),
      missingPaymentAmounts: Number(rawSummary.missing_payment_amounts || 0),
      completeness: rawSummary.complete ? 'complete' : 'partial',
      buyerCount: localSummary.buyerCount,
    };

    return { lessons, bookings, vouchers, categories, costRules, occurrences, ledger, budgets, campaigns, posts, dailyMetrics, periodMetrics, connections, goals, scenarios, notes, savedViews, settings, changeLog, summary, errors };
  }

  async function saveCost(rule, period, context, attachmentFile = null) {
    if (demo) {
      const id = rule.id || `rule-${crypto.randomUUID()}`;
      const saved = { ...rule, attachment_path: attachmentFile ? `demo/${attachmentFile.name}` : rule.attachment_path, id, rule_key: rule.rule_key || id, version: rule.version || 1, status: 'active' };
      if (saved.version > 1) {
        const previousDay = new Date(`${saved.valid_from}T12:00:00Z`);
        previousDay.setUTCDate(previousDay.getUTCDate() - 1);
        for (const previous of demoData.costRules.filter((item) => item.rule_key === saved.rule_key && item.status === 'active')) {
          previous.status = 'archived';
          previous.valid_to = previousDay.toISOString().slice(0, 10);
        }
      }
      demoData.costRules.unshift(saved);
      const generated = recurrenceOccurrences(saved, period, contextForRule(saved, context, period)).map((row) => ({ ...row, occurrence_key: row.key, id: `occ-${crypto.randomUUID()}`, rule_id: id, currency: saved.currency || 'CZK', status: rule.paid ? 'paid' : 'planned', paid_on: rule.paid ? row.scheduled_on : null, include_in_operating: saved.include_in_operating !== false }));
      demoData.occurrences.push(...generated);
      demoData.changeLog.unshift({ id: Date.now(), table_name: 'business_cost_rules', row_id: id, action: 'INSERT', changed_at: new Date().toISOString() });
      writeDemo(demoData);
      return saved;
    }
    const { paid, ...payload } = rule;
    let uploadedPath = null;
    if (attachmentFile) {
      if (attachmentFile.size > 10 * 1024 * 1024) throw new Error('Doklad je větší než 10 MB.');
      if (!['application/pdf','image/jpeg','image/png','image/webp'].includes(attachmentFile.type)) throw new Error('Doklad musí být PDF, JPG, PNG nebo WebP.');
      const safeName = attachmentFile.name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-100);
      uploadedPath = `costs/${payload.rule_key}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await client.storage.from('business-attachments').upload(uploadedPath, attachmentFile, { upsert: false, contentType: attachmentFile.type });
      if (uploadError) throw uploadError;
      payload.attachment_path = uploadedPath;
    }
    const { data: saved, error } = await client.from('business_cost_rules').insert(payload).select().single();
    if (error) {
      if (uploadedPath) await client.storage.from('business-attachments').remove([uploadedPath]);
      throw error;
    }
    const generated = recurrenceOccurrences(saved, period, contextForRule(saved, context, period)).map((row) => ({
      rule_id: saved.id,
      occurrence_key: row.key,
      scheduled_on: row.scheduled_on,
      period_start: row.period_start,
      amount_minor: row.amount_minor,
      currency: saved.currency,
      unit_count: row.unit_count,
      source_lesson_id: row.source_lesson_id,
      status: paid ? 'paid' : 'planned',
      paid_on: paid ? row.scheduled_on : null,
      include_in_operating: saved.include_in_operating,
    }));
    if (generated.length) {
      const { error: occurrenceError } = await client.from('business_cost_occurrences').upsert(generated, { onConflict: 'occurrence_key', ignoreDuplicates: true });
      if (occurrenceError) throw occurrenceError;
    }
    return saved;
  }

  async function attachmentUrl(path) {
    if (demo) throw new Error('Ukázkový doklad nemá skutečný soubor.');
    if (!path) throw new Error('Doklad chybí.');
    const { data, error } = await client.storage.from('business-attachments').createSignedUrl(path, 60);
    if (error) throw error;
    return data.signedUrl;
  }

  async function markOccurrencePaid(id, paid) {
    const values = paid ? { status: 'paid', paid_on: new Date().toISOString().slice(0, 10) } : { status: 'planned', paid_on: null };
    if (demo) {
      const row = demoData.occurrences.find((item) => item.id === id);
      if (row) Object.assign(row, values);
      writeDemo(demoData);
      return;
    }
    const { error } = await client.from('business_cost_occurrences').update(values).eq('id', id);
    if (error) throw error;
  }

  async function saveRecord(collection, table, row) {
    if (demo) {
      const saved = { ...row, id: row.id || `${collection}-${crypto.randomUUID()}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      demoData[collection].unshift(saved);
      writeDemo(demoData);
      return saved;
    }
    const { data, error } = await client.from(table).insert(row).select().single();
    if (error) throw error;
    return camelizeRow(data);
  }

  async function importLedger(rows, meta = {}) {
    if (demo) {
      const known = new Set(demoData.ledger.map(ledgerIdentity).filter(Boolean));
      let imported = 0;
      let duplicates = 0;
      for (const row of rows) {
        const key = ledgerIdentity(row);
        if (key && known.has(key)) duplicates += 1;
        else {
          demoData.ledger.unshift({ ...row, id: `ledger-${crypto.randomUUID()}` });
          if (key) known.add(key);
          imported += 1;
        }
      }
      writeDemo(demoData);
      return { imported, duplicates, failed: 0 };
    }
    const { data: batch, error: batchError } = await client.from('business_import_batches').insert({ source: meta.source || 'csv', file_name: meta.fileName, status: 'importing', row_count: rows.length, mapping: meta.mapping || {} }).select().single();
    if (batchError) throw batchError;
    let imported = 0;
    let duplicates = 0;
    let failed = 0;
    for (const [index, row] of rows.entries()) {
      const payload = { ...row, import_batch_id: batch.id };
      const { data, error } = await client.from('business_ledger_entries').insert(payload).select('id').single();
      let status = 'imported';
      if (error?.code === '23505') { duplicates += 1; status = 'duplicate'; }
      else if (error) { failed += 1; status = 'failed'; }
      else imported += 1;
      await client.from('business_import_rows').insert({ batch_id: batch.id, row_number: index + 1, status, raw_data: row, error: error?.message || null, ledger_entry_id: data?.id || null });
    }
    await client.from('business_import_batches').update({ status: failed ? 'partial' : 'finished', imported_count: imported, duplicate_count: duplicates, failed_count: failed, finished_at: new Date().toISOString() }).eq('id', batch.id);
    return { imported, duplicates, failed };
  }

  function resetDemo() {
    demoData = createDemoData();
    writeDemo(demoData);
  }

  async function saveSetting(key, value) {
    if (demo) {
      const existing = demoData.settings.find((item) => item.key === key);
      if (existing) Object.assign(existing, { value, updated_at: new Date().toISOString() });
      else demoData.settings.push({ key, value, updated_at: new Date().toISOString() });
      writeDemo(demoData);
      return;
    }
    const { error } = await client.from('business_settings').upsert({ key, value, updated_at: new Date().toISOString() });
    if (error) throw error;
  }

  return {
    demo,
    hasAccess,
    load,
    saveCost,
    markOccurrencePaid,
    importLedger,
    saveBudget: (row) => saveRecord('budgets', 'business_budgets', row),
    saveGoal: (row) => saveRecord('goals', 'business_goals', row),
    saveScenario: (row) => saveRecord('scenarios', 'business_scenarios', row),
    saveNote: (row) => saveRecord('notes', 'business_notes', row),
    saveView: (row) => saveRecord('savedViews', 'business_saved_views', row),
    resetDemo,
    saveSetting,
    attachmentUrl,
  };
}
