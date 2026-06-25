-- =====================================================================
--  Jóga s králíčky — databázové schéma pro Supabase
--  Spusť celý tento soubor v Supabase: SQL Editor → New query → Run.
--  Je bezpečné spustit ho víckrát (používá IF NOT EXISTS / OR REPLACE).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) KDO JE MAJITELKA
--    Změň e-mail níže na ten, kterým se budeš přihlašovat do adminu.
--    Jen tento účet smí spravovat lekce a rezervace.
-- ---------------------------------------------------------------------
create or replace function public.is_owner() returns boolean
language sql stable as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'kovacikovabarbora71@gmail.com'  -- majitelka
$$;

-- ---------------------------------------------------------------------
-- 1) TABULKY
-- ---------------------------------------------------------------------
create table if not exists public.lessons (
  id           uuid primary key default gen_random_uuid(),
  title        text        not null,
  starts_at    timestamptz not null,
  duration_min integer     not null default 60,
  capacity     integer     not null default 12 check (capacity >= 0),
  status       text        not null default 'active' check (status in ('active','cancelled')),
  note         text,
  created_at   timestamptz not null default now()
);
create index if not exists lessons_starts_at_idx on public.lessons (starts_at);

create table if not exists public.bookings (
  id         uuid primary key default gen_random_uuid(),
  lesson_id  uuid        not null references public.lessons(id) on delete cascade,
  name       text        not null,
  email      text        not null,
  phone      text,
  spots      integer     not null default 1 check (spots >= 1 and spots <= 8),
  status     text        not null default 'confirmed' check (status in ('confirmed','cancelled')),
  created_at timestamptz not null default now()
);
create index if not exists bookings_lesson_idx on public.bookings (lesson_id);

-- ---------------------------------------------------------------------
-- 2) VEŘEJNÝ POHLED — co vidí návštěvník (žádná osobní data, jen počty)
--    Pohled běží s právy vlastníka, takže reálně spočítá obsazenost,
--    ale ven pustí jen číslo "remaining" (kolik míst zbývá).
-- ---------------------------------------------------------------------
create or replace view public.public_lessons as
  select
    l.id,
    l.title,
    l.starts_at,
    l.duration_min,
    l.capacity,
    greatest(
      l.capacity - coalesce(sum(b.spots) filter (where b.status <> 'cancelled'), 0),
      0
    )::int as remaining
  from public.lessons l
  left join public.bookings b on b.lesson_id = l.id
  where l.status = 'active' and l.starts_at > now()
  group by l.id;

grant select on public.public_lessons to anon, authenticated;

-- ---------------------------------------------------------------------
-- 3) BEZPEČNOST (Row Level Security)
-- ---------------------------------------------------------------------
alter table public.lessons  enable row level security;
alter table public.bookings enable row level security;

-- Lekce: číst/měnit smí jen majitelka (návštěvník čte přes public_lessons).
drop policy if exists lessons_owner_all on public.lessons;
create policy lessons_owner_all on public.lessons
  for all using (public.is_owner()) with check (public.is_owner());

-- Rezervace: vidět a spravovat smí jen majitelka.
-- (Návštěvník nezapisuje přímo — používá funkci create_booking níže.)
drop policy if exists bookings_owner_all on public.bookings;
create policy bookings_owner_all on public.bookings
  for all using (public.is_owner()) with check (public.is_owner());

-- ---------------------------------------------------------------------
-- 4) REZERVACE BEZ PŘEBUKOVÁNÍ (atomická funkce volaná z webu)
--    Zamkne lekci, spočítá volno a teprve pak zapíše. Dva souběžní
--    zájemci se tak neperou o totéž poslední místo.
-- ---------------------------------------------------------------------
create or replace function public.create_booking(
  p_lesson_id uuid,
  p_name      text,
  p_email     text,
  p_phone     text,
  p_spots     int
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  l         public.lessons%rowtype;
  booked    int;
  remaining int;
  new_id    uuid;
begin
  if p_spots is null or p_spots < 1 or p_spots > 4 then
    return json_build_object('ok', false, 'error', 'invalid_spots');
  end if;
  if coalesce(btrim(p_name), '') = '' or coalesce(btrim(p_email), '') = '' then
    return json_build_object('ok', false, 'error', 'missing_contact');
  end if;

  select * into l from public.lessons where id = p_lesson_id for update;
  if not found or l.status <> 'active' or l.starts_at <= now() then
    return json_build_object('ok', false, 'error', 'unavailable');
  end if;

  select coalesce(sum(spots), 0) into booked
    from public.bookings where lesson_id = p_lesson_id and status <> 'cancelled';
  remaining := l.capacity - booked;

  if remaining < p_spots then
    return json_build_object('ok', false, 'error', 'full', 'remaining', greatest(remaining, 0));
  end if;

  insert into public.bookings (lesson_id, name, email, phone, spots, status)
    values (p_lesson_id, btrim(p_name), btrim(p_email), nullif(btrim(p_phone), ''), p_spots, 'confirmed')
    returning id into new_id;

  return json_build_object('ok', true, 'booking_id', new_id, 'remaining', remaining - p_spots);
end;
$$;

grant execute on function public.create_booking(uuid, text, text, text, int) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 5) (NEPOVINNÉ) Ukázková lekce, ať hned něco vidíš. Klidně smaž.
-- ---------------------------------------------------------------------
-- insert into public.lessons (title, starts_at, duration_min, capacity)
-- values ('Hatha s králíčky', now() + interval '2 days', 75, 12);
