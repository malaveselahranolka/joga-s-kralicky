-- =====================================================================
--  Jóga s králíčky — rezervace zaplacená dárkovým poukazem
--  Spusť: Supabase → SQL Editor → New query → Run. Bezpečné víckrát.
--  Předpoklad: schema.sql, payments.sql, online-only.sql, vouchers.sql,
--              vouchers-lifecycle.sql, email-outbox.sql, provoz-a-brzdy.sql.
--
--  PROČ TO EXISTUJE
--  Poukaz se dosud uplatňoval JEN u dveří: host přišel do studia a ukázal
--  kód (redeem_voucher, volatelná pouze majitelkou). Jenže rezervaci si
--  tím udělat nemohl — a lekce bývají plné. Držitel poukazu tak neměl jak
--  se na lekci dostat: online rezervace po něm chtěla zaplatit znovu
--  a bez rezervace u dveří nebylo volné místo.
--
--  Tenhle soubor přidává druhou cestu: poukaz jde uplatnit rovnou při
--  online rezervaci. Místo platební brány se ověří kód a rezervace
--  vznikne rovnou zaplacená.
--
--  CO SE ZÁMĚRNĚ NEMĚNÍ
--  Do platební cesty se tu nesahá. create_booking, stripe-create,
--  stripe-confirm ani stripe-webhook nejsou tímhle souborem dotčené —
--  přibývá vedle nich samostatná funkce. Když se tohle celé smaže,
--  placení funguje dál přesně jako dřív.
--
--  Peníze za poukaz přišly už při jeho nákupu (Stripe). Uplatnění tedy
--  NENÍ nový příjem a schválně nezakládá řádek v business ledgeru —
--  jinak by se stejná koruna počítala dvakrát.
-- =====================================================================

-- ---------------------------------------------------------------------
--  1) MÍSTO PRO ZÁZNAM, ČÍM SE PLATILO
--
--  payment_method dosud znal jen 'online' a 'cash'. Poukaz není ani
--  jedno: online se za něj neplatí (peníze přišly dřív) a v hotovosti
--  u dveří taky ne. Bez vlastní hodnoty by se ve správě tvářil jako
--  „zaplaceno online" a v přehledu by nešlo poznat, co bylo za poukaz.
--
--  Rozšíření CHECKu je bezpečné: podmínka se jen zmírňuje, takže žádný
--  existující řádek nemůže přestat vyhovovat.
-- ---------------------------------------------------------------------
alter table public.bookings drop constraint if exists bookings_payment_method_check;
alter table public.bookings add constraint bookings_payment_method_check
  check (payment_method in ('online', 'cash', 'voucher'));

-- Kterou rezervaci poukaz zaplatil. Doklad k tomu, že se neuplatnil
-- dvakrát, a zároveň cesta zpět, kdyby se rezervace řešila reklamací.
alter table public.vouchers add column if not exists booking_id uuid
  references public.bookings(id) on delete set null;

comment on column public.vouchers.booking_id is
  'Rezervace, kterou poukaz zaplatil (uplatnění online). Prázdné u poukazů uplatněných u dveří.';

-- ---------------------------------------------------------------------
--  2) POKUSY O UPLATNĚNÍ
--
--  Ověřování kódu je nově volatelné anonymně, takže se dá zkoušet
--  ve smyčce. Uhodnout kód je prakticky nemožné (DK- + 8 znaků z 36,
--  tedy ~2,8·10¹²), ale nechat hádání běžet bez jakékoli brzdy by byla
--  zbytečná velkorysost. Zapisujeme proto každý pokus a podle nich
--  brzdíme — stejná úvaha jako u rezervace_prilis_casto.
--
--  Úspěšné pokusy se zapisují taky: je z nich vidět, kdy a čím se
--  poukaz uplatnil, i když ho majitelka později vrátí do oběhu.
-- ---------------------------------------------------------------------
create table if not exists public.voucher_attempts (
  id         uuid primary key default gen_random_uuid(),
  email      text,
  code       text,
  ok         boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists voucher_attempts_cas_idx
  on public.voucher_attempts (created_at desc);

alter table public.voucher_attempts enable row level security;
-- Zapisuje jen funkce níž (security definer, mimo RLS). Čte majitelka.
drop policy if exists voucher_attempts_owner_read on public.voucher_attempts;
create policy voucher_attempts_owner_read on public.voucher_attempts
  for select using (public.is_owner());

create or replace function public.poukaz_prilis_casto(p_email text)
returns boolean
language sql
security definer
stable
set search_path = public
as $rl$
  select
    -- Jeden e-mail: pět chybných kódů za čtvrt hodiny je překlep, ne zákazník.
    (select count(*) from public.voucher_attempts
      where ok = false
        and lower(coalesce(email, '')) = lower(coalesce(p_email, ''))
        and created_at > now() - interval '15 minutes') >= 5
    or
    -- Celkově: brzda i na hádání s měněným e-mailem.
    (select count(*) from public.voucher_attempts
      where ok = false
        and created_at > now() - interval '10 minutes') >= 30
$rl$;

revoke execute on function public.poukaz_prilis_casto(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
--  3) REZERVACE NA POUKAZ
--
--  Jeden poukaz = jedno místo (hodnota poukazu je cena jednoho vstupu,
--  499 Kč). Proto tahle funkce nebere počet míst — kdo chce přijít ve
--  dvou, uplatní poukaz na sebe a druhé místo doplatí běžnou rezervací.
--
--  Celé to běží v jedné transakci: když spadne zápis rezervace, poukaz
--  zůstane neuplatněný, a naopak. Nemůže tedy nastat, že se poukaz
--  „spotřebuje" a rezervace nevznikne.
-- ---------------------------------------------------------------------
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
as $fn$
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
  -- Stejná validace jako create_booking — ať se přes veřejné RPC
  -- nedá zakládat balast.
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
    -- Nesmyslný tvar kódu se ani nepočítá jako pokus: jinak by šlo
    -- počítadlo vytočit odpadem a zavřít bránu skutečným zákazníkům.
    return json_build_object('ok', false, 'error', 'unknown');
  end if;

  if public.poukaz_prilis_casto(v_email) then
    return json_build_object('ok', false, 'error', 'too_many_requests');
  end if;

  select * into l from public.lessons where id = p_lesson_id for update;
  if not found or l.status <> 'active' or l.starts_at <= now() then
    return json_build_object('ok', false, 'error', 'unavailable');
  end if;

  -- Volná místa stejným pravidlem jako veřejný web i create_booking.
  select coalesce(sum(spots), 0) into booked
    from public.bookings
    where lesson_id = p_lesson_id
      and public.booking_holds_seat(status, payment_status, hold_expires_at);
  remaining := l.capacity - booked;
  if remaining < 1 then
    return json_build_object('ok', false, 'error', 'full', 'remaining', 0);
  end if;

  -- Uplatnění poukazu jedním atomickým UPDATE. Dvě rezervace na tentýž
  -- kód v jednu chvíli tak nemůžou projít obě — druhá nenajde řádek.
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

  -- Rezervace rovnou zaplacená: držení místa nedává smysl, platit se
  -- už nebude. payment_ref nese kód, ať je u rezervace vidět čím.
  insert into public.bookings
    (lesson_id, name, email, phone, spots, status,
     payment_status, payment_method, payment_amount, payment_ref, paid_at, hold_expires_at)
  values
    (p_lesson_id, v_name, v_email, v_phone, 1, 'confirmed',
     'paid', 'voucher', v.amount, 'voucher:' || v.code, now(), null)
  returning id into new_id;

  update public.vouchers set booking_id = new_id where id = v.id;
  insert into public.voucher_attempts (email, code, ok) values (v_email, c, true);

  -- Potvrzení je ZÁMĚRNĚ obyčejný 'booking' e-mail, tentýž, jaký chodí po
  -- platbě kartou — host nemá důvod dostat jinak vypadající zprávu jen
  -- proto, že platil poukazem. Formát termínu i order_key proto musí
  -- sedět s bookingEmail() v supabase/functions/_shared/email.ts.
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
$fn$;

grant execute on function public.create_booking_poukazem(uuid, text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
--  4) VRÁCENÍ POUKAZU DO OBĚHU
--
--  unredeem_voucher (vouchers-lifecycle.sql) umí zrušit odškrtnutí, ale
--  o rezervaci nic neví. Když majitelka zruší rezervaci placenou
--  poukazem, má se poukaz vrátit hostovi — jinak přijde o peníze.
--  Tohle je jen doplnění vazby; samotné vrácení dělá pořád ta funkce.
-- ---------------------------------------------------------------------
create or replace function public.vrat_poukaz_z_rezervace(p_booking_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $fn$
declare v public.vouchers%rowtype;
begin
  if not public.is_owner() then
    return json_build_object('ok', false, 'error', 'forbidden');
  end if;

  update public.vouchers
     set redeemed = false, redeemed_at = null, booking_id = null
   where booking_id = p_booking_id and redeemed = true
  returning * into v;

  if not found then
    return json_build_object('ok', false, 'error', 'not_found');
  end if;
  return json_build_object('ok', true, 'code', v.code);
end;
$fn$;

revoke execute on function public.vrat_poukaz_z_rezervace(uuid) from public, anon;
grant  execute on function public.vrat_poukaz_z_rezervace(uuid) to authenticated, service_role;

-- Hotovo. Poukaz jde uplatnit online a platební cesta zůstala nedotčená.
