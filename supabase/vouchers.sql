-- =====================================================================
--  Jóga s králíčky — dárkové poukazy
--  Spusť: Supabase → SQL Editor → New query → Run. Bezpečné víckrát.
--
--  Poukaz koupí zákazník přes Stripe. Webhook sem uloží kód a e-mail.
--  Uplatnění je „na místě" — majitelka poukaz najde/odškrtne v adminu.
-- =====================================================================

create table if not exists public.vouchers (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,     -- např. DK-AB12CD34
  email       text,                     -- komu byl vystaven (kupující)
  amount      integer,                  -- v haléřích (Kč × 100)
  session_id  text,                     -- Stripe Checkout session
  redeemed    boolean not null default false,
  redeemed_at timestamptz,
  created_at  timestamptz not null default now()
);

alter table public.vouchers enable row level security;

-- Vidí a spravuje jen majitelka. Zápis dělá webhook přes service-role (mimo RLS).
drop policy if exists vouchers_owner_all on public.vouchers;
create policy vouchers_owner_all on public.vouchers
  for all using (public.is_owner()) with check (public.is_owner());
