-- =====================================================================
--  Jóga s králíčky — lekce „Děti & králíčci“ (druh lekce + její pravidla)
--  Spusť: Supabase → SQL Editor → New query → Run. Bezpečné víckrát.
--  Předpoklad: schema.sql, online-only.sql, provoz-a-brzdy.sql,
--              vouchers*.sql, email-outbox.sql, poukaz-rezervace.sql,
--              rezervace-na-poukaz.sql, lesson-images.sql.
--
--  CO JE JINAK NEŽ U KLASICKÉ LEKCE
--  * Rezervuje zákonný zástupce s dětmi: 1 dospělý + 1 až 4 děti.
--  * Místa = LIDÉ (dospělý i děti). Kapacita lekce 12 = 12 osob.
--    Rezervace tedy drží 2 až 5 míst (bookings.spots).
--  * Cena: 1 090 Kč za zástupce s jedním dítětem + 500 Kč za každé další
--    dítě (nejvýš 3 další). Počítá ji server při platbě —
--    supabase/functions/stripe-create/index.ts. Tady se jen hlídá počet míst.
--  * Dárkový poukaz za 499 Kč platí jen na klasickou lekci. Na dětskou
--    lekci ho nejde uplatnit, a z dětské rezervace se poukaz nevystavuje
--    (jedno místo tu nemá cenu 499 Kč a poukaz na „místo“ by nedával smysl).
--
--  JAK SE LEKCE POZNÁ
--  Sloupec lessons.druh ('klasik' | 'deti'), ne název — název si
--  majitelka může přepsat, cena se podle něj řídit nesmí. Lekce se
--  zakládá ve správě šablonou „Děti & králíčci“, která druh nastaví.
--  Staré (už proběhlé) lekce s dětským názvem zůstávají 'klasik':
--  prodávaly se za 499 Kč za místo a tak mají zůstat i ve výkazech.
-- =====================================================================

-- 1) DRUH LEKCE -------------------------------------------------------
alter table public.lessons add column if not exists druh text not null default 'klasik';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lessons_druh_check') then
    alter table public.lessons add constraint lessons_druh_check check (druh in ('klasik', 'deti'));
  end if;
end $$;

-- 2) VEŘEJNÝ PŘEHLED LEKCÍ — přibývá druh (na konci, ať se nic neposune)
create or replace view public.public_lessons as
  select l.id,
         l.title,
         l.starts_at,
         l.duration_min,
         l.capacity,
         greatest(l.capacity - coalesce(sum(b.spots) filter (
           where public.booking_holds_seat(b.status, b.payment_status, b.hold_expires_at)), 0::bigint), 0::bigint)::integer as remaining,
         l.image_url,
         l.druh
    from public.lessons l
    left join public.bookings b on b.lesson_id = l.id
   where l.status = 'active' and l.starts_at > now()
   group by l.id;

grant select on public.public_lessons to anon, authenticated;

-- 3) REZERVACE — počet míst podle druhu lekce --------------------------
--    klasická: 1–4 místa (payment-config.js → maxSpots)
--    dětská:   2–5 míst = zástupce + 1 až 4 děti
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
  max_spots constant int := 4;    -- musí sedět s payment-config.js (maxSpots)
  deti_min  constant int := 2;    -- zástupce + 1 dítě
  deti_max  constant int := 5;    -- zástupce + 4 děti (1 + 3 navíc)
  hold_till timestamptz;
  v_name    text := btrim(coalesce(p_name, ''));
  v_email   text := lower(btrim(coalesce(p_email, '')));
  v_phone   text := nullif(btrim(coalesce(p_phone, '')), '');
begin
  if p_spots is null or p_spots < 1 or p_spots > greatest(max_spots, deti_max) then
    return json_build_object('ok', false, 'error', 'invalid_spots');
  end if;

  if char_length(v_name) < 2 or char_length(v_name) > 100 then
    return json_build_object('ok', false, 'error', 'missing_contact');
  end if;
  if char_length(v_email) > 200 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then
    return json_build_object('ok', false, 'error', 'missing_contact');
  end if;
  if v_phone is not null and char_length(v_phone) > 40 then
    return json_build_object('ok', false, 'error', 'missing_contact');
  end if;

  -- Brzda proti smyčce. Až za validací, ať se počítadlo nedá vytočit
  -- nesmyslnými vstupy, a před zápisem, ať se nic nezaloží.
  if public.rezervace_prilis_casto(v_email, p_lesson_id) then
    return json_build_object('ok', false, 'error', 'too_many_requests');
  end if;

  select * into l from public.lessons where id = p_lesson_id for update;
  if not found or l.status <> 'active' or l.starts_at <= now() then
    return json_build_object('ok', false, 'error', 'unavailable');
  end if;

  if l.druh = 'deti' then
    if p_spots < deti_min or p_spots > deti_max then
      return json_build_object('ok', false, 'error', 'invalid_spots');
    end if;
  elsif p_spots > max_spots then
    return json_build_object('ok', false, 'error', 'invalid_spots');
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
    values (p_lesson_id, v_name, v_email, v_phone, p_spots,
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

-- 4) UPLATNĚNÍ POUKAZU — jen na klasickou lekci -----------------------
--    Totožné s produkční verzí z poukaz-rezervace.sql, přibyla jen
--    kontrola druhu hned po načtení lekce (dřív, než se poukaz spotřebuje).
create or replace function public.create_booking_poukazem(
  p_lesson_id uuid,
  p_name      text,
  p_email     text,
  p_phone     text,
  p_code      text
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  l         public.lessons%rowtype;
  v         public.vouchers%rowtype;
  booked    int;
  remaining int;
  new_id    uuid;
  v_name    text := btrim(coalesce(p_name, ''));
  v_email   text := lower(btrim(coalesce(p_email, '')));
  v_phone   text := nullif(btrim(coalesce(p_phone, '')), '');
  c         text := upper(btrim(coalesce(p_code, '')));
  dny       constant text[] := array['neděle','pondělí','úterý','středa','čtvrtek','pátek','sobota'];
  misto     constant text := 'Fit&Fun Studio Ostrava, Tovární 486/7, 709 00 Ostrava-Mariánské Hory';
  kdy       text;
  vstupenka text;
begin
  if char_length(v_name) < 2 or char_length(v_name) > 100 then
    return json_build_object('ok', false, 'error', 'missing_contact');
  end if;
  if char_length(v_email) > 200 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+.[a-z]{2,}$' then
    return json_build_object('ok', false, 'error', 'missing_contact');
  end if;
  if v_phone is not null and char_length(v_phone) > 40 then
    return json_build_object('ok', false, 'error', 'missing_contact');
  end if;
  if c !~ '^[A-Z0-9-]{4,40}$' then
    return json_build_object('ok', false, 'error', 'unknown');
  end if;

  if public.poukaz_prilis_casto(v_email) then
    return json_build_object('ok', false, 'error', 'too_many_requests');
  end if;

  select * into l from public.lessons where id = p_lesson_id for update;
  if not found or l.status <> 'active' or l.starts_at <= now() then
    return json_build_object('ok', false, 'error', 'unavailable');
  end if;

  -- Poukaz za 499 Kč je na jedno místo klasické lekce. Dětská lekce
  -- (zástupce + dítě za 1 090 Kč) se jím zaplatit nedá.
  if l.druh = 'deti' then
    return json_build_object('ok', false, 'error', 'deti_lekce');
  end if;

  select coalesce(sum(spots), 0) into booked
    from public.bookings
    where lesson_id = p_lesson_id
      and public.booking_holds_seat(status, payment_status, hold_expires_at);
  remaining := l.capacity - booked;
  if remaining < 1 then
    return json_build_object('ok', false, 'error', 'full', 'remaining', 0);
  end if;

  update public.vouchers
     set redeemed = true, redeemed_at = now()
   where code = c
     and redeemed = false
     and (expires_at is null or expires_at > now())
  returning * into v;

  if not found then
    insert into public.voucher_attempts (email, code, ok) values (v_email, c, false);
    select * into v from public.vouchers where code = c;
    if not found then
      return json_build_object('ok', false, 'error', 'unknown');
    end if;
    if v.redeemed then
      return json_build_object('ok', false, 'error', 'already_redeemed', 'redeemed_at', v.redeemed_at);
    end if;
    return json_build_object('ok', false, 'error', 'expired', 'expires_at', v.expires_at);
  end if;

  insert into public.bookings
    (lesson_id, name, email, phone, spots, status,
     payment_status, payment_method, payment_amount, payment_ref, paid_at, hold_expires_at)
  values
    (p_lesson_id, v_name, v_email, v_phone, 1, 'confirmed',
     'paid', 'voucher', v.amount, 'voucher:' || v.code, now(), null)
  returning id into new_id;

  update public.vouchers set booking_id = new_id where id = v.id;
  insert into public.voucher_attempts (email, code, ok) values (v_email, c, true);

  kdy := initcap(dny[extract(dow from l.starts_at at time zone 'Europe/Prague')::int + 1])
    || ' ' || to_char(l.starts_at at time zone 'Europe/Prague', 'DD. MM. YYYY')
    || ' · ' || to_char(l.starts_at at time zone 'Europe/Prague', 'HH24:MI')
    || '–'  || to_char((l.starts_at + make_interval(mins => l.duration_min))
                       at time zone 'Europe/Prague', 'HH24:MI');
  vstupenka := 'https://www.jogaskralicky.cz/vstupenka.html#' || new_id::text;

  insert into public.email_outbox (order_key, kind, to_email, template_id, params)
  values (
    'booking:' || new_id::text,
    'booking',
    v_email,
    'template_iblqvg1',
    jsonb_build_object(
      'email',      v_email,
      'to_email',   v_email,
      'name',       v_name,
      'lesson',     l.title,
      'datetime',   kdy,
      'spots',      '1 místo',
      'price',      case when v.amount is not null
                         then to_char(round(v.amount / 100.0), 'FM999G999') || ' Kč' else '' end,
      'location',   misto,
      'ticket_url', vstupenka,
      'qr_url',     'https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=8&data='
                    || replace(replace(replace(vstupenka, ':', '%3A'), '/', '%2F'), '#', '%23')
    )
  )
  on conflict (order_key) do nothing;

  return json_build_object(
    'ok', true,
    'booking_id', new_id,
    'code', v.code,
    'remaining', remaining - 1,
    'kdy', kdy
  );
end;
$$;

grant execute on function public.create_booking_poukazem(uuid, text, text, text, text) to anon, authenticated;

-- 5) POUKAZ Z REZERVACE — ne u dětské lekce ----------------------------
--    Totožné s produkční verzí z rezervace-na-poukaz.sql, přibyla jen
--    kontrola druhu. Z dětské rezervace (zástupce + děti za jednu cenu)
--    se nedá poctivě rozpočítat „jedno místo“; takovou věc majitelka
--    vyřeší ručně (zrušit a vrátit peníze přes Stripe).
create or replace function public.vystavit_poukaz_z_rezervace(p_booking_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  b        public.bookings%rowtype;
  i        int;
  kod      text;
  na_misto int;
  kody     text[] := '{}';
  vstupenka_expires timestamptz := now() + public.voucher_validity();
begin
  if not public.is_owner() then
    return json_build_object('ok', false, 'error', 'forbidden');
  end if;

  select * into b from public.bookings where id = p_booking_id for update;
  if not found then
    return json_build_object('ok', false, 'error', 'booking_not_found');
  end if;
  if exists (select 1 from public.lessons where id = b.lesson_id and druh = 'deti') then
    return json_build_object('ok', false, 'error', 'deti_lekce');
  end if;
  if b.status = 'cancelled' then
    return json_build_object('ok', false, 'error', 'booking_cancelled');
  end if;
  if b.payment_status <> 'paid' then
    return json_build_object('ok', false, 'error', 'not_paid');
  end if;
  if exists (select 1 from public.vouchers where puvodni_booking_id = p_booking_id) then
    return json_build_object('ok', false, 'error', 'already_issued');
  end if;
  if coalesce(b.email, '') = '' or b.email like '%@studio' then
    return json_build_object('ok', false, 'error', 'no_email');
  end if;

  na_misto := round(coalesce(b.payment_amount, 0) / greatest(b.spots, 1)::numeric);

  for i in 1..b.spots loop
    loop
      kod := 'DK-' || upper(substr(md5(gen_random_uuid()::text), 1, 8));
      exit when not exists (select 1 from public.vouchers where code = kod);
    end loop;
    insert into public.vouchers (code, email, amount, session_id, expires_at, puvodni_booking_id)
    values (kod, b.email, na_misto, 'booking:' || b.id::text, vstupenka_expires, p_booking_id);
    kody := kody || kod;
  end loop;

  update public.bookings set status = 'cancelled' where id = p_booking_id;

  insert into public.email_outbox (order_key, kind, to_email, template_id, params)
  select
    'voucher:' || v.code,
    'voucher',
    v.email,
    'n/a',
    jsonb_build_object(
      'email', v.email, 'to_email', v.email, 'code', v.code,
      'amount', to_char(round(v.amount / 100.0), 'FM999G999') || ' Kč',
      'expires', to_char(v.expires_at at time zone 'Europe/Prague', 'DD. MM. YYYY')
    )
  from public.vouchers v
  where v.puvodni_booking_id = p_booking_id
  on conflict (order_key) do nothing;

  return json_build_object('ok', true, 'codes', to_json(kody), 'count', array_length(kody, 1));
end;
$$;
