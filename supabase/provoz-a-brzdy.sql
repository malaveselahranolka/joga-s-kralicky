-- =====================================================================
--  Jóga s králíčky — provozní pojistky
--  Spusť: Supabase → SQL Editor → New query → Run. Bezpečné víckrát.
--  Předpoklad: schema.sql, payments.sql, online-only.sql, email-outbox.sql.
--
--  Tenhle soubor přidává tři věci, které se ukázaly jako potřebné až při
--  auditu před ostrým provozem. Všechny už v produkci běží; soubor
--  existuje proto, aby šla databáze postavit znovu jen z gitu.
-- =====================================================================

-- ---------------------------------------------------------------------
--  1) ZAPLACENOU REZERVACI NEJDE SMAZAT
--
--  Stalo se to 24. 8. 2026: dvě rezervace se zpracovanou platbou
--  (stripe_events status 'processed') v tabulce nejsou. Zůstaly po nich
--  jen osiřelé řádky ve frontě e-mailů. Peníze ve Stripu přitom zůstávají
--  a s rezervací zmizel i doklad, který se podle zákona o účetnictví
--  schovává 10 let.
--
--  Tlačítko v adminu se ptalo jen „Trvale smazat tuto rezervaci?" a stav
--  platby neřešilo. Kontrola v prohlížeči je nutná, ale nestačí — obejde
--  ji každý, kdo sáhne do dat jinudy.
--
--  Zrušit rezervaci jde pořád (status = 'cancelled'); tohle brání jen
--  fyzickému smazání řádku.
-- ---------------------------------------------------------------------
create or replace function public.zakaz_smazani_zaplacene()
returns trigger
language plpgsql
as $trig$
begin
  if old.payment_status = 'paid' then
    raise exception
      'Rezervaci % nelze smazat: je zaplacena (% Kc, %). Zrus ji misto toho '
      '(status = cancelled), aby zustal doklad o platbe.',
      old.id,
      coalesce(round(old.payment_amount / 100.0), 0),
      coalesce(old.paid_at::date::text, 'datum neznamo')
      using errcode = 'restrict_violation';
  end if;
  return old;
end;
$trig$;

drop trigger if exists bookings_zakaz_smazani_zaplacene on public.bookings;
create trigger bookings_zakaz_smazani_zaplacene
  before delete on public.bookings
  for each row execute function public.zakaz_smazani_zaplacene();

-- Mazání lekce nesmí zaplacené rezervace strhnout s sebou. Cizí klíč měl
-- ON DELETE CASCADE, takže s lekcí mizely i zaplacené rezervace.
alter table public.bookings drop constraint if exists bookings_lesson_id_fkey;
alter table public.bookings
  add constraint bookings_lesson_id_fkey
  foreign key (lesson_id) references public.lessons(id) on delete restrict;

-- ---------------------------------------------------------------------
--  2) ZRUŠENÍ LEKCE DÁ VĚDĚT HOSTŮM
--
--  Dřív admin jen vypsal „nezapomeňte hosty informovat" a dál nic. Kdo
--  zaplatil, mohl přijet do studia na lekci, co se nekoná.
--
--  Zařazení do fronty dělá databáze, ne prohlížeč — jinak by stačilo
--  zavřít záložku ve špatnou chvíli a e-maily by nevznikly. Odesílání
--  obstará email-dispatch (pg_cron každých 5 minut).
--
--  Šablona 'cancel' žije v supabase/functions/_shared/templates.ts.
-- ---------------------------------------------------------------------
create or replace function public.zrus_lekci(p_lesson_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $fn$
declare
  l          public.lessons%rowtype;
  r          record;
  zarazeno   int := 0;
  preskoceno int := 0;
  dny        constant text[] := array['neděle','pondělí','úterý','středa','čtvrtek','pátek','sobota'];
  kdy        text;
begin
  if not public.is_owner() then
    return json_build_object('ok', false, 'error', 'forbidden');
  end if;

  select * into l from public.lessons where id = p_lesson_id for update;
  if not found then
    return json_build_object('ok', false, 'error', 'lesson_not_found');
  end if;

  update public.lessons set status = 'cancelled' where id = p_lesson_id;

  -- Musí vyjít stejně jako v ostatních e-mailech (_shared/email.ts):
  -- pražské pásmo, „Sobota 05. 09. 2026 · 10:30".
  kdy := initcap(dny[extract(dow from l.starts_at at time zone 'Europe/Prague')::int + 1])
         || ' ' || to_char(l.starts_at at time zone 'Europe/Prague', 'DD. MM. YYYY')
         || ' · ' || to_char(l.starts_at at time zone 'Europe/Prague', 'HH24:MI');

  for r in
    select b.id, b.name, b.email, b.spots, b.payment_status, b.payment_amount
      from public.bookings b
     where b.lesson_id = p_lesson_id
       and b.status <> 'cancelled'
  loop
    -- order_key drží unikát, takže opakované zrušení téže lekce
    -- nepošle hostům druhý e-mail.
    insert into public.email_outbox (order_key, kind, to_email, template_id, params)
    values (
      'cancel:' || r.id::text,
      'cancel',
      r.email,
      'n/a',
      jsonb_build_object(
        'name',      r.name,
        'lesson',    l.title,
        'datetime',  kdy,
        'spots',     r.spots || case when r.spots = 1 then ' místo' when r.spots < 5 then ' místa' else ' míst' end,
        'price',     case when r.payment_amount is not null
                          then to_char(round(r.payment_amount / 100.0), 'FM999G999') || ' Kč' else '' end,
        'zaplaceno', case when r.payment_status = 'paid' then '1' else '' end
      )
    )
    on conflict (order_key) do nothing;

    if found then zarazeno := zarazeno + 1; else preskoceno := preskoceno + 1; end if;
  end loop;

  return json_build_object('ok', true, 'zarazeno', zarazeno, 'preskoceno', preskoceno, 'kdy', kdy);
end;
$fn$;

revoke execute on function public.zrus_lekci(uuid) from public, anon;
grant  execute on function public.zrus_lekci(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
--  3) BRZDA PROTI ZAHLCENÍ REZERVACEMI
--
--  create_booking je volatelná anonymně přes /rest/v1/rpc/create_booking.
--  Validace vstupů drží, ale nic nebránilo zavolat ji ve smyčce: deset
--  rezervací = celá lekce na 35 minut zablokovaná, a pak znovu.
--
--  IP adresu v Postgresu nemáme (chodí přes PostgREST), takže brzdíme
--  podle e-mailu a podle lekce. Obojí jde obejít změnou e-mailu — cílem
--  není zastavit odhodlaného útočníka, ale to, aby omylem desetkrát
--  odeslané tlačítko nebo triviální skript neuzavřely lekci.
--
--  Meze jsou schválně volné, ať nepřekážejí rodině, která rezervuje
--  dvakrát po sobě. Ověřeno proti produkci: pět rezervací projde,
--  šestá vrátí too_many_requests, jiný e-mail projde dál.
-- ---------------------------------------------------------------------
create or replace function public.rezervace_prilis_casto(p_email text, p_lesson_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $rl$
  select
    (select count(*) from public.bookings
      where lower(email) = lower(p_email)
        and payment_status <> 'paid'
        and created_at > now() - interval '30 minutes') >= 5
    or
    (select count(*) from public.bookings
      where lesson_id = p_lesson_id
        and payment_status <> 'paid'
        and created_at > now() - interval '10 minutes') >= 25
$rl$;

revoke execute on function public.rezervace_prilis_casto(text, uuid) from public, anon, authenticated;

-- Brzda se do create_booking zapojuje až ZA validací vstupů (ať se
-- počítadlo nedá vytočit nesmysly) a PŘED zápisem (ať se nic nezaloží).
-- Aktuální podobu create_booking drží supabase/online-only.sql.

-- Hotovo.
