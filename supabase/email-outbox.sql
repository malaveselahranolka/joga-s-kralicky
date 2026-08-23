-- =====================================================================
--  Jóga s králíčky — fronta odchozích e-mailů
--  Spusť: Supabase → SQL Editor → New query → Run. Bezpečné víckrát.
--  Předpoklad: schema.sql, online-only.sql, vouchers-lifecycle.sql.
--
--  PROČ TO EXISTUJE
--  Potvrzení s QR kódem a kódy poukazů se posílaly z prohlížeče. To
--  znamená, že e-mail vznikl jen tehdy, když zákazníkovi po platbě
--  doběhla návratová stránka. Zavřel záložku, zaplatil na mobilu
--  a potvrzení otevřel na notebooku, nebo EmailJS na vteřinu zaškobrtl?
--  E-mail se neodeslal a nikdo se to nedozvěděl — chyba se polykala.
--  Přesně tak 21. 8. 2026 skončil zaplacený poukaz bez kódu.
--
--  Fronta to obrací: co se má odeslat, se nejdřív ZAPÍŠE, a teprve pak
--  se to zkouší odeslat. Když odeslání selže, řádek zůstane a zkusí se
--  znovu. Prohlížeč zůstává jako druhá cesta, ale už na něm nic nestojí.
--
--  Posílá se pořád přes EmailJS a přes tytéž šablony. Změnilo se jen to,
--  ODKUD se to spouští — ze serveru (stripe-webhook), ne z prohlížeče.
-- =====================================================================

create table if not exists public.email_outbox (
  id          uuid primary key default gen_random_uuid(),

  -- Klíč objednávky. Díky unique se tentýž e-mail nezaloží dvakrát, ať
  -- webhook dorazí kolikrát chce: 'booking:<uuid>', 'voucher:<kód>'.
  order_key   text unique not null,

  kind        text not null,          -- 'booking' | 'voucher'
  to_email    text not null,
  template_id text not null,          -- EmailJS šablona
  params      jsonb not null,         -- co se do šablony dosadí

  status      text not null default 'pending',
                                      -- pending = čeká nebo se zkusí znovu
                                      -- sent    = doručeno EmailJS
                                      -- failed  = vzdali jsme to, řeší člověk
  attempts    int  not null default 0,
  last_error  text,

  created_at      timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  sent_at         timestamptz
);

-- Dispatcher se ptá „co je ke zpracování" — ať to nemusí číst celou tabulku.
create index if not exists email_outbox_due_idx
  on public.email_outbox (next_attempt_at)
  where status = 'pending';

create index if not exists email_outbox_status_idx on public.email_outbox (status, created_at desc);

alter table public.email_outbox enable row level security;

-- Zapisuje jen server (service_role, mimo RLS). Majitelka to vidí v adminu.
drop policy if exists email_outbox_owner_read on public.email_outbox;
create policy email_outbox_owner_read on public.email_outbox
  for select using (public.is_owner());

-- ---------------------------------------------------------------------
--  VYZVEDNUTÍ DÁVKY K ODESLÁNÍ
--
--  `for update skip locked` je tu podstatné: kdyby dispatcher běžel
--  dvakrát naráz (cron se potká s ručním „poslat znovu" v adminu),
--  druhý běh ty samé řádky přeskočí místo aby čekal. Bez toho by šel
--  jeden e-mail odeslat dvakrát.
--
--  Pokus se počítá UŽ TEĎ, ne až po odeslání. Kdyby funkce uprostřed
--  spadla, řádek se sám odloží místo aby se zacyklil.
--
--  Odklad: 1 min → 5 min → 30 min → 2 h. Po pátém pokusu 'failed'
--  a čeká na člověka.
-- ---------------------------------------------------------------------
create or replace function public.claim_email_batch(p_limit int default 10)
returns setof public.email_outbox
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Přes CTE, ne `return query update ...` — RETURN QUERY čeká dotaz,
  -- ne měnící příkaz, a takhle zapsané by to nešlo ani vytvořit.
  return query
  with vybrane as (
    select id from public.email_outbox
     where status = 'pending'
       and next_attempt_at <= now()
     order by created_at
     limit greatest(1, least(coalesce(p_limit, 10), 50))
     for update skip locked
  ), zabrane as (
    update public.email_outbox o
       set attempts        = o.attempts + 1,
           next_attempt_at = now() + case o.attempts
                                       when 0 then interval '1 minute'
                                       when 1 then interval '5 minutes'
                                       when 2 then interval '30 minutes'
                                       else        interval '2 hours'
                                     end,
           status          = case when o.attempts + 1 >= 5 then 'failed' else 'pending' end
      from vybrane v
     where o.id = v.id
    returning o.*
  )
  select * from zabrane;
end;
$$;

revoke execute on function public.claim_email_batch(int) from public, anon, authenticated;
grant  execute on function public.claim_email_batch(int) to service_role;

-- ---------------------------------------------------------------------
--  VÝSLEDEK ODESLÁNÍ
-- ---------------------------------------------------------------------
create or replace function public.mark_email_sent(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.email_outbox
     set status = 'sent', sent_at = now(), last_error = null, next_attempt_at = now()
   where id = p_id;
$$;

revoke execute on function public.mark_email_sent(uuid) from public, anon, authenticated;
grant  execute on function public.mark_email_sent(uuid) to service_role;

create or replace function public.mark_email_error(p_id uuid, p_error text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.email_outbox
     set last_error = left(coalesce(p_error, ''), 500)
   where id = p_id;
$$;

revoke execute on function public.mark_email_error(uuid, text) from public, anon, authenticated;
grant  execute on function public.mark_email_error(uuid, text) to service_role;

-- ---------------------------------------------------------------------
--  RUČNÍ ODESLÁNÍ ZNOVU (tlačítko v adminu)
--  Vrátí vzdaný e-mail do fronty a vynuluje odklad, ať jde hned.
-- ---------------------------------------------------------------------
create or replace function public.retry_email(p_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  if not public.is_owner() then
    return json_build_object('ok', false, 'error', 'forbidden');
  end if;

  update public.email_outbox
     set status = 'pending', attempts = 0, next_attempt_at = now(), last_error = null
   where id = p_id and status <> 'sent';
  get diagnostics n = row_count;

  if n = 0 then return json_build_object('ok', false, 'error', 'not_found_or_sent'); end if;
  return json_build_object('ok', true);
end;
$$;

revoke execute on function public.retry_email(uuid) from public, anon;
grant  execute on function public.retry_email(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
--  ÚKLID
--  Doručené e-maily po půl roce zahodíme — je v nich jméno a adresa
--  hosta a k ničemu už neslouží. Nedoručené necháváme vždycky.
-- ---------------------------------------------------------------------
create or replace function public.purge_sent_emails()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  delete from public.email_outbox
   where status = 'sent' and sent_at < now() - interval '180 days';
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.purge_sent_emails() from public, anon, authenticated;
grant  execute on function public.purge_sent_emails() to service_role;

-- Hotovo. Co se má odeslat, je teď zapsané dřív, než se to zkusí odeslat.
