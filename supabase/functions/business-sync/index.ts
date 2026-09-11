// Read-only imports into business tables. Deploy only after business-dashboard.sql.
// JWT verification stays ON. Caller must be owner or service_role (Cron).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  assertPeriod, ga4Bodies, googleAdsQuery, mapGa4Daily, mapGa4Period,
  mapStripeBalance, mapVercelDaily, mapVercelPeriod, metaInsightsUrl,
  sklikCalls, stripeBalanceUrl, tiktokReportUrl, vercelUrls,
} from '../_shared/business-sync-contracts.js';

const env = (name, fallback = '') => Deno.env.get(name) ?? fallback;
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const supported = new Set(['stripe', 'ga4', 'vercel', 'meta_ads', 'instagram', 'facebook_page', 'tiktok_ads', 'tiktok_organic', 'google_ads', 'sklik']);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

function jwtRole(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(part + '='.repeat((4 - part.length % 4) % 4)))?.role || null;
  } catch { return null; }
}

async function callerAllowed(req) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;
  if (jwtRole(token) === 'service_role') return true;
  const client = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: user, error } = await client.auth.getUser(token);
  if (error || !user?.user) return false;
  const { data: access } = await client.from('business_access').select('user_id').eq('user_id', user.user.id).eq('role', 'owner').eq('active', true).maybeSingle();
  return Boolean(access);
}

async function jsonFetch(url, options = {}, attempts = 3) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const res = await fetch(url, options);
    if (res.ok) return res.json();
    const text = (await res.text()).slice(0, 500);
    last = new Error(`provider_http_${res.status}:${text}`);
    if (![429, 500, 502, 503, 504].includes(res.status) || attempt === attempts - 1) break;
    await sleep(Math.min(4000, 500 * (2 ** attempt)));
  }
  throw last;
}

function requireEnv(...names) {
  const missing = names.filter((name) => !env(name));
  if (missing.length) throw new Error(`missing_secret:${missing.join(',')}`);
}

function base64url(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function googleServiceToken() {
  requireEnv('GOOGLE_SERVICE_ACCOUNT_JSON');
  const service = JSON.parse(env('GOOGLE_SERVICE_ACCOUNT_JSON'));
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(JSON.stringify({ iss: service.client_email, scope: 'https://www.googleapis.com/auth/analytics.readonly', aud: service.token_uri || 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const pem = service.private_key.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), (char) => char.charCodeAt(0)), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claim}`));
  const form = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claim}.${base64url(signature)}` });
  const token = await jsonFetch(service.token_uri || 'https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form });
  return token.access_token;
}

async function googleRefreshToken(scope = '') {
  requireEnv('GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REFRESH_TOKEN');
  const form = new URLSearchParams({ client_id: env('GOOGLE_OAUTH_CLIENT_ID'), client_secret: env('GOOGLE_OAUTH_CLIENT_SECRET'), refresh_token: env('GOOGLE_OAUTH_REFRESH_TOKEN'), grant_type: 'refresh_token' });
  if (scope) form.set('scope', scope);
  const token = await jsonFetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form });
  return token.access_token;
}

async function syncStripe(from, to) {
  requireEnv('STRIPE_SECRET_KEY');
  const ledger = [];
  let cursor = '';
  for (let page = 0; page < 50; page += 1) {
    const data = await jsonFetch(stripeBalanceUrl(from, to, cursor), { headers: { Authorization: `Bearer ${env('STRIPE_SECRET_KEY')}` } });
    ledger.push(...(data.data || []).map(mapStripeBalance));
    if (!data.has_more || !data.data?.length) return { ledger, cursor: '', metadata: { pages: page + 1 } };
    cursor = data.data.at(-1).id;
  }
  return { ledger, cursor, complete: false, metadata: { reason: 'page_limit' } };
}

async function syncGa4(from, to) {
  requireEnv('GA4_PROPERTY_ID');
  const token = await googleServiceToken();
  const bodies = ga4Bodies(from, to);
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(env('GA4_PROPERTY_ID'))}:runReport`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const [daily, period] = await Promise.all([
    jsonFetch(url, { method: 'POST', headers, body: JSON.stringify(bodies.daily) }),
    jsonFetch(url, { method: 'POST', headers, body: JSON.stringify(bodies.period) }),
  ]);
  return { daily: mapGa4Daily(daily), period: [mapGa4Period(period, from, to)], metadata: { time_zone: daily.metadata?.timeZone || period.metadata?.timeZone, currency: daily.metadata?.currencyCode || period.metadata?.currencyCode } };
}

async function syncVercel(from, to) {
  requireEnv('VERCEL_ACCESS_TOKEN', 'VERCEL_PROJECT_ID');
  const urls = vercelUrls(from, to, env('VERCEL_PROJECT_ID'), env('VERCEL_TEAM_ID'));
  const headers = { Authorization: `Bearer ${env('VERCEL_ACCESS_TOKEN')}` };
  const [daily, period] = await Promise.all([jsonFetch(urls.daily, { headers }), jsonFetch(urls.period, { headers })]);
  return { daily: mapVercelDaily(daily), period: [mapVercelPeriod(period, from, to)] };
}

function metaActions(row, name) {
  return Number((row?.actions || []).find((item) => item.action_type === name)?.value || 0);
}

async function syncMeta(from, to) {
  requireEnv('META_ACCESS_TOKEN', 'META_AD_ACCOUNT_ID');
  const daily = [];
  const campaigns = new Map();
  let after = '';
  for (let page = 0; page < 50; page += 1) {
    const data = await jsonFetch(metaInsightsUrl(from, to, env('META_AD_ACCOUNT_ID'), env('META_GRAPH_VERSION', 'v24.0'), after), { headers: { Authorization: `Bearer ${env('META_ACCESS_TOKEN')}` } });
    for (const row of data.data || []) {
      const id = String(row.campaign_id);
      campaigns.set(id, { source: 'meta_ads', external_id: id, name: row.campaign_name || id, channel: 'Meta Ads', status: 'active' });
      daily.push({ source: 'meta_ads', metric_date: row.date_start, dimension_key: `campaign:${id}`, metrics: { spend_minor: Math.round(Number(row.spend || 0) * 100), impressions: Number(row.impressions || 0), reach: Number(row.reach || 0), clicks: Number(row.clicks || 0), purchases: metaActions(row, 'purchase') }, complete: true });
    }
    after = data.paging?.cursors?.after || '';
    if (!data.paging?.next || !after) return { daily, campaigns: [...campaigns.values()] };
  }
  return { daily, campaigns: [...campaigns.values()], cursor: after, complete: false };
}

async function syncInstagram(from, to) {
  requireEnv('META_ACCESS_TOKEN', 'META_INSTAGRAM_ACCOUNT_ID');
  const social = [];
  let url = `https://graph.facebook.com/${env('META_GRAPH_VERSION', 'v24.0')}/${encodeURIComponent(env('META_INSTAGRAM_ACCOUNT_ID'))}/media?fields=id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count&limit=100`;
  for (let page = 0; page < 50 && url; page += 1) {
    const data = await jsonFetch(url, { headers: { Authorization: `Bearer ${env('META_ACCESS_TOKEN')}` } });
    for (const row of data.data || []) {
      const date = String(row.timestamp || '').slice(0, 10);
      if (date < from || date > to) continue;
      social.push({ channel: 'instagram', external_id: String(row.id), published_at: row.timestamp, format: String(row.media_product_type || row.media_type || 'post').toLowerCase(), topic_tags: [], paid_support: false, target_url: row.permalink || null, metrics: { likes: Number(row.like_count || 0), comments: Number(row.comments_count || 0), reach: null }, measurement_window_hours: Math.max(1, Math.round((Date.now() - Date.parse(row.timestamp)) / 3600000)) });
    }
    url = data.paging?.next || '';
  }
  return { social, metadata: { limitation: 'Media list neobsahuje spolehlivý reach pro všechny formáty; nedostupná hodnota zůstává null.' } };
}

async function syncFacebookPage(from, to) {
  requireEnv('META_ACCESS_TOKEN', 'META_PAGE_ID');
  const social = [];
  let url = `https://graph.facebook.com/${env('META_GRAPH_VERSION', 'v24.0')}/${encodeURIComponent(env('META_PAGE_ID'))}/published_posts?fields=id,created_time,permalink_url,shares,comments.limit(0).summary(true),reactions.limit(0).summary(true)&limit=100`;
  for (let page = 0; page < 50 && url; page += 1) {
    const data = await jsonFetch(url, { headers: { Authorization: `Bearer ${env('META_ACCESS_TOKEN')}` } });
    for (const row of data.data || []) {
      const date = String(row.created_time || '').slice(0, 10);
      if (date < from || date > to) continue;
      social.push({ channel: 'facebook', external_id: String(row.id), published_at: row.created_time, format: 'post', topic_tags: [], paid_support: false, target_url: row.permalink_url || null, metrics: { reactions: Number(row.reactions?.summary?.total_count || 0), comments: Number(row.comments?.summary?.total_count || 0), shares: Number(row.shares?.count || 0), reach: null }, measurement_window_hours: Math.max(1, Math.round((Date.now() - Date.parse(row.created_time)) / 3600000)) });
    }
    url = data.paging?.next || '';
  }
  return { social, metadata: { limitation: 'Published posts neobsahují jednotný reach; nedostupná hodnota zůstává null.' } };
}

async function syncTikTok(from, to) {
  requireEnv('TIKTOK_ACCESS_TOKEN', 'TIKTOK_ADVERTISER_ID');
  const daily = [];
  const campaigns = new Map();
  for (let page = 1; page <= 50; page += 1) {
    const data = await jsonFetch(tiktokReportUrl(from, to, env('TIKTOK_ADVERTISER_ID'), page), { headers: { 'Access-Token': env('TIKTOK_ACCESS_TOKEN') } });
    if (Number(data.code) !== 0) throw new Error(`tiktok_${data.code}:${data.message || 'error'}`);
    for (const row of data.data?.list || []) {
      const id = String(row.dimensions?.campaign_id || 'unknown');
      const metric = row.metrics || {};
      campaigns.set(id, { source: 'tiktok_ads', external_id: id, name: metric.campaign_name || id, channel: 'TikTok Ads', status: 'active' });
      daily.push({ source: 'tiktok_ads', metric_date: String(row.dimensions?.stat_time_day || '').slice(0, 10), dimension_key: `campaign:${id}`, metrics: { spend_minor: Math.round(Number(metric.spend || 0) * 100), impressions: Number(metric.impressions || 0), reach: Number(metric.reach || 0), clicks: Number(metric.clicks || 0), conversions: Number(metric.conversion || 0), conversion_value_minor: Math.round(Number(metric.total_purchase_value || 0) * 100) }, complete: true });
    }
    if (page >= Number(data.data?.page_info?.total_page || 1)) return { daily, campaigns: [...campaigns.values()] };
  }
  return { daily, campaigns: [...campaigns.values()], cursor: '50', complete: false };
}

async function syncTikTokOrganic(from, to) {
  requireEnv('TIKTOK_CREATOR_ACCESS_TOKEN');
  const social = [];
  let cursor = 0;
  for (let page = 0; page < 50; page += 1) {
    const fields = 'id,create_time,title,video_description,share_url,like_count,comment_count,share_count,view_count';
    const data = await jsonFetch(`https://open.tiktokapis.com/v2/video/list/?fields=${fields}`, { method: 'POST', headers: { Authorization: `Bearer ${env('TIKTOK_CREATOR_ACCESS_TOKEN')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ max_count: 20, ...(cursor ? { cursor } : {}) }) });
    if (data.error?.code && data.error.code !== 'ok') throw new Error(`tiktok_organic:${data.error.code}`);
    for (const row of data.data?.videos || []) {
      const published = new Date(Number(row.create_time) * 1000).toISOString();
      const date = published.slice(0, 10);
      if (date < from || date > to) continue;
      social.push({ channel: 'tiktok', external_id: String(row.id), published_at: published, format: 'video', topic_tags: [], paid_support: false, target_url: row.share_url || null, metrics: { views: Number(row.view_count || 0), likes: Number(row.like_count || 0), comments: Number(row.comment_count || 0), shares: Number(row.share_count || 0) }, measurement_window_hours: Math.max(1, Math.round((Date.now() - Date.parse(published)) / 3600000)) });
    }
    if (!data.data?.has_more) return { social };
    cursor = Number(data.data.cursor || 0);
  }
  return { social, cursor: String(cursor), complete: false };
}

async function syncGoogleAds(from, to) {
  requireEnv('GOOGLE_ADS_CUSTOMER_ID', 'GOOGLE_ADS_DEVELOPER_TOKEN');
  const token = await googleRefreshToken('https://www.googleapis.com/auth/adwords');
  const customer = env('GOOGLE_ADS_CUSTOMER_ID').replace(/-/g, '');
  const url = `https://googleads.googleapis.com/${env('GOOGLE_ADS_API_VERSION', 'v25')}/customers/${customer}/googleAds:search`;
  const headers = { Authorization: `Bearer ${token}`, 'developer-token': env('GOOGLE_ADS_DEVELOPER_TOKEN'), 'Content-Type': 'application/json' };
  if (env('GOOGLE_ADS_LOGIN_CUSTOMER_ID')) headers['login-customer-id'] = env('GOOGLE_ADS_LOGIN_CUSTOMER_ID').replace(/-/g, '');
  const daily = [];
  const campaigns = new Map();
  let pageToken = '';
  for (let page = 0; page < 50; page += 1) {
    const data = await jsonFetch(url, { method: 'POST', headers, body: JSON.stringify({ query: googleAdsQuery(from, to), pageSize: 1000, ...(pageToken ? { pageToken } : {}) }) });
    for (const row of data.results || []) {
      const id = String(row.campaign?.id || 'unknown');
      campaigns.set(id, { source: 'google_ads', external_id: id, name: row.campaign?.name || id, channel: 'Google Ads', status: String(row.campaign?.status || '').toLowerCase() === 'paused' ? 'paused' : 'active' });
      daily.push({ source: 'google_ads', metric_date: row.segments?.date, dimension_key: `campaign:${id}`, metrics: { spend_minor: Math.round(Number(row.metrics?.costMicros || 0) / 10000), impressions: Number(row.metrics?.impressions || 0), clicks: Number(row.metrics?.clicks || 0), conversions: Number(row.metrics?.conversions || 0), conversion_value_minor: Math.round(Number(row.metrics?.conversionsValue || 0) * 100) }, complete: true });
    }
    pageToken = data.nextPageToken || '';
    if (!pageToken) return { daily, campaigns: [...campaigns.values()] };
  }
  return { daily, campaigns: [...campaigns.values()], cursor: pageToken, complete: false };
}

async function sklikRequest(method, params) {
  return jsonFetch(`https://api.sklik.cz/drak/json/v5/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
}

async function syncSklik(from, to) {
  requireEnv('SKLIK_API_TOKEN');
  const calls = sklikCalls(from, to, env('SKLIK_API_TOKEN'), env('SKLIK_ACCOUNT_ID'));
  const login = await sklikRequest(calls.login.method, calls.login.params);
  if (Number(login.status) !== 200) throw new Error(`sklik_login_${login.status}`);
  const created = await sklikRequest(calls.create(login.session).method, calls.create(login.session).params);
  if (![200, 206].includes(Number(created.status))) throw new Error(`sklik_report_${created.status}`);
  const daily = [];
  const campaigns = new Map();
  let offset = 0;
  for (let page = 0; page < 50; page += 1) {
    const pageCalls = sklikCalls(from, to, env('SKLIK_API_TOKEN'), env('SKLIK_ACCOUNT_ID'), offset);
    const request = pageCalls.read(created.session || login.session, created.reportId);
    const data = await sklikRequest(request.method, request.params);
    if (![200, 206].includes(Number(data.status))) throw new Error(`sklik_read_${data.status}`);
    for (const row of data.report || []) {
      const id = String(row.id || 'unknown');
      campaigns.set(id, { source: 'sklik', external_id: id, name: row.name || id, channel: 'Sklik', status: String(row.status || '').includes('suspend') ? 'paused' : 'active' });
      for (const stat of row.stats || []) daily.push({ source: 'sklik', metric_date: String(stat.date).slice(0, 10), dimension_key: `campaign:${id}`, metrics: { spend_minor: Number(stat.totalMoney || 0), impressions: Number(stat.impressions || 0), clicks: Number(stat.clicks || 0), conversions: Number(stat.conversions || 0), conversion_value_minor: Number(stat.conversionValue || 0) }, complete: true });
    }
    if ((data.report || []).length < 100) return { daily, campaigns: [...campaigns.values()] };
    offset += 100;
  }
  return { daily, campaigns: [...campaigns.values()], cursor: String(offset), complete: false };
}

const providers = { stripe: syncStripe, ga4: syncGa4, vercel: syncVercel, meta_ads: syncMeta, instagram: syncInstagram, facebook_page: syncFacebookPage, tiktok_ads: syncTikTok, tiktok_organic: syncTikTokOrganic, google_ads: syncGoogleAds, sklik: syncSklik };

async function persist(admin, result) {
  let imported = 0;
  for (const [table, rows, conflict] of [
    ['business_campaigns', result.campaigns, 'source,external_id'],
    ['business_social_posts', result.social, 'channel,external_id'],
    ['business_daily_metrics', result.daily, 'source,metric_date,dimension_key'],
    ['business_period_metrics', result.period, 'source,period_start,period_end,dimension_key'],
    ['business_ledger_entries', result.ledger, 'source,external_id'],
  ]) {
    if (!rows?.length) continue;
    const { error } = await admin.from(table).upsert(rows, { onConflict: conflict });
    if (error) throw new Error(`database_${table}:${error.message}`);
    imported += rows.length;
  }
  return imported;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return response({ ok: false, error: 'method_not_allowed' }, 405);
  if (!(await callerAllowed(req))) return response({ ok: false, error: 'forbidden' }, 403);

  const body = await req.json().catch(() => ({}));
  const provider = String(body.provider || '');
  if (!supported.has(provider)) return response({ ok: false, error: 'unsupported_provider' }, 400);
  try { assertPeriod(body.from, body.to); } catch { return response({ ok: false, error: 'invalid_period' }, 400); }

  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  const { data: connection, error: connectionError } = await admin.from('business_connections').upsert({ provider, status: 'syncing', last_error: null, updated_at: new Date().toISOString() }, { onConflict: 'provider' }).select('id').single();
  if (connectionError) return response({ ok: false, error: 'business_schema_not_ready' }, 503);
  const { data: run, error: runError } = await admin.from('business_sync_runs').insert({ connection_id: connection.id, status: 'running', metadata: { from: body.from, to: body.to } }).select('id').single();
  if (runError) return response({ ok: false, error: 'sync_run_not_created' }, 500);

  try {
    const result = await providers[provider](body.from, body.to);
    const imported = await persist(admin, result);
    const status = result.complete === false ? 'partial' : 'success';
    await admin.from('business_sync_runs').update({ finished_at: new Date().toISOString(), cursor: result.cursor || null, status, imported_count: imported, metadata: { from: body.from, to: body.to, ...(result.metadata || {}) } }).eq('id', run.id);
    await admin.from('business_connections').update({ status: status === 'success' ? 'connected' : 'stale', last_success_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq('id', connection.id);
    return response({ ok: true, provider, status, imported });
  } catch (error) {
    const message = String(error?.message || error).slice(0, 500);
    await admin.from('business_sync_runs').update({ finished_at: new Date().toISOString(), status: 'failed', error: message }).eq('id', run.id);
    await admin.from('business_connections').update({ status: 'error', last_error: message, updated_at: new Date().toISOString() }).eq('id', connection.id);
    return response({ ok: false, provider, error: message.startsWith('missing_secret:') ? message : 'provider_sync_failed' }, message.startsWith('missing_secret:') ? 409 : 502);
  }
});
