-- =====================================================================
--  Jóga s králíčky — PLATBA POUZE ONLINE + rezervace pro víc osob
--  Spusť: Supabase → SQL Editor → New query → Run. Bezpečné víckrát.
--  Předpoklad: už máš spuštěné schema.sql, payments.sql a tickets.sql.
--
--  Co se mění:
--   1) Rezervace z webu vzniká jako NEZAPLACENÁ a místo se drží 35 minut
--      (hold_expires_at). Nezaplacené propadlé rezervace místo neblokují.
--   2) Kapacita se počítá tak, aby propadlé držení nesnižovalo volná místa.
--   3) Na jedno jméno lze rezervovat víc míst (1–8); cenu × počet míst
--      spočítá platební brána (funkce stripe-create).
--   4) hold_booking() — před založením platby ověří, že místa pořád jsou,
--      a prodlouží držení. Volá ji jen server (service_role).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) DRŽENÍ MÍSTA DO ZAPLACENÍ
-- ---------------------------------------------------------------------
alter table public.bookings add column if not exists hold_expires_at timestamptz;

create index if not exists bookings_hold_idx on public.bookings (hold_expires_at);

comment on column public.bookings.hold_expires_at is
  'Do kdy držíme místo nezaplacené rezervaci. NULL = drží se napořád (ruční rezervace z adminu).';

-- ---------------------------------------------------------------------
-- 2) KTERÁ REZERVACE ZABÍRÁ MÍSTO
--    Zaplacené vždy. Nezaplacené jen dokud běží držení.
--    Ruční rezervace z adminu (hold_expires_at IS NULL) také vždy.
-- ---------------------------------------------------------------------
create or replace function public.booking_holds_seat(
  p_status     text,
  p_pay_status text,
  p_hold       timestamptz
) returns boolean
language sql stable as $$   -- stable, ne immutable: uvnitř je now()
  select p_status <> 'cancelled'
     and (p_pay_status = 'paid' or p_hold is null or p_hold > now())
$$;

-- ---------------------------------------------------------------------
-- 3) VEŘEJNÝ POHLED — volná místa počítaná se stejným pravidlem
-- ---------------------------------------------------------------------
create or replace view public.public_lessons as
  select
    l.id,
    l.title,
    l.starts_at,
    l.duration_min,
    l.capacity,
    greatest(
      l.capacity - coalesce(sum(b.spots) filter (
        where public.booking_holds_seat(b.status, b.payment_status, b.hold_expires_at)
      ), 0),
      0
    )::int as remaining
  from public.lessons l
  left join public.bookings b on b.lesson_id = l.id
  where l.status = 'active' and l.starts_at > now()
  group by l.id;

grant select on public.public_lessons to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4) REZERVACE — vzniká nezaplacená, s držením místa
--    Podpis zůstává stejný, web nemusí nic měnit.
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
  hold_min  constant int := 35;   -- musí sedět s payment-config.js (holdMinutes)
  hold_till timestamptz;
begin
  -- na jedno jméno smí být víc lidí; strop drží i CHECK na tabulce (1–8)
  if p_spots is null or p_spots < 1 or p_spots > 8 then
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
    from public.bookings
    where lesson_id = p_lesson_id
      and public.booking_holds_seat(status, payment_status, hold_expires_at);
  remaining := l.capacity - booked;

  if remaining < p_spots then
    return json_build_object('ok', false, 'error', 'full', 'remaining', greatest(remaining, 0));
  end if;

  hold_till := now() + make_interval(mins => hold_min);

  insert into public.bookings (lesson_id, name, email, phone, spots, status, payment_status, hold_expires_at)
    values (p_lesson_id, btrim(p_name), btrim(p_email), nullif(btrim(p_phone), ''), p_spots,
            'confirmed', 'pending', hold_till)
    returning id into new_id;

  return json_build_object(
    'ok', true,
    'booking_id', new_id,
    'remaining', remaining - p_spots,
    'hold_expires_at', hold_till
  );
end;
$$;

grant execute on function public.create_booking(uuid, text, text, text, int) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 5) PRODLOUŽENÍ DRŽENÍ PŘED PLATBOU (volá jen server, ne prohlížeč)
--    Ověří, že místa pořád jsou — ať nikdo neplatí za obsazenou lekci.
-- ---------------------------------------------------------------------
create or replace function public.hold_booking(p_id uuid, p_minutes int default 35)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  b         public.bookings%rowtype;
  l         public.lessons%rowtype;
  booked    int;
  hold_till timestamptz;
begin
  select * into b from public.bookings where id = p_id;
  if not found then return json_build_object('ok', false, 'error', 'booking_not_found'); end if;
  if b.status = 'cancelled' then return json_build_object('ok', false, 'error', 'booking_cancelled'); end if;
  if b.payment_status = 'paid' then return json_build_object('ok', true, 'already_paid', true); end if;

  select * into l from public.lessons where id = b.lesson_id for update;
  if not found or l.status <> 'active' or l.starts_at <= now() then
    return json_build_object('ok', false, 'error', 'unavailable');
  end if;

  -- kolik míst drží ostatní (tuhle rezervaci nepočítáme)
  select coalesce(sum(spots), 0) into booked
    from public.bookings
    where lesson_id = b.lesson_id
      and id <> b.id
      and public.booking_holds_seat(status, payment_status, hold_expires_at);

  if l.capacity - booked < b.spots then
    return json_build_object('ok', false, 'error', 'full', 'remaining', greatest(l.capacity - booked, 0));
  end if;

  hold_till := now() + make_interval(mins => greatest(coalesce(p_minutes, 35), 5));
  update public.bookings
     set hold_expires_at = hold_till,
         payment_status  = case when payment_status = 'paid' then payment_status else 'pending' end
   where id = b.id;

  return json_build_object('ok', true, 'hold_expires_at', hold_till);
end;
$$;

-- Tuhle funkci nesmí volat návštěvník (jinak by si držel místa donekonečna).
revoke execute on function public.hold_booking(uuid, int) from public, anon, authenticated;
grant  execute on function public.hold_booking(uuid, int) to service_role;

-- ---------------------------------------------------------------------
-- 6) ÚKLID PROPADLÝCH REZERVACÍ (nepovinné, jen pro pořádek v adminu)
--    Místo uvolní už samo pravidlo výše; tohle je jen kosmetika.
-- ---------------------------------------------------------------------
create or replace function public.release_expired_holds()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  update public.bookings
     set status = 'cancelled', payment_status = 'cancelled'
   where status = 'confirmed'
     and payment_status <> 'paid'
     and hold_expires_at is not null
     and hold_expires_at < now() - interval '2 hours';
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.release_expired_holds() from public, anon, authenticated;
grant  execute on function public.release_expired_holds() to service_role;

-- Chceš úklid automaticky? V Supabase zapni rozšíření pg_cron a spusť:
--   select cron.schedule('uklid-rezervaci', '17 * * * *', $$select public.release_expired_holds()$$);

-- ---------------------------------------------------------------------
-- 7) STAV REZERVACE (vstupenka) — přidán čas držení a zaplacená částka
-- ---------------------------------------------------------------------
create or replace function public.get_ticket(p_id uuid)
returns json
language sql
security definer
stable
set search_path = public
as $$
  select json_build_object(
    'name',            b.name,
    'spots',           b.spots,
    'status',          b.status,
    'payment_status',  b.payment_status,
    'payment_method',  b.payment_method,
    'payment_amount',  b.payment_amount,
    'hold_expires_at', b.hold_expires_at,
    'paid_at',         b.paid_at,
    'lesson',          l.title,
    'starts_at',       l.starts_at,
    'duration_min',    l.duration_min,
    'lesson_status',   l.status
  )
  from public.bookings b
  join public.lessons  l on l.id = b.lesson_id
  where b.id = p_id;
$$;

grant execute on function public.get_ticket(uuid) to anon, authenticated;

-- Hotovo. Rezervace teď platí až po online platbě; nezaplacené místo se
-- po 35 minutách samo vrátí do nabídky.
