const INTERNAL_PATHS = ['/admin', '/admin.html', '/business', '/business.html'];

export function assertPeriod(from, to, maxDays = 366) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) throw new Error('invalid_period');
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T23:59:59Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > maxDays * 86400000) throw new Error('invalid_period');
  return { start, end };
}

export function vercelPublicFilter() {
  return INTERNAL_PATHS.map((path) => `requestPath ne '${path}'`).join(' and ');
}

export function stripeBalanceUrl(from, to, cursor = '') {
  const { start, end } = assertPeriod(from, to);
  const params = new URLSearchParams({
    limit: '100',
    'created[gte]': String(Math.floor(start / 1000)),
    'created[lte]': String(Math.floor(end / 1000)),
    'expand[]': 'data.source',
  });
  if (cursor) params.set('starting_after', cursor);
  return `https://api.stripe.com/v1/balance_transactions?${params}`;
}

export function mapStripeBalance(row) {
  const type = String(row?.type || '');
  const amount = Number(row?.amount);
  if (!row?.id || !Number.isFinite(amount)) throw new Error('invalid_stripe_row');
  let kind = 'adjustment';
  if (['charge', 'payment'].includes(type)) kind = amount >= 0 ? 'income' : 'refund';
  else if (type.includes('refund') || type.includes('reversal')) kind = 'refund';
  else if (type.includes('fee')) kind = 'fee';
  else if (type.includes('payout') || type.includes('transfer')) kind = 'transfer';
  const source = row.source && typeof row.source === 'object' ? row.source : null;
  return {
    source: 'stripe', external_id: row.id, source_created_at: new Date(row.created * 1000).toISOString(),
    source_updated_at: new Date(row.created * 1000).toISOString(), occurred_at: new Date(row.created * 1000).toISOString(),
    currency: String(row.currency || 'czk').toUpperCase(), amount_minor: Math.abs(Math.round(amount)), kind,
    status: row.status === 'pending' ? 'pending' : 'posted', booking_id: source?.metadata?.booking_id || null,
    source_url: `https://dashboard.stripe.com/balance/history/${row.id}`, note: row.description || type,
  };
}

const publicPathFilter = {
  notExpression: {
    filter: { fieldName: 'pagePath', stringFilter: { matchType: 'FULL_REGEXP', value: '^/(admin|business)(?:\\.html)?(?:/.*)?$', caseSensitive: false } },
  },
};

export function ga4Bodies(from, to) {
  assertPeriod(from, to);
  const metrics = ['activeUsers', 'sessions', 'screenPageViews'].map((name) => ({ name }));
  return {
    daily: { dateRanges: [{ startDate: from, endDate: to }], dimensions: [{ name: 'date' }], metrics, dimensionFilter: publicPathFilter, limit: '10000', returnPropertyQuota: true },
    period: { dateRanges: [{ startDate: from, endDate: to }], metrics, dimensionFilter: publicPathFilter, returnPropertyQuota: true },
  };
}

function ga4Values(row) {
  const values = row?.metricValues || [];
  return { users: Number(values[0]?.value || 0), sessions: Number(values[1]?.value || 0), views: Number(values[2]?.value || 0) };
}

export function mapGa4Daily(response) {
  return (response?.rows || []).map((row) => {
    const raw = row.dimensionValues?.[0]?.value || '';
    const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    return { source: 'ga4', metric_date: date, dimension_key: 'public', metrics: ga4Values(row), complete: !response?.metadata?.dataLossFromOtherRow };
  });
}

export function mapGa4Period(response, from, to) {
  return { source: 'ga4', period_start: from, period_end: to, dimension_key: 'public', metrics: ga4Values(response?.rows?.[0]), complete: !response?.metadata?.dataLossFromOtherRow, methodology: 'GA4 Data API: metriky za celé období; interní cesty vyloučené filtrem pagePath.' };
}

export function vercelUrls(from, to, projectId, teamId = '') {
  assertPeriod(from, to);
  const common = { projectId, since: from, until: to, filter: vercelPublicFilter() };
  if (teamId) common.teamId = teamId;
  const daily = new URLSearchParams({ ...common, by: 'day', limit: '100' });
  const period = new URLSearchParams(common);
  return {
    daily: `https://api.vercel.com/v1/query/web-analytics/visits/aggregate?${daily}`,
    period: `https://api.vercel.com/v1/query/web-analytics/visits/count?${period}`,
  };
}

export function mapVercelDaily(response) {
  return (response?.data || []).map((row) => ({
    source: 'vercel', metric_date: String(row.timestamp).slice(0, 10), dimension_key: 'public',
    metrics: { users: Number(row.visitors || 0), views: Number(row.pageviews || 0) }, complete: true,
  }));
}

export function mapVercelPeriod(response, from, to) {
  return { source: 'vercel', period_start: from, period_end: to, dimension_key: 'public', metrics: { users: Number(response?.data?.visitors || 0), views: Number(response?.data?.pageviews || 0) }, complete: true, methodology: 'Vercel Web Analytics API: count za celé období; interní cesty vyloučené OData filtrem.' };
}

export function googleAdsQuery(from, to) {
  assertPeriod(from, to);
  return `SELECT campaign.id, campaign.name, campaign.status, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '${from}' AND '${to}' AND campaign.status != 'REMOVED' ORDER BY segments.date`;
}

export function metaInsightsUrl(from, to, accountId, version = 'v24.0', after = '') {
  assertPeriod(from, to);
  const params = new URLSearchParams({ fields: 'campaign_id,campaign_name,date_start,date_stop,spend,impressions,reach,clicks,actions,action_values', level: 'campaign', time_increment: '1', time_range: JSON.stringify({ since: from, until: to }), limit: '100' });
  if (after) params.set('after', after);
  return `https://graph.facebook.com/${version}/act_${String(accountId).replace(/^act_/, '')}/insights?${params}`;
}

export function tiktokReportUrl(from, to, advertiserId, page = 1) {
  assertPeriod(from, to);
  const params = new URLSearchParams({ advertiser_id: advertiserId, report_type: 'BASIC', data_level: 'AUCTION_CAMPAIGN', dimensions: JSON.stringify(['campaign_id', 'stat_time_day']), metrics: JSON.stringify(['campaign_name', 'spend', 'impressions', 'reach', 'clicks', 'conversion', 'total_complete_payment_rate', 'total_purchase_value']), start_date: from, end_date: to, page: String(page), page_size: '100' });
  return `https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/?${params}`;
}

export function sklikCalls(from, to, token, userId = null, offset = 0) {
  assertPeriod(from, to);
  const user = (session) => userId ? { session, userId: Number(userId) } : { session };
  return {
    login: { method: 'client.loginByToken', params: token },
    create: (session) => ({ method: 'campaigns.createReport', params: [user(session), { dateFrom: from, dateTo: to }, { statGranularity: 'daily', includeCurrentDayStats: false }] }),
    read: (session, reportId) => ({ method: 'campaigns.readReport', params: [user(session), reportId, { offset, limit: 100, allowEmptyStatistics: false, displayColumns: ['id', 'name', 'status', 'clicks', 'impressions', 'totalMoney', 'conversions', 'conversionValue'] }] }),
  };
}

export function safeZapierPayload(event, period, summary) {
  if (!['weekly_summary', 'monthly_summary', 'data_alert'].includes(event)) throw new Error('invalid_zapier_event');
  assertPeriod(period.from, period.to);
  const allowed = ['revenue_minor', 'costs_minor', 'result_minor', 'paid_spots', 'completeness', 'alert_code'];
  return { event_id: crypto.randomUUID(), event, occurred_at: new Date().toISOString(), period, summary: Object.fromEntries(allowed.filter((key) => key in summary).map((key) => [key, summary[key]])) };
}
