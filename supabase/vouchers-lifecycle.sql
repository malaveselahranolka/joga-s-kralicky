-- =====================================================================
--  Jóga s králíčky — životní cyklus poukazu + deník Stripe událostí
--  Spusť: Supabase → SQL Editor → New query → Run. Bezpečné víckrát.
--  Předpoklad: už máš spuštěné schema.sql a vouchers.sql.
--
--  PROČ TENHLE SOUBOR VZNIKL
--  Produkční databáze měla dvě věci, které v repu nebyly vůbec:
--  sloupec vouchers.expires_at a celou tabulku stripe_events. Obojí
--  přitom Edge funkce potřebují k životu — čerstvé nasazení z repa by
--  tedy webhook rozbilo a nikdo by neměl jak to zopakovat. Tenhle skript
--  ten stav dopisuje, ať jde databáze postavit znovu jen z gitu.
--
--  A opravuje díru: uplatněný poukaz šel „oživit" tím, že zákazník znovu
--  otevřel návratovou adresu po platbě. Funkce tam dělaly upsert, který
--  přepsal redeemed zpátky na false a posunul platnost o rok dál.
--  Uplatnění teď dělá jediná funkce, atomicky, a expiraci kontroluje sama.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) PLATNOST POUKAZU
--    Obchodní podmínky slibují 12 měsíců — držíme ji i v datech.
--    Poukazům, které vznikly dřív, dopočítáme rok od založení.
-- ---------------------------------------------------------------------
alter table public.vouchers
  add column if not exists expires_at timestamptz;

update public.vouchers
   set expires_at = created_at + interval '365 days'
 where expires_at is null;

comment on column public.vouchers.expires_at is
  'Do kdy poukaz platí. Nastavuje se JEN při vystavení, nikdy se neposouvá.';

create index if not exists vouchers_code_idx     on public.vouchers (code);
create index if not exists vouchers_redeemed_idx on public.vouchers (redeemed, expires_at);

-- ---------------------------------------------------------------------
-- 2) UPLATNĚNÍ POUKAZU — atomicky, jednou, a jen dokud platí
--    Podmínka je uvnitř UPDATE, ne v aplikaci: dva současné skeny tak
--    nemůžou projít oba. Kdo nezmění řádek, dostane důvod proč.
-- ---------------------------------------------------------------------
create or replace function public.redeem_voucher(p_code text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.vouchers%rowtype;
  c text := upper(btrim(coalesce(p_code, '')));
begin
  if not public.is_owner() then
    return json_build_object('ok', false, 'error', 'forbidden');
  end if;

  update public.vouchers
     set redeemed    = true,
         redeemed_at = now()
   where code = c
     and redeemed = false
     and (expires_at is null or expires_at > now())
  returning * into v;

  if found then
    return json_build_object('ok', true, 'code', v.code, 'redeemed_at', v.redeemed_at);
  end if;

  -- Nic se nezměnilo — řekni proč, ať admin ukáže správnou hlášku.
  select * into v from public.vouchers where code = c;
  if not found then
    return json_build_object('ok', false, 'error', 'unknown');
  end if;
  if v.redeemed then
    return json_build_object('ok', false, 'error', 'already_redeemed', 'redeemed_at', v.redeemed_at);
  end if;
  return json_build_object('ok', false, 'error', 'expired', 'expires_at', v.expires_at);
end;
$$;

revoke execute on function public.redeem_voucher(text) from public, anon;
grant  execute on function public.redeem_voucher(text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3) VRÁCENÍ PLATNOSTI — omyl u dveří se musí dát opravit.
--    Platnost se přitom NEPOSOUVÁ, jen se zruší odškrtnutí.
-- ---------------------------------------------------------------------
create or replace function public.unredeem_voucher(p_code text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.vouchers%rowtype;
  c text := upper(btrim(coalesce(p_code, '')));
begin
  if not public.is_owner() then
    return json_build_object('ok', false, 'error', 'forbidden');
  end if;

  update public.vouchers
     set redeemed = false, redeemed_at = null
   where code = c and redeemed = true
  returning * into v;

  if not found then
    return json_build_object('ok', false, 'error', 'not_redeemed');
  end if;
  return json_build_object('ok', true, 'code', v.code);
end;
$$;

revoke execute on function public.unredeem_voucher(text) from public, anon;
grant  execute on function public.unredeem_voucher(text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4) DENÍK STRIPE UDÁLOSTÍ
--    Vložení event.id je zámek proti dvojímu zpracování téže události.
--    Zapisuje výhradně stripe-webhook přes service_role (mimo RLS),
--    čte majitelka v adminu.
-- ---------------------------------------------------------------------
create table if not exists public.stripe_events (
  id          text primary key,          -- evt_… od Stripu
  type        text not null,             -- checkout.session.completed, …
  status      text not null default 'processing',
                                         -- processing | processed | rejected
                                         -- | ignored | skipped | failed
  error       text,                      -- důvod odmítnutí, ať je v adminu vidět
  booking_id  uuid references public.bookings (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists stripe_events_created_idx on public.stripe_events (created_at desc);
create index if not exists stripe_events_status_idx  on public.stripe_events (status);

alter table public.stripe_events enable row level security;

drop policy if exists stripe_events_owner_all on public.stripe_events;
create policy stripe_events_owner_all on public.stripe_events
  for all using (public.is_owner()) with check (public.is_owner());

-- ---------------------------------------------------------------------
-- 5) SROVNÁNÍ STARŠÍCH DATABÁZÍ
--    Tabulka stripe_events vznikla v produkci ručně, dřív než pro ni bylo
--    DDL v repu — a měla výchozí stav 'processed'. To je nebezpečné: řádek
--    vložený bez stavu by se tvářil jako hotová událost, i když se nikdy
--    nezpracovala, a druhé doručení by ji pak přeskočilo jako duplicitu.
--    Webhook stav vždycky vyplňuje sám, takže se to nikdy neprojevilo,
--    ale spoléhat na to nechceme.
--
--    Na čerstvé databázi jsou tyhle příkazy prázdné (create table výš už
--    to nastaví správně), na té existující srovnají rozdíl.
-- ---------------------------------------------------------------------
alter table public.stripe_events alter column status set default 'processing';

-- Hotovo. Poukaz teď nejde oživit ani prodloužit opakovanou platbou
-- a webhook má tabulku, kterou k idempotenci potřebuje.
