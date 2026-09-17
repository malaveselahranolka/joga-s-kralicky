-- =====================================================================
--  Jóga s králíčky — přesun rezervace na jinou lekci
--  Spusť: Supabase → SQL Editor → New query → Run. Bezpečné víckrát.
--  Předpoklad: schema.sql, payments.sql, online-only.sql, email-outbox.sql.
--
--  PROČ TO EXISTUJE
--  „Můžu přijít jindy, onemocněla jsem?" je nejčastější dotaz, co do
--  schránky chodí. Správa na to neměla tlačítko — šlo jen zrušit a založit
--  znovu. Jenže zrušit a založit znovu ROZTRHNE VAZBU NA PLATBU: nová
--  rezervace je nezaplacená, peníze zůstanou viset u zrušené a účetní
--  doklad (viz provoz-a-brzdy.sql) přestane sedět na lekci, na kterou host
--  reálně přijde. Dělalo se to proto ručně v databázi, což je přesně ten
--  druh úkonu, po kterém nezůstane stopa a na který se zapomene e-mail.
--
--  Přesun proto mění JEN lesson_id. Řádek rezervace zůstává tentýž, takže
--  s ním zůstává platba, doklad i řádek v business ledgeru. Vstupenka se
--  přepíše sama — vstupenka.html si lekci joinuje až při načtení (viz
--  tickets.sql), takže hostovi jeho původní QR začne ukazovat nový termín
--  bez toho, aby se cokoliv převydávalo.
--
--  E-mail zařazuje do fronty databáze, ne prohlížeč — ze stejného důvodu
--  jako u zrus_lekci: zavřená záložka ve špatnou chvíli by jinak znamenala
--  přesunutou rezervaci, o které se host nedozví.
-- =====================================================================

create or replace function public.presun_rezervaci(
  p_booking_id uuid,
  p_lesson_id  uuid,
  p_email      boolean default true
)
returns json
language plpgsql
security definer
set search_path = public
as $fn$
declare
  b        public.bookings%rowtype;
  stara    public.lessons%rowtype;
  nova     public.lessons%rowtype;
  obsazeno int;
  volno    int;
  dny      constant text[] := array['neděle','pondělí','úterý','středa','čtvrtek','pátek','sobota'];
  misto    constant text   := 'Fit&Fun Studio Ostrava, Tovární 486/7, 709 00 Ostrava-Mariánské Hory';
  kdy_nove text;
  kdy_stare text;
  vstupenka text;
  qr       text;
  zarazeno int := 0;
begin
  if not public.is_owner() then
    return json_build_object('ok', false, 'error', 'forbidden');
  end if;

  -- Rezervaci i cílovou lekci zamykáme: mezi kontrolou kapacity a zápisem
  -- se jinak vejde souběžná rezervace z webu a lekce se přebukuje.
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then
    return json_build_object('ok', false, 'error', 'booking_not_found');
  end if;
  if b.status = 'cancelled' then
    return json_build_object('ok', false, 'error', 'booking_cancelled');
  end if;

  select * into nova from public.lessons where id = p_lesson_id for update;
  if not found then
    return json_build_object('ok', false, 'error', 'lesson_not_found');
  end if;
  if nova.status <> 'active' then
    return json_build_object('ok', false, 'error', 'lesson_cancelled');
  end if;
  if nova.starts_at <= now() then
    return json_build_object('ok', false, 'error', 'lesson_past');
  end if;
  if b.lesson_id = p_lesson_id then
    -- Není to chyba k opravení, ale dvojklik. Vrací se jako chyba proto,
    -- aby se neodeslal druhý e-mail o změně, která se nestala.
    return json_build_object('ok', false, 'error', 'same_lesson');
  end if;

  select * into stara from public.lessons where id = b.lesson_id;

  -- Stejné pravidlo, jakým počítá volná místa web (public_lessons)
  -- i create_booking — jinak by správa pustila přesun na lekci, kterou
  -- veřejná stránka hlásí jako obsazenou.
  select coalesce(sum(spots), 0) into obsazeno
    from public.bookings
   where lesson_id = p_lesson_id
     and public.booking_holds_seat(status, payment_status, hold_expires_at);

  volno := nova.capacity - obsazeno;
  if volno < b.spots then
    return json_build_object('ok', false, 'error', 'full',
                             'volno', greatest(volno, 0), 'potreba', b.spots);
  end if;

  update public.bookings set lesson_id = p_lesson_id where id = p_booking_id;

  -- Formát musí sedět znak na znak s ostatními e-maily (_shared/email.ts),
  -- ať hostovi nechodí termín pokaždé jinak zapsaný:
  -- „Neděle 04. 10. 2026 · 18:00–19:00".
  kdy_nove := initcap(dny[extract(dow from nova.starts_at at time zone 'Europe/Prague')::int + 1])
    || ' ' || to_char(nova.starts_at at time zone 'Europe/Prague', 'DD. MM. YYYY')
    || ' · ' || to_char(nova.starts_at at time zone 'Europe/Prague', 'HH24:MI')
    || '–'  || to_char((nova.starts_at + make_interval(mins => nova.duration_min))
                       at time zone 'Europe/Prague', 'HH24:MI');

  kdy_stare := case when stara.id is null then '' else
    initcap(dny[extract(dow from stara.starts_at at time zone 'Europe/Prague')::int + 1])
    || ' ' || to_char(stara.starts_at at time zone 'Europe/Prague', 'DD. MM. YYYY')
    || ' · ' || to_char(stara.starts_at at time zone 'Europe/Prague', 'HH24:MI')
    || '–'  || to_char((stara.starts_at + make_interval(mins => stara.duration_min))
                       at time zone 'Europe/Prague', 'HH24:MI') end;

  if p_email and coalesce(b.email, '') <> '' and b.email not like '%@studio' then
    vstupenka := 'https://www.jogaskralicky.cz/vstupenka.html#' || b.id::text;
    -- Ruční encodeURIComponent: v odkazu jsou mimo alfanumerické znaky
    -- jen ':', '/' a '#', zbytek (tečka, pomlčka) se nekóduje. Musí vyjít
    -- stejně jako qrFor() v _shared/email.ts, jinak by QR vedl jinam.
    qr := 'https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=8&data='
       || replace(replace(replace(vstupenka, ':', '%3A'), '/', '%2F'), '#', '%23');

    -- order_key nese čas přesunu: opakovaný přesun téže rezervace (host si
    -- to rozmyslí podruhé) je nová událost a zaslouží nový e-mail. Dvojklik
    -- odchytí kontrola same_lesson výš, sem se nedostane.
    insert into public.email_outbox (order_key, kind, to_email, template_id, params)
    values (
      'presun:' || b.id::text || ':' || extract(epoch from now())::bigint::text,
      'presun',
      b.email,
      'n/a',
      jsonb_build_object(
        'email',        b.email,
        'to_email',     b.email,
        'name',         b.name,
        'lesson',       nova.title,
        'datetime',     kdy_nove,
        'old_lesson',   coalesce(stara.title, ''),
        'old_datetime', kdy_stare,
        'spots',        b.spots || case when b.spots = 1 then ' místo'
                                        when b.spots < 5 then ' místa'
                                        else ' míst' end,
        'price',        case when b.payment_status = 'paid' and b.payment_amount is not null
                             then to_char(round(b.payment_amount / 100.0), 'FM999G999') || ' Kč'
                             else '' end,
        'location',     misto,
        'ticket_url',   vstupenka,
        'qr_url',       qr
      )
    )
    on conflict (order_key) do nothing;
    if found then zarazeno := 1; end if;
  end if;

  return json_build_object(
    'ok', true,
    'email', zarazeno,
    'kdy', kdy_nove,
    'puvodni', kdy_stare,
    'volno', volno - b.spots
  );
end;
$fn$;

revoke execute on function public.presun_rezervaci(uuid, uuid, boolean) from public, anon;
grant  execute on function public.presun_rezervaci(uuid, uuid, boolean) to authenticated, service_role;

-- Hotovo. Rezervace se přesouvá i s platbou, dokladem a vstupenkou.
