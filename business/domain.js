const PRAGUE = 'Europe/Prague';

export const money = new Intl.NumberFormat('cs-CZ', {
  style: 'currency',
  currency: 'CZK',
  maximumFractionDigits: 0,
});

export const integer = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 });

export function formatMoney(minor) {
  return Number.isFinite(Number(minor)) ? money.format(Number(minor) / 100) : '—';
}

export function parseMoneyToMinor(value) {
  const normalized = String(value ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!normalized || !/^-?\d+(?:\.\d{0,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

export function pragueDate(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PRAGUE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function dateFromIso(date) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function isoFromDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = dateFromIso(date);
  next.setUTCDate(next.getUTCDate() + days);
  return isoFromDate(next);
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
}

function clampCalendarDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(day, daysInMonth(year, month))).padStart(2, '0')}`;
}

export function inPeriod(value, period) {
  const date = pragueDate(value);
  return Boolean(date && date >= period.from && date <= period.to);
}

function inRuleValidity(date, rule) {
  return date >= rule.valid_from && (!rule.valid_to || date <= rule.valid_to);
}

function pushOccurrence(rows, rule, date, suffix = date, unitCount = 1, sourceLessonId = null, amountMinor = null) {
  if (!inRuleValidity(date, rule)) return;
  rows.push({
    key: `${rule.rule_key || rule.id}:${rule.version || 1}:${suffix}`,
    scheduled_on: date,
    period_start: date,
    unit_count: unitCount,
    amount_minor: amountMinor ?? Math.round(Number(rule.amount_minor || 0) * unitCount),
    source_lesson_id: sourceLessonId,
  });
}

export function recurrenceOccurrences(rule, period, context = {}) {
  if (!rule?.valid_from || !period?.from || !period?.to) return [];
  const start = rule.valid_from > period.from ? rule.valid_from : period.from;
  const end = rule.valid_to && rule.valid_to < period.to ? rule.valid_to : period.to;
  if (start > end) return [];
  const rows = [];
  const recurrence = rule.recurrence || 'once';

  if (recurrence === 'once') {
    if (rule.valid_from >= start && rule.valid_from <= end) pushOccurrence(rows, rule, rule.valid_from);
    return rows;
  }

  if (recurrence === 'weekly') {
    let cursor = rule.valid_from;
    while (cursor < start) cursor = addDays(cursor, 7);
    while (cursor <= end) {
      pushOccurrence(rows, rule, cursor);
      cursor = addDays(cursor, 7);
    }
    return rows;
  }

  if (recurrence === 'monthly' || recurrence === 'percentage') {
    const origin = dateFromIso(rule.valid_from);
    const targetDay = Number(rule.day_of_month) || origin.getUTCDate();
    let cursor = dateFromIso(`${start.slice(0, 7)}-01`);
    const lastMonth = dateFromIso(`${end.slice(0, 7)}-01`);
    while (cursor <= lastMonth) {
      const year = cursor.getUTCFullYear();
      const month = cursor.getUTCMonth() + 1;
      const date = clampCalendarDate(year, month, targetDay);
      if (date >= start && date <= end) {
        if (recurrence === 'monthly') {
          pushOccurrence(rows, rule, date);
        } else {
          const monthKey = date.slice(0, 7);
          const base = context.percentageBases?.[monthKey];
          if (Number.isFinite(base)) {
            const calculated = Math.round(Math.max(0, base) * Number(rule.rate_basis_points || 0) / 10000);
            pushOccurrence(rows, rule, date, monthKey, 1, null, calculated);
          }
        }
      }
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return rows;
  }

  if (recurrence === 'yearly') {
    const origin = dateFromIso(rule.valid_from);
    const month = Number(rule.month_of_year) || origin.getUTCMonth() + 1;
    const day = Number(rule.day_of_month) || origin.getUTCDate();
    for (let year = Number(start.slice(0, 4)); year <= Number(end.slice(0, 4)); year += 1) {
      const date = clampCalendarDate(year, month, day);
      if (date >= start && date <= end) pushOccurrence(rows, rule, date);
    }
    return rows;
  }

  const lessons = (context.lessons || []).filter((lesson) => lesson.status !== 'cancelled' && inPeriod(lesson.starts_at, { from: start, to: end }));
  if (recurrence === 'per_lesson') {
    for (const lesson of lessons) {
      pushOccurrence(rows, rule, pragueDate(lesson.starts_at), `lesson:${lesson.id}`, 1, lesson.id);
    }
    return rows;
  }

  if (recurrence === 'per_paid_spot') {
    for (const lesson of lessons) {
      const spots = (context.bookings || [])
        .filter((booking) => booking.lesson_id === lesson.id && booking.status !== 'cancelled' && booking.payment_status === 'paid')
        .reduce((sum, booking) => sum + Number(booking.spots || 0), 0);
      if (spots > 0) pushOccurrence(rows, rule, pragueDate(lesson.starts_at), `lesson:${lesson.id}`, spots, lesson.id);
    }
  }
  return rows;
}

function uniqueBy(rows, keyFn) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = keyFn(row);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function ledgerIdentity(row) {
  if (row.source && row.external_id) return `${row.source}:${row.external_id}`;
  return row.import_fingerprint || row.id || null;
}

export function mergeLedgerEntries(existing, incoming) {
  const known = new Set(existing.map(ledgerIdentity).filter(Boolean));
  const accepted = [];
  const duplicates = [];
  for (const row of incoming) {
    const key = ledgerIdentity(row);
    if (key && known.has(key)) duplicates.push(row);
    else {
      accepted.push(row);
      if (key) known.add(key);
    }
  }
  return { accepted, duplicates };
}

export function normalizedBuyerEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!value || value === 'rucne@studio' || value.startsWith('rucne+') || value.endsWith('@studio.local')) return null;
  return value;
}

export function buyerStats(bookings, period) {
  const paid = bookings.filter((booking) => booking.payment_status === 'paid' && inPeriod(booking.paid_at || booking.created_at, period));
  const buyers = new Set(paid.map((booking) => normalizedBuyerEmail(booking.email)).filter(Boolean));
  const spots = paid.reduce((sum, booking) => sum + Number(booking.spots || 0), 0);
  return { buyers: buyers.size, paidSpots: spots };
}

export function computeFinancials({ bookings = [], lessons = [], vouchers = [], ledger = [], occurrences = [] }, period) {
  const lessonById = new Map(lessons.map((lesson) => [lesson.id, lesson]));
  const paidBookings = bookings.filter((booking) => booking.status !== 'cancelled' && booking.payment_status === 'paid');
  let recognizedRevenueMinor = 0;
  let bookingCashMinor = 0;
  let paidSpots = 0;
  let missingPaymentAmounts = 0;

  for (const booking of paidBookings) {
    const hasAmount = booking.payment_amount !== null && booking.payment_amount !== undefined && booking.payment_amount !== '';
    const amount = hasAmount ? Number(booking.payment_amount) : NaN;
    const lesson = lessonById.get(booking.lesson_id);
    if (lesson && inPeriod(lesson.starts_at, period)) {
      paidSpots += Number(booking.spots || 0);
      if (Number.isFinite(amount)) recognizedRevenueMinor += amount;
      else missingPaymentAmounts += 1;
    }
    if (inPeriod(booking.paid_at, period)) {
      if (Number.isFinite(amount)) bookingCashMinor += amount;
      else missingPaymentAmounts += 1;
    }
  }

  const voucherRows = uniqueBy(vouchers, (voucher) => voucher.id || voucher.code);
  const voucherSalesMinor = voucherRows
    .filter((voucher) => inPeriod(voucher.created_at, period) && Number.isFinite(Number(voucher.amount)))
    .reduce((sum, voucher) => sum + Number(voucher.amount), 0);

  const actualOccurrences = uniqueBy(
    occurrences.filter((row) => row.status === 'paid'),
    (row) => row.occurrence_key || row.id,
  );
  const occurrenceOperating = actualOccurrences
    .filter((row) => row.include_in_operating !== false && inPeriod(row.period_start || row.scheduled_on, period))
    .reduce((sum, row) => sum + Number(row.amount_minor || 0), 0);
  const occurrenceCash = actualOccurrences
    .filter((row) => inPeriod(row.paid_on || row.scheduled_on, period))
    .reduce((sum, row) => sum + Number(row.amount_minor || 0), 0);

  let otherIncomeMinor = 0;
  let refundsMinor = 0;
  let feesMinor = 0;
  let adSpendMinor = 0;
  let otherExpensesMinor = 0;
  for (const entry of uniqueBy(ledger, ledgerIdentity)) {
    if (!inPeriod(entry.occurred_at, period) || entry.status === 'void') continue;
    const amount = Math.abs(Number(entry.amount_minor || 0));
    if (entry.kind === 'transfer') continue;
    if (entry.kind === 'income' && !entry.booking_id && !entry.voucher_id) otherIncomeMinor += amount;
    if (entry.kind === 'refund') refundsMinor += amount;
    if (entry.cost_occurrence_id) continue;
    if (entry.kind === 'fee') feesMinor += amount;
    if (entry.kind === 'ad_spend') adSpendMinor += amount;
    if (entry.kind === 'expense') otherExpensesMinor += amount;
  }

  const cashSalesMinor = bookingCashMinor + voucherSalesMinor + otherIncomeMinor - refundsMinor;
  const operatingCostsMinor = occurrenceOperating + feesMinor + adSpendMinor + otherExpensesMinor;
  const operatingResultMinor = recognizedRevenueMinor - refundsMinor - operatingCostsMinor;
  const cashFlowMinor = cashSalesMinor - occurrenceCash - feesMinor - adSpendMinor - otherExpensesMinor;
  const buyers = new Set(paidBookings
    .filter((booking) => inPeriod(booking.paid_at || booking.created_at, period))
    .map((booking) => normalizedBuyerEmail(booking.email)).filter(Boolean));

  return {
    recognizedRevenueMinor,
    cashSalesMinor,
    operatingCostsMinor,
    operatingResultMinor,
    cashFlowMinor,
    paidSpots,
    buyerCount: buyers.size,
    voucherSalesMinor,
    refundsMinor,
    feesMinor,
    adSpendMinor,
    missingPaymentAmounts,
    completeness: missingPaymentAmounts ? 'partial' : 'complete',
  };
}

export function proposeAdBudget(operatingResultMinor, ratePercent, options = {}) {
  if (!options.basisKnown || !Number.isFinite(Number(operatingResultMinor))) return { proposedMinor: null, reason: 'unknown_basis' };
  let proposedMinor = Math.round(Math.max(0, Number(operatingResultMinor)) * Math.max(0, Number(ratePercent)) / 100);
  if (Number.isFinite(Number(options.capMinor))) proposedMinor = Math.min(proposedMinor, Number(options.capMinor));
  if (Number.isFinite(Number(options.cashLimitMinor))) proposedMinor = Math.min(proposedMinor, Math.max(0, Number(options.cashLimitMinor)));
  return { proposedMinor, reason: operatingResultMinor <= 0 ? 'non_positive_basis' : 'calculated' };
}

export function budgetStatus(acceptedMinor, spentMinor, commitmentsMinor = 0) {
  const delta = Number(acceptedMinor || 0) - Number(spentMinor || 0) - Number(commitmentsMinor || 0);
  return { remainingMinor: Math.max(0, delta), overspentMinor: Math.max(0, -delta) };
}

export function breakEven({ fixedCostsMinor, priceMinor, variableCostMinor, capacity }) {
  const contribution = Number(priceMinor) - Number(variableCostMinor);
  if (!Number.isFinite(contribution) || contribution <= 0) return { seats: null, attainable: false, reason: 'non_positive_contribution' };
  const seats = Math.ceil(Number(fixedCostsMinor || 0) / contribution);
  return { seats, attainable: !Number.isFinite(Number(capacity)) || seats <= Number(capacity), contributionMinor: contribution };
}

export function recommendChannels(budgetMinor, channels, { minimumPurchases = 5 } = {}) {
  const eligible = channels.filter((row) => Number(row.purchases) >= minimumPurchases && Number(row.spend_minor) > 0 && Number(row.revenue_minor) >= 0);
  if (!eligible.length || budgetMinor <= 0) {
    return { allocations: [], unallocatedMinor: Math.max(0, Number(budgetMinor || 0)), evidence: 'experiment' };
  }
  const weighted = eligible.map((row) => ({ ...row, score: Number(row.revenue_minor) / Number(row.spend_minor) * Math.sqrt(Number(row.purchases)) }));
  const totalScore = weighted.reduce((sum, row) => sum + row.score, 0);
  let used = 0;
  const allocations = weighted.map((row, index) => {
    const amount = index === weighted.length - 1
      ? Number(budgetMinor) - used
      : Math.floor(Number(budgetMinor) * row.score / totalScore);
    used += amount;
    return { channel: row.channel, amountMinor: amount, purchases: row.purchases, roas: Number(row.revenue_minor) / Number(row.spend_minor) };
  });
  return { allocations, unallocatedMinor: Math.max(0, Number(budgetMinor) - used), evidence: 'measured' };
}

export function trafficSummary(dailyRows, periodRow) {
  return {
    users: Number.isFinite(Number(periodRow?.users)) ? Number(periodRow.users) : null,
    sessions: dailyRows.reduce((sum, row) => sum + Number(row.sessions || 0), 0),
    views: dailyRows.reduce((sum, row) => sum + Number(row.views || 0), 0),
    usersState: periodRow ? 'available' : 'unavailable',
  };
}

export function forecastSeats(baseSeats, changePercent, capacity) {
  const raw = Math.max(0, Math.round(Number(baseSeats || 0) * (1 + Number(changePercent || 0) / 100)));
  return Number.isFinite(Number(capacity)) ? Math.min(raw, Number(capacity)) : raw;
}

export function monthPeriod(date = new Date()) {
  const today = pragueDate(date);
  const [year, month] = today.split('-').map(Number);
  return {
    from: `${year}-${String(month).padStart(2, '0')}-01`,
    to: clampCalendarDate(year, month, 31),
  };
}
