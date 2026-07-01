-- =====================================================================
--  Jóga s králíčky — rozšíření DB o evidenci plateb (zálohy, volitelné)
--  Spusť: Supabase → SQL Editor → New query → Run.
--  Je bezpečné spustit víckrát (IF NOT EXISTS).
--
--  Platba je nepovinná: rezervace vzniká dál přes create_booking a je
--  platná i bez platby. Tyhle sloupce jen evidují případnou zálohu
--  (online přes Stripe, nebo „na místě" odškrtnutou v adminu).
-- =====================================================================

alter table public.bookings add column if not exists payment_status text not null default 'none'
  check (payment_status in ('none','pending','paid','cancelled','failed'));
alter table public.bookings add column if not exists payment_amount integer;          -- v haléřích (Kč × 100)
alter table public.bookings add column if not exists payment_ref    text;             -- Stripe Checkout session id
alter table public.bookings add column if not exists paid_at        timestamptz;
alter table public.bookings add column if not exists payment_method text              -- jak se platilo
  check (payment_method in ('online','cash'));

create index if not exists bookings_payment_ref_idx on public.bookings (payment_ref);

-- Hotovo. Osobní data nikam ven nejdou — stav platby řeší admin a webhook (service-role).
