-- ---------------------------------------------------------------------
-- ODKUD ZÁKAZNÍK PŘIŠEL
--
-- Jediné číslo z celého marketingu, které se nedá zjistit zpětně: co
-- člověka přivedlo. Analytika ukáže poslední kliknutí, ne to, že o nás
-- slyšel od kamarádky před měsícem.
--
-- Záměrně samostatná tabulka, ne sloupec v bookings:
--   * signatura create_booking() zůstává beze změny, takže nasazení
--     tohohle souboru nemůže rozbít probíhající rezervace,
--   * web zapisuje až PO úspěšné rezervaci a na výsledku nezávisí —
--     když zápis selže, zákazník o tom neví a platba proběhne.
--
-- Spustit v Supabase → SQL Editor. Je to bezpečné pustit i opakovaně.
-- ---------------------------------------------------------------------

create table if not exists public.booking_sources (
  booking_id uuid        primary key references public.bookings(id) on delete cascade,
  source     text        not null check (char_length(source) <= 40),
  created_at timestamptz not null default now()
);

alter table public.booking_sources enable row level security;

-- Vlastník (přihlášený admin) vidí a spravuje všechno.
drop policy if exists booking_sources_owner_all on public.booking_sources;
create policy booking_sources_owner_all on public.booking_sources
  for all
  to authenticated
  using (true)
  with check (true);

-- Návštěvník smí jen vložit řádek k rezervaci, která existuje a vznikla
-- v posledních 15 minutách — tedy k té své. Nic nečte a nic nemění.
drop policy if exists booking_sources_anon_insert on public.booking_sources;
create policy booking_sources_anon_insert on public.booking_sources
  for insert
  to anon, authenticated
  with check (
    exists (
      select 1
      from public.bookings b
      where b.id = booking_sources.booking_id
        and b.created_at > now() - interval '15 minutes'
    )
  );

grant insert on public.booking_sources to anon, authenticated;
grant select on public.booking_sources to authenticated;

-- ---------------------------------------------------------------------
-- PŘEHLED PRO ADMINA
-- Kolik rezervací a kolik míst přišlo z jakého zdroje. „neuvedeno“ jsou
-- lidé, kteří pole nevyplnili — je nepovinné, takže jich bude dost.
-- ---------------------------------------------------------------------

create or replace view public.booking_source_stats as
select
  coalesce(s.source, 'neuvedeno') as source,
  count(*)                        as bookings,
  sum(b.spots)                    as spots,
  min(b.created_at)               as first_seen,
  max(b.created_at)               as last_seen
from public.bookings b
left join public.booking_sources s on s.booking_id = b.id
where b.status = 'confirmed'
group by 1
order by 2 desc;

grant select on public.booking_source_stats to authenticated;
