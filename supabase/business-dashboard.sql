-- =====================================================================
-- Business dashboard — oddělená analytická a plánovací data
--
-- Bezpečné nasazení je popsáno v docs/business-dashboard.md.
-- Tento soubor NEMĚNÍ rezervace, kapacitu, platby ani CMS.
-- Po spuštění je nutné ručně vložit UID výslovně oprávněné majitelky:
--   insert into public.business_access (user_id) values ('AUTH-USER-UUID');
-- =====================================================================

create table if not exists public.business_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role = 'owner'),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.business_access enable row level security;
drop policy if exists business_access_read_own on public.business_access;
create policy business_access_read_own on public.business_access
  for select to authenticated
  using (user_id = (select auth.uid()) and active);
revoke all on public.business_access from anon;
revoke insert, update, delete on public.business_access from authenticated;
grant select on public.business_access to authenticated;

create or replace function public.business_has_access()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1 from public.business_access
    where user_id = (select auth.uid()) and role = 'owner' and active
  )
$$;
revoke execute on function public.business_has_access() from public, anon;
grant execute on function public.business_has_access() to authenticated;

create table if not exists public.business_cost_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (name)
);

create table if not exists public.business_campaigns (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'manual',
  external_id text,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  channel text not null check (char_length(btrim(channel)) between 1 and 80),
  objective text,
  starts_on date,
  ends_on date,
  capacity_limit integer check (capacity_limit is null or capacity_limit >= 0),
  status text not null default 'planned' check (status in ('planned','active','paused','finished')),
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
alter table public.business_campaigns add column if not exists source text not null default 'manual';
alter table public.business_campaigns add column if not exists external_id text;
create unique index if not exists business_campaigns_source_external_uq
  on public.business_campaigns (source, external_id);

create table if not exists public.business_cost_rules (
  id uuid primary key default gen_random_uuid(),
  rule_key uuid not null default gen_random_uuid(),
  version integer not null default 1 check (version >= 1),
  name text not null check (char_length(btrim(name)) between 1 and 160),
  category_id uuid references public.business_cost_categories(id) on delete set null,
  amount_minor bigint not null default 0 check (amount_minor >= 0),
  currency text not null default 'CZK' check (currency ~ '^[A-Z]{3}$'),
  recurrence text not null default 'once' check (recurrence in ('once','weekly','monthly','yearly','per_lesson','per_paid_spot','percentage')),
  percentage_basis text check (percentage_basis is null or percentage_basis in ('recognized_revenue','cash_sales','ad_spend')),
  rate_basis_points integer check (rate_basis_points is null or rate_basis_points between 0 and 10000),
  valid_from date not null,
  valid_to date,
  day_of_month smallint check (day_of_month is null or day_of_month between 1 and 31),
  month_of_year smallint check (month_of_year is null or month_of_year between 1 and 12),
  cost_class text not null default 'operation' check (cost_class in ('operation','advertising','investment','own_work')),
  include_in_operating boolean not null default true,
  campaign_id uuid references public.business_campaigns(id) on delete set null,
  note text,
  attachment_path text,
  status text not null default 'active' check (status in ('draft','active','archived')),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  unique (rule_key, version),
  check (valid_to is null or valid_to >= valid_from),
  check (
    (recurrence = 'percentage' and percentage_basis is not null and rate_basis_points is not null)
    or (recurrence <> 'percentage' and percentage_basis is null and rate_basis_points is null)
  )
);

create table if not exists public.business_cost_occurrences (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.business_cost_rules(id) on delete restrict,
  occurrence_key text not null unique,
  scheduled_on date not null,
  period_start date not null,
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null default 'CZK' check (currency ~ '^[A-Z]{3}$'),
  unit_count numeric(12,2) not null default 1 check (unit_count >= 0),
  source_lesson_id uuid references public.lessons(id) on delete set null,
  status text not null default 'planned' check (status in ('planned','paid','cancelled')),
  paid_on date,
  include_in_operating boolean not null default true,
  note text,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.business_import_batches (
  id uuid primary key default gen_random_uuid(),
  source text not null check (char_length(btrim(source)) between 1 and 60),
  file_name text,
  status text not null default 'preview' check (status in ('preview','importing','finished','partial','failed')),
  row_count integer not null default 0,
  imported_count integer not null default 0,
  duplicate_count integer not null default 0,
  failed_count integer not null default 0,
  mapping jsonb not null default '{}'::jsonb,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.business_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  source text not null check (char_length(btrim(source)) between 1 and 60),
  external_id text,
  import_fingerprint text,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  occurred_at timestamptz not null,
  imported_at timestamptz not null default now(),
  currency text not null default 'CZK' check (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint not null check (amount_minor >= 0),
  kind text not null check (kind in ('income','refund','fee','expense','ad_spend','transfer','adjustment')),
  status text not null default 'posted' check (status in ('pending','posted','void')),
  booking_id uuid references public.bookings(id) on delete set null,
  voucher_id uuid references public.vouchers(id) on delete set null,
  cost_occurrence_id uuid references public.business_cost_occurrences(id) on delete set null,
  campaign_id uuid references public.business_campaigns(id) on delete set null,
  source_url text,
  consumption_from date,
  consumption_to date,
  note text,
  import_batch_id uuid references public.business_import_batches(id) on delete set null,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  check (consumption_to is null or consumption_from is null or consumption_to >= consumption_from)
);
create unique index if not exists business_ledger_source_external_uq
  on public.business_ledger_entries (source, external_id);
create unique index if not exists business_ledger_fingerprint_uq
  on public.business_ledger_entries (import_fingerprint) where import_fingerprint is not null;

-- Opožděná platformní událost nesmí vrátit záznam na starší stav.
create or replace function public.business_keep_newest_ledger_state()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if old.source_updated_at is not null
    and new.source_updated_at is not null
    and new.source_updated_at < old.source_updated_at then
    return old;
  end if;
  return new;
end;
$$;
revoke execute on function public.business_keep_newest_ledger_state() from public, anon, authenticated;
drop trigger if exists business_ledger_keep_newest on public.business_ledger_entries;
create trigger business_ledger_keep_newest
  before update on public.business_ledger_entries
  for each row execute function public.business_keep_newest_ledger_state();

create table if not exists public.business_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.business_import_batches(id) on delete cascade,
  row_number integer not null check (row_number >= 1),
  status text not null check (status in ('ready','imported','duplicate','failed')),
  raw_data jsonb not null,
  error text,
  ledger_entry_id uuid references public.business_ledger_entries(id) on delete set null,
  unique (batch_id, row_number)
);

create table if not exists public.business_budgets (
  id uuid primary key default gen_random_uuid(),
  budget_key uuid not null default gen_random_uuid(),
  version integer not null default 1 check (version >= 1),
  period_start date not null,
  period_end date not null,
  kind text not null default 'advertising' check (kind in ('advertising','operation','reserve')),
  basis_period_start date,
  basis_period_end date,
  basis_result_minor bigint,
  rate_basis_points integer check (rate_basis_points is null or rate_basis_points between 0 and 10000),
  proposed_minor bigint check (proposed_minor is null or proposed_minor >= 0),
  accepted_minor bigint check (accepted_minor is null or accepted_minor >= 0),
  cap_minor bigint check (cap_minor is null or cap_minor >= 0),
  carryover_minor bigint not null default 0,
  status text not null default 'proposal' check (status in ('proposal','accepted','closed','superseded')),
  note text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  unique (budget_key, version),
  check (period_end >= period_start),
  check (basis_period_end is null or basis_period_start is null or basis_period_end >= basis_period_start)
);

create table if not exists public.business_social_posts (
  id uuid primary key default gen_random_uuid(),
  channel text not null,
  external_id text,
  published_at timestamptz not null,
  format text not null,
  topic_tags text[] not null default '{}',
  paid_support boolean not null default false,
  target_url text,
  metrics jsonb not null default '{}'::jsonb,
  measurement_window_hours integer check (measurement_window_hours is null or measurement_window_hours > 0),
  campaign_id uuid references public.business_campaigns(id) on delete set null,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create unique index if not exists business_social_posts_external_uq
  on public.business_social_posts (channel, external_id);

create table if not exists public.business_daily_metrics (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  metric_date date not null,
  dimension_key text not null default 'all',
  metrics jsonb not null,
  complete boolean not null default true,
  imported_at timestamptz not null default now(),
  unique (source, metric_date, dimension_key)
);

create table if not exists public.business_period_metrics (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  period_start date not null,
  period_end date not null,
  dimension_key text not null default 'all',
  metrics jsonb not null,
  complete boolean not null default true,
  methodology text,
  imported_at timestamptz not null default now(),
  unique (source, period_start, period_end, dimension_key),
  check (period_end >= period_start)
);

create table if not exists public.business_connections (
  id uuid primary key default gen_random_uuid(),
  provider text not null unique,
  external_account_label text,
  status text not null default 'not_connected' check (status in ('not_connected','connected','syncing','error','stale','paused')),
  last_success_at timestamptz,
  last_error text,
  config jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.business_sync_runs (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.business_connections(id) on delete cascade,
  external_event_id text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  cursor text,
  status text not null default 'running' check (status in ('running','success','partial','failed')),
  imported_count integer not null default 0,
  error text,
  metadata jsonb not null default '{}'::jsonb
);
alter table public.business_sync_runs add column if not exists external_event_id text;
create unique index if not exists business_sync_runs_external_event_uq
  on public.business_sync_runs (connection_id, external_event_id);

create table if not exists public.business_goals (
  id uuid primary key default gen_random_uuid(),
  metric text not null check (metric in ('revenue','operating_result','paid_spots','reserve','advertising_budget')),
  period_start date not null,
  period_end date not null,
  target_minor bigint,
  target_count integer,
  note text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start),
  check ((target_minor is not null) <> (target_count is not null))
);

create table if not exists public.business_scenarios (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  period_start date not null,
  period_end date not null,
  assumptions jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start)
);

create table if not exists public.business_notes (
  id uuid primary key default gen_random_uuid(),
  note_date date not null,
  note_type text not null default 'decision' check (note_type in ('decision','campaign','change','context')),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  campaign_id uuid references public.business_campaigns(id) on delete set null,
  period_start date,
  period_end date,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.business_saved_views (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  view_key text not null,
  filters jsonb not null default '{}'::jsonb,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  unique (created_by, name)
);

create table if not exists public.business_settings (
  key text primary key check (char_length(key) between 1 and 80),
  value jsonb not null,
  updated_by uuid not null default auth.uid() references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.business_change_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  row_id text not null,
  action text not null check (action in ('INSERT','UPDATE','DELETE')),
  changed_by uuid default auth.uid() references auth.users(id),
  changed_at timestamptz not null default now(),
  before_data jsonb,
  after_data jsonb
);

-- Indexy pro filtry období, vazby a RLS.
create index if not exists business_cost_rules_category_idx on public.business_cost_rules(category_id);
create index if not exists business_cost_rules_campaign_idx on public.business_cost_rules(campaign_id);
create index if not exists business_cost_rules_active_idx on public.business_cost_rules(status, valid_from, valid_to);
create index if not exists business_cost_occurrences_rule_idx on public.business_cost_occurrences(rule_id);
create index if not exists business_cost_occurrences_period_idx on public.business_cost_occurrences(status, period_start);
create index if not exists business_cost_occurrences_lesson_idx on public.business_cost_occurrences(source_lesson_id) where source_lesson_id is not null;
create index if not exists business_import_rows_batch_idx on public.business_import_rows(batch_id);
create index if not exists business_ledger_occurred_idx on public.business_ledger_entries(status, occurred_at);
create index if not exists business_ledger_booking_idx on public.business_ledger_entries(booking_id) where booking_id is not null;
create index if not exists business_ledger_voucher_idx on public.business_ledger_entries(voucher_id) where voucher_id is not null;
create index if not exists business_ledger_occurrence_idx on public.business_ledger_entries(cost_occurrence_id) where cost_occurrence_id is not null;
create index if not exists business_ledger_campaign_idx on public.business_ledger_entries(campaign_id) where campaign_id is not null;
create index if not exists business_ledger_batch_idx on public.business_ledger_entries(import_batch_id) where import_batch_id is not null;
create index if not exists business_budgets_period_idx on public.business_budgets(kind, period_start, period_end);
create index if not exists business_social_posts_campaign_idx on public.business_social_posts(campaign_id) where campaign_id is not null;
create index if not exists business_social_posts_published_idx on public.business_social_posts(channel, published_at);
create index if not exists business_daily_metrics_date_idx on public.business_daily_metrics(source, metric_date);
create index if not exists business_period_metrics_dates_idx on public.business_period_metrics(source, period_start, period_end);
create index if not exists business_sync_runs_connection_idx on public.business_sync_runs(connection_id, started_at desc);
create index if not exists business_goals_period_idx on public.business_goals(metric, period_start, period_end);
create index if not exists business_notes_campaign_idx on public.business_notes(campaign_id) where campaign_id is not null;
create index if not exists business_notes_date_idx on public.business_notes(note_date desc);
create index if not exists business_saved_views_owner_idx on public.business_saved_views(created_by);
create index if not exists business_change_log_changed_idx on public.business_change_log(changed_at desc);
create index if not exists business_change_log_actor_idx on public.business_change_log(changed_by) where changed_by is not null;

-- RLS: žádný anonymní přístup; přihlášení samo nestačí.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'business_cost_categories','business_campaigns','business_cost_rules',
    'business_cost_occurrences','business_import_batches','business_import_rows',
    'business_ledger_entries','business_budgets','business_social_posts',
    'business_daily_metrics','business_period_metrics','business_connections',
    'business_sync_runs','business_goals','business_scenarios','business_notes',
    'business_saved_views','business_settings','business_change_log'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_owner_all', table_name);
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select public.business_has_access())) with check ((select public.business_has_access()))',
      table_name || '_owner_all', table_name
    );
    execute format('revoke all on public.%I from anon', table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
  end loop;
end $$;
grant usage, select on sequence public.business_change_log_id_seq to authenticated;

-- Soukromé doklady k nákladům. Žádná veřejná URL; klient vytváří jen krátký signed URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('business-attachments', 'business-attachments', false, 10485760, array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists business_attachments_owner_select on storage.objects;
drop policy if exists business_attachments_owner_insert on storage.objects;
drop policy if exists business_attachments_owner_update on storage.objects;
drop policy if exists business_attachments_owner_delete on storage.objects;
create policy business_attachments_owner_select on storage.objects for select to authenticated using (bucket_id = 'business-attachments' and (select public.business_has_access()));
create policy business_attachments_owner_insert on storage.objects for insert to authenticated with check (bucket_id = 'business-attachments' and (select public.business_has_access()));
create policy business_attachments_owner_update on storage.objects for update to authenticated using (bucket_id = 'business-attachments' and (select public.business_has_access())) with check (bucket_id = 'business-attachments' and (select public.business_has_access()));
create policy business_attachments_owner_delete on storage.objects for delete to authenticated using (bucket_id = 'business-attachments' and (select public.business_has_access()));

-- Auditní deník klient pouze čte; zápisy dělají triggery níže.
drop policy if exists business_change_log_owner_all on public.business_change_log;
drop policy if exists business_change_log_owner_read on public.business_change_log;
create policy business_change_log_owner_read on public.business_change_log
  for select to authenticated using ((select public.business_has_access()));
revoke insert, update, delete on public.business_change_log from authenticated;

-- Výchozí kategorie: idempotentní a bez vymyšlených částek.
insert into public.business_cost_categories (name, sort_order) values
  ('Nájem', 10), ('Lektoři', 20), ('Úklid', 30), ('Péče o králíčky', 40),
  ('Materiál', 50), ('Software', 60), ('Reklama', 70), ('Vybavení', 80), ('Ostatní', 90)
on conflict (name) do nothing;

-- Kalendářní výskyty. Jedna řádka na datum + verzi; opakované spuštění je no-op.
create or replace function public.business_generate_calendar_costs(p_from date, p_to date)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare inserted_count integer;
begin
  if (select auth.uid()) is not null then
    if not (select public.business_has_access()) then raise exception 'forbidden' using errcode = '42501'; end if;
  elsif current_user <> 'postgres' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to > p_from + 1095 then
    raise exception 'invalid period';
  end if;

  insert into public.business_cost_occurrences (
    rule_id, occurrence_key, scheduled_on, period_start, amount_minor,
    currency, include_in_operating, created_by
  )
  select
    r.id,
    r.rule_key::text || ':' || r.version::text || ':' || d.day::date::text,
    d.day::date,
    d.day::date,
    r.amount_minor,
    r.currency,
    r.include_in_operating,
    (select auth.uid())
  from public.business_cost_rules r
  cross join lateral generate_series(
    greatest(p_from, r.valid_from)::timestamptz,
    least(p_to, coalesce(r.valid_to, p_to))::timestamptz,
    interval '1 day'
  ) as d(day)
  where r.status = 'active'
    and r.recurrence in ('once','weekly','monthly','yearly')
    and (
      (r.recurrence = 'once' and d.day::date = r.valid_from)
      or (r.recurrence = 'weekly' and (d.day::date - r.valid_from) % 7 = 0)
      or (r.recurrence = 'monthly' and d.day::date = make_date(
        extract(year from d.day)::int,
        extract(month from d.day)::int,
        least(coalesce(r.day_of_month, extract(day from r.valid_from)::int), extract(day from (date_trunc('month', d.day) + interval '1 month - 1 day'))::int)
      ))
      or (r.recurrence = 'yearly'
        and extract(month from d.day)::int = coalesce(r.month_of_year, extract(month from r.valid_from)::int)
        and extract(day from d.day)::int = least(
          coalesce(r.day_of_month, extract(day from r.valid_from)::int),
          extract(day from (date_trunc('month', d.day) + interval '1 month - 1 day'))::int
        )
      )
    )
  on conflict (occurrence_key) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;
revoke execute on function public.business_generate_calendar_costs(date, date) from public, anon;
grant execute on function public.business_generate_calendar_costs(date, date) to authenticated;

-- Agregace pro hlavní přehled. Peníze z rezervací používají uloženou částku;
-- chybějící historická částka se nikdy nedopočítá dnešním ceníkem.
create or replace function public.business_period_summary(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare result jsonb;
begin
  if not (select public.business_has_access()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'invalid period'; end if;

  with
  paid as (
    select b.*, l.starts_at
    from public.bookings b join public.lessons l on l.id = b.lesson_id
    where b.status <> 'cancelled' and b.payment_status = 'paid'
  ),
  booking_values as (
    select
      coalesce(sum(payment_amount) filter (where (starts_at at time zone 'Europe/Prague')::date between p_from and p_to), 0)::bigint as revenue,
      coalesce(sum(payment_amount) filter (where (paid_at at time zone 'Europe/Prague')::date between p_from and p_to), 0)::bigint as cash,
      coalesce(sum(spots) filter (where (starts_at at time zone 'Europe/Prague')::date between p_from and p_to), 0)::bigint as spots,
      count(*) filter (where payment_amount is null and (
        (starts_at at time zone 'Europe/Prague')::date between p_from and p_to
        or (paid_at at time zone 'Europe/Prague')::date between p_from and p_to
      ))::bigint as missing_amounts
    from paid
  ),
  voucher_values as (
    select coalesce(sum(amount) filter (where (created_at at time zone 'Europe/Prague')::date between p_from and p_to), 0)::bigint as cash
    from public.vouchers
  ),
  cost_values as (
    select
      coalesce(sum(amount_minor) filter (where status = 'paid' and include_in_operating and period_start between p_from and p_to), 0)::bigint as operating,
      coalesce(sum(amount_minor) filter (where status = 'paid' and coalesce(paid_on, scheduled_on) between p_from and p_to), 0)::bigint as cash
    from public.business_cost_occurrences
  ),
  ledger_values as (
    select
      coalesce(sum(amount_minor) filter (where kind = 'income' and booking_id is null and voucher_id is null), 0)::bigint as income,
      coalesce(sum(amount_minor) filter (where kind = 'refund'), 0)::bigint as refunds,
      coalesce(sum(amount_minor) filter (where kind = 'fee' and cost_occurrence_id is null), 0)::bigint as fees,
      coalesce(sum(amount_minor) filter (where kind = 'ad_spend' and cost_occurrence_id is null), 0)::bigint as ads,
      coalesce(sum(amount_minor) filter (where kind = 'expense' and cost_occurrence_id is null), 0)::bigint as expenses
    from public.business_ledger_entries
    where status = 'posted' and (occurred_at at time zone 'Europe/Prague')::date between p_from and p_to
  )
  select jsonb_build_object(
    'recognized_revenue_minor', b.revenue,
    'cash_sales_minor', b.cash + v.cash + x.income - x.refunds,
    'operating_costs_minor', c.operating + x.fees + x.ads + x.expenses,
    'operating_result_minor', b.revenue - x.refunds - c.operating - x.fees - x.ads - x.expenses,
    'cash_flow_minor', b.cash + v.cash + x.income - x.refunds - c.cash - x.fees - x.ads - x.expenses,
    'paid_spots', b.spots,
    'voucher_sales_minor', v.cash,
    'refunds_minor', x.refunds,
    'fees_minor', x.fees,
    'ad_spend_minor', x.ads,
    'missing_payment_amounts', b.missing_amounts,
    'complete', b.missing_amounts = 0
  ) into result
  from booking_values b cross join voucher_values v cross join cost_values c cross join ledger_values x;
  return result;
end;
$$;
revoke execute on function public.business_period_summary(date, date) from public, anon;
grant execute on function public.business_period_summary(date, date) to authenticated;

-- Nová verze pravidla atomicky uzavře předchozí aktivní verzi.
create or replace function public.business_close_previous_cost_rule()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.version > 1 then
    update public.business_cost_rules
      set status = 'archived', valid_to = least(coalesce(valid_to, new.valid_from - 1), new.valid_from - 1)
      where rule_key = new.rule_key and version < new.version and status = 'active';
  end if;
  return new;
end;
$$;
revoke execute on function public.business_close_previous_cost_rule() from public, anon, authenticated;
drop trigger if exists business_cost_rules_close_previous on public.business_cost_rules;
create trigger business_cost_rules_close_previous
  before insert on public.business_cost_rules
  for each row execute function public.business_close_previous_cost_rule();

-- Dohledatelná historie důležitých změn.
create or replace function public.business_audit_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.business_change_log (table_name, row_id, action, before_data, after_data)
  values (
    tg_table_name,
    coalesce((case when tg_op = 'DELETE' then old.id else new.id end)::text, ''),
    tg_op,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke execute on function public.business_audit_change() from public, anon, authenticated;

do $$
declare table_name text;
begin
  foreach table_name in array array['business_cost_rules','business_cost_occurrences','business_budgets','business_campaigns','business_goals','business_scenarios'] loop
    execute format('drop trigger if exists %I on public.%I', table_name || '_audit', table_name);
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function public.business_audit_change()',
      table_name || '_audit', table_name
    );
  end loop;
end $$;

-- Cron se záměrně NEzapíná automaticky. Po ověření migrace lze naplánovat:
-- select cron.schedule(
--   'business-costs-nightly',
--   '20 2 * * *',
--   $$select public.business_generate_calendar_costs(current_date, current_date + 120)$$
-- );
