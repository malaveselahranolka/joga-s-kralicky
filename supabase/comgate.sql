-- =====================================================================
--  Jóga s králíčky — rozšíření DB o platby Comgate (zálohy, volitelné)
--  Spusť až KDYŽ chceš zapnout platby: Supabase → SQL Editor → Run.
--  Je bezpečné spustit víckrát (IF NOT EXISTS / OR REPLACE).
--
--  Platba je nepovinná: rezervace vzniká dál přes create_booking a je
--  platná i bez platby. Tyhle sloupce jen evidují případnou zálohu.
-- =====================================================================

-- 1) Sloupce pro stav platby na rezervaci -----------------------------
alter table public.bookings add column if not exists payment_status text not null default 'none'
  check (payment_status in ('none','pending','paid','cancelled','failed'));
alter table public.bookings add column if not exists payment_amount integer;          -- v haléřích (Kč × 100)
alter table public.bookings add column if not exists payment_ref    text;             -- Comgate transId
alter table public.bookings add column if not exists paid_at        timestamptz;

create index if not exists bookings_payment_ref_idx on public.bookings (payment_ref);

-- 2) Veřejné dohledání stavu platby podle Comgate transId -------------
--    Edge funkce „comgate-status" běží přes service-role a tohle nepotřebuje,
--    ale hodí se pro návratovou stránku, kdyby ses chtěl ptát i z prohlížeče.
--    Vrací jen stav (žádná osobní data).
create or replace function public.payment_status_by_ref(p_ref text)
returns text
language sql
security definer
set search_path = public
as $$
  select payment_status from public.bookings where payment_ref = p_ref limit 1
$$;
grant execute on function public.payment_status_by_ref(text) to anon, authenticated;

-- Hotovo. Žádná osobní data se ven nepouští — jen stav platby.
