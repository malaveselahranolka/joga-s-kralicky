// Zapier bridge. Nothing is sent automatically: outbound requires an owner call.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { assertPeriod, safeZapierPayload } from '../_shared/business-sync-contracts.js';

const env = (name) => Deno.env.get(name) ?? '';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-business-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

async function sameSecret(left, right) {
  if (!left || !right) return false;
  const [a, b] = await Promise.all([digest(left), digest(right)]);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) difference |= (a[index] || 0) ^ (b[index] || 0);
  return difference === 0;
}

async function ownerAllowed(req) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;
  if (await sameSecret(token, env('SUPABASE_SERVICE_ROLE_KEY'))) return true;
  const client = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: user, error } = await client.auth.getUser(token);
  if (error || !user?.user) return false;
  const { data: access } = await client.from('business_access').select('user_id').eq('user_id', user.user.id).eq('role', 'owner').eq('active', true).maybeSingle();
  return Boolean(access);
}

function cleanMetrics(metrics) {
  const allowed = ['revenue_minor', 'costs_minor', 'result_minor', 'paid_spots', 'users', 'sessions', 'views', 'completeness'];
  return Object.fromEntries(allowed.filter((key) => key in (metrics || {})).map((key) => {
    const value = metrics[key];
    if (key === 'completeness') return [key, String(value).slice(0, 40)];
    if (!Number.isFinite(Number(value))) throw new Error('invalid_metric');
    return [key, Number(value)];
  }));
}

async function inbound(req, admin, body) {
  if (!(await sameSecret(req.headers.get('x-business-secret') || '', env('ZAPIER_INBOUND_SECRET')))) return json({ ok: false, error: 'forbidden' }, 403);
  const eventId = String(body.event_id || '').trim();
  const date = String(body.date || '');
  if (!eventId || eventId.length > 160 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ ok: false, error: 'invalid_event' }, 400);
  const metrics = cleanMetrics(body.metrics);
  if (!Object.keys(metrics).length) return json({ ok: false, error: 'empty_metrics' }, 400);

  const { data: connection, error: connectionError } = await admin.from('business_connections').upsert({ provider: 'zapier', status: 'connected', last_success_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }, { onConflict: 'provider' }).select('id').single();
  if (connectionError) return json({ ok: false, error: 'business_schema_not_ready' }, 503);
  const { data: duplicate } = await admin.from('business_sync_runs').select('id').eq('connection_id', connection.id).eq('external_event_id', eventId).maybeSingle();
  if (duplicate) return json({ ok: true, duplicate: true });
  const dimension = `zapier:${String(body.dimension || 'all').replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 80) || 'all'}`;
  const { error } = await admin.from('business_daily_metrics').upsert({ source: 'zapier', metric_date: date, dimension_key: dimension, metrics, complete: body.complete !== false }, { onConflict: 'source,metric_date,dimension_key' });
  if (error) return json({ ok: false, error: 'metric_write_failed' }, 500);
  const runRow = { connection_id: connection.id, external_event_id: eventId, finished_at: new Date().toISOString(), status: 'success', imported_count: 1, metadata: { direction: 'inbound' } };
  const { error: runError } = await admin.from('business_sync_runs').insert(runRow);
  if (runError?.code === '23505') return json({ ok: true, duplicate: true });
  if (runError) return json({ ok: false, error: 'event_log_failed' }, 500);
  return json({ ok: true, duplicate: false });
}

async function outbound(req, body) {
  if (!(await ownerAllowed(req))) return json({ ok: false, error: 'forbidden' }, 403);
  if (!env('ZAPIER_OUTBOUND_WEBHOOK_URL')) return json({ ok: false, error: 'outbound_not_configured' }, 409);
  try { assertPeriod(body.period?.from, body.period?.to); } catch { return json({ ok: false, error: 'invalid_period' }, 400); }
  const payload = safeZapierPayload(body.event, body.period, body.summary || {});
  const sent = await fetch(env('ZAPIER_OUTBOUND_WEBHOOK_URL'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!sent.ok) return json({ ok: false, error: `zapier_http_${sent.status}` }, 502);
  return json({ ok: true, event_id: payload.event_id });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  const body = await req.json().catch(() => ({}));
  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  return body.direction === 'inbound' ? inbound(req, admin, body) : outbound(req, body);
});
