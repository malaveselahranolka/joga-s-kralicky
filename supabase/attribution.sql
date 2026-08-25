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
--
-- ---------------------------------------------------------------------
-- POZOR, ČTI PŘED NASAZENÍM
--
-- Dřívější verze tohohle souboru měla čtecí pravidlo `using (true)` pro
-- roli `authenticated` a k tomu `grant select`. To znamenalo: KDOKOLI
-- s potvrzeným účtem si mohl přečíst celou tabulku, tedy i booking_id
-- všech rezervací. A protože public.get_ticket(uuid) je veřejná
-- SECURITY DEFINER funkce, dá se z každého takového UUID vytáhnout jméno,
-- termín a stav platby. Tabulka se naštěstí nikdy nenasadila.
--
-- Teď platí: číst smí jen majitelka (public.is_owner()), návštěvník smí
-- pouze zapsat řádek ke své čerstvé rezervaci a nic si nepřečte.
-- ---------------------------------------------------------------------

create table if not exists public.booking_sources (
  booking_id uuid        primary key references public.bookings(id) on delete cascade,
  source     text        not null check (char_length(source) <= 40),
  created_at timestamptz not null default now()
);

alter table public.booking_sources enable row level security;

-- Vlastník (přihlášená majitelka) vidí a spravuje všechno.
-- Stejné pravidlo jako u bookings, lessons, vouchers a newsletteru.
drop policy if exists booking_sources_owner_all on public.booking_sources;
create policy booking_sources_owner_all on public.booking_sources
  for all
  to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- Návštěvník smí vložit řádek jen k rezervaci, která vznikla v posledních
-- 15 minutách — tedy k té své. Nic nečte a nic nemění.
--
-- POZOR na to, jak se ta podmínka ptá. Dřív tu stálo přímo
--     exists (select 1 from public.bookings b where b.id = ... and ...)
-- což nefunguje: podmínky v RLS se vyhodnocují právy VOLAJÍCÍHO a na
-- public.bookings je RLS puštěná jen pro majitelku. Anonymní návštěvník
-- tam neviděl ani vlastní čerstvou rezervaci, dotaz vrátil prázdno a zápis
-- se odmítl. Chyba se schovávala v tom, že web zápis dělá mimo hlavní tok
-- a výsledek zahazuje, takže se navenek nijak neprojevila.
--
-- Odpověď musí dát funkce, která se přes RLS podívat smí. Vrací jen ano/ne
-- k předloženému UUID; kdo ho nemá, nedozví se nic, a UUID je náhodné.
create or replace function public.booking_je_cerstva(p_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.bookings b
    where b.id = p_id
      and b.created_at > now() - interval '15 minutes'
  )
$$;

revoke execute on function public.booking_je_cerstva(uuid) from public;
grant execute on function public.booking_je_cerstva(uuid) to anon, authenticated;

drop policy if exists booking_sources_anon_insert on public.booking_sources;
create policy booking_sources_anon_insert on public.booking_sources
  for insert
  to anon, authenticated
  with check (public.booking_je_cerstva(booking_sources.booking_id));

-- Zápis ano, čtení ne. Kdo nemá SELECT, nevytáhne si seznam booking_id.
grant insert on public.booking_sources to anon, authenticated;
revoke select on public.booking_sources from anon, authenticated;
grant select on public.booking_sources to authenticated;

-- ---------------------------------------------------------------------
-- PŘEHLED PRO ADMINA
-- Kolik rezervací a kolik míst přišlo z jakého zdroje. „neuvedeno“ jsou
-- lidé, kteří pole nevyplnili — je nepovinné, takže jich bude dost.
--
-- security_invoker = on je tu podstatné: bez něj běží pohled s právy
-- svého vlastníka a obešel by RLS na bookings i booking_sources, takže
-- by statistiku (a s ní i počty rezervací) viděl každý přihlášený účet.
-- ---------------------------------------------------------------------

create or replace view public.booking_source_stats
with (security_invoker = on) as
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
