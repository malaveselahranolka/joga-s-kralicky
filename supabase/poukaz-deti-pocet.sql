-- =====================================================================
--  Jóga s králíčky — dětský dárkový poukaz s výběrem počtu dětí
--  Spusť: Supabase → SQL Editor → New query → Run. Bezpečné víckrát.
--  Předpoklad: poukaz-deti.sql (vouchers.druh) a všechno před ním.
--
--  POČET DĚTÍ (vouchers.deti)
--  Dětský poukaz platí na zákonného zástupce s 1 až 4 dětmi, stejně
--  jako rezervace na lekci Děti & králíčci:
--    1 090 Kč zástupce + 1 dítě, každé další dítě 500 Kč.
--  Cenu počítá stripe-voucher, počet dětí jde do metadat platby a odtud
--  ho stripe-webhook / stripe-confirm zapíšou sem. Klasický poukaz má
--  vždy 1, starší dětské poukazy dostanou výchozí 1.
--
--  UPLATNĚNÍ (create_booking_poukazem)
--  Dětský poukaz založí rezervaci na 1 + deti míst (místa = lidé),
--  a proto jich potřebuje tolik volných. Jinak beze změny proti
--  poukaz-deti.sql.
-- =====================================================================

-- 1) POČET DĚTÍ NA POUKAZU ---------------------------------------------
alter table public.vouchers add column if not exists deti smallint not null default 1;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vouchers_deti_check') then
    alter table public.vouchers add constraint vouchers_deti_check
      check (deti between 1 and 4 and (druh = 'deti' or deti = 1));
  end if;
end $$;

-- 2) UPLATNĚNÍ POUKAZU V REZERVACI ---------------------------------------
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
  mist      int;
  v_druh    text;
  v_deti    int;
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

  -- Druh poukazu musí sedět s druhem lekce. Kontrola je před spotřebováním
  -- poukazu, takže se omylem zadaný kód neztratí.
  select druh, deti into v_druh, v_deti from public.vouchers where code = c;
  if found and v_druh is distinct from l.druh then
    insert into public.voucher_attempts (email, code, ok) values (v_email, c, false);
    return json_build_object('ok', false, 'error',
      case when l.druh = 'deti' then 'deti_lekce' else 'klasik_lekce' end);
  end if;

  -- klasický poukaz = 1 místo, dětský = zástupce + jeho děti (2 až 5 míst)
  mist := case when l.druh = 'deti' then 1 + least(4, greatest(1, coalesce(v_deti, 1))) else 1 end;

  select coalesce(sum(spots), 0) into booked
    from public.bookings
    where lesson_id = p_lesson_id
      and public.booking_holds_seat(status, payment_status, hold_expires_at);
  remaining := l.capacity - booked;
  if remaining < mist then
    return json_build_object('ok', false, 'error', 'full', 'remaining', greatest(remaining, 0));
  end if;

  update public.vouchers
     set redeemed = true, redeemed_at = now()
   where code = c
     and druh = l.druh
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
    (p_lesson_id, v_name, v_email, v_phone, mist, 'confirmed',
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
      'spots',      case when l.druh = 'deti'
                         then 'zástupce + ' || (mist - 1)::text || case when mist = 2 then ' dítě' else ' děti' end
                         else '1 místo' end,
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
    'spots', mist,
    'remaining', remaining - mist,
    'kdy', kdy
  );
end;
$$;

grant execute on function public.create_booking_poukazem(uuid, text, text, text, text) to anon, authenticated;
