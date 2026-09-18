-- =====================================================================
--  Jóga s králíčky — vystavení dárkového poukazu z hotové rezervace
--  Spusť: Supabase → SQL Editor → New query → Run. Bezpečné víckrát.
--  Předpoklad: schema.sql, payments.sql, online-only.sql, vouchers.sql,
--              vouchers-lifecycle.sql, email-outbox.sql.
--
--  PROČ TO EXISTUJE
--  Dotaz, co přišel do schránky: „Až po objednání jsem si všimnul, že
--  máte tlačítko s dárkovým poukazem — dokázali byste mi i na hotovou
--  rezervaci vystavit dárkový poukaz?" Host si tedy rozmyslel, že místo
--  aby na lekci šel sám, chce ji věnovat dál. Poukaz uměl vzniknout jen
--  novým nákupem přes Stripe — z existující (a už zaplacené) rezervace
--  cesta nebyla.
--
--  CO SE DĚJE
--  Rezervace se ZRUŠÍ (uvolní se místo, přesně jako tlačítkem „Zrušit"),
--  ale `payment_status` a `payment_amount` se nechávají beze změny —
--  účetní doklad tak zůstává na svém místě a nevzniká nový příjem.
--  Místo lekce dostane host stejnou hodnotou dárkový poukaz, na kolik
--  míst rezervace byla: 2 zaplacená místa = 2 poukazy po jednom místě,
--  ne jeden poukaz za dvojnásobek. Poukaz totiž platí vždy na JEDNO
--  místo (viz poukaz-rezervace.sql) — z jednoho poukazu za 998 Kč by
--  šlo pozdějí uplatnit jen jednu lekci a zbytek hodnoty by nikam
--  nevedl.
--
--  E-mail je záměrně STEJNÁ šablona `voucher`, jakou dostane kdokoli, kdo
--  poukaz koupí přes web — žádný rozdíl v obsahu ani v příloze (PDF
--  k vytištění se generuje úplně stejně).
-- =====================================================================

-- Rezervace, ze které poukaz vznikl. Odlišné od vouchers.booking_id, což
-- je naopak rezervace, kterou poukaz ZAPLATIL při uplatnění online — tohle
-- pole ukazuje směr přesně opačný.
--
-- ZÁMĚRNĚ NENÍ unikátní: rezervace na víc míst vytváří víc poukazů se
-- stejným puvodni_booking_id (jeden poukaz = jedno místo, viz níž). Proti
-- dvojímu vystavení chrání zámek na řádku rezervace (`for update`) plus
-- kontrola stavu — druhé volání na tutéž rezervaci narazí na už zrušený
-- stav dřív, než by se k vytváření poukazů vůbec dostalo.
alter table public.vouchers add column if not exists puvodni_booking_id uuid
  references public.bookings(id) on delete set null;

create index if not exists vouchers_puvodni_booking_idx
  on public.vouchers (puvodni_booking_id)
  where puvodni_booking_id is not null;

comment on column public.vouchers.puvodni_booking_id is
  'Rezervace, ze které byl poukaz vystaven dodatečně (host chtěl dát lekci darem místo toho, aby na ni šel). Prázdné u poukazů koupených běžně přes Stripe.';

create or replace function public.vystavit_poukaz_z_rezervace(p_booking_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $fn$
declare
  b        public.bookings%rowtype;
  i        int;
  kod      text;
  na_misto int;
  kody     text[] := '{}';
  -- Délka platnosti se tu neopisuje — jediný zdroj v databázi je
  -- public.voucher_validity() z supabase/vouchers-lifecycle.sql.
  vstupenka_expires timestamptz := now() + public.voucher_validity();
begin
  if not public.is_owner() then
    return json_build_object('ok', false, 'error', 'forbidden');
  end if;

  select * into b from public.bookings where id = p_booking_id for update;
  if not found then
    return json_build_object('ok', false, 'error', 'booking_not_found');
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
    -- Ruční rezervace z adminu nemá skutečnou adresu, kam poukaz poslat.
    return json_build_object('ok', false, 'error', 'no_email');
  end if;

  -- Hodnota za JEDNO místo — stejné dělení jako u vícekusového nákupu
  -- poukazů ve stripe-webhook/stripe-confirm (`each`).
  na_misto := round(coalesce(b.payment_amount, 0) / greatest(b.spots, 1)::numeric);

  for i in 1..b.spots loop
    -- Kód se generuje, dokud nenarazí na volný. Ověřuje se PŘEDEM přes
    -- exists, ne přes odchycení unique_violation na insertu — ten by
    -- totiž stejně chytil i jinou kolizi (např. na jiném indexu) a smyčka
    -- by se donekonečna točila na chybě, kterou nový kód nikdy nevyřeší.
    loop
      kod := 'DK-' || upper(substr(md5(gen_random_uuid()::text), 1, 8));
      exit when not exists (select 1 from public.vouchers where code = kod);
    end loop;
    insert into public.vouchers (code, email, amount, session_id, expires_at, puvodni_booking_id)
    values (kod, b.email, na_misto, 'booking:' || b.id::text, vstupenka_expires, p_booking_id);
    kody := kody || kod;
  end loop;

  -- Zrušení uvolní místo (booking_holds_seat vyžaduje status <> 'cancelled').
  -- payment_status a payment_amount se NEMĚNÍ — to je ten účetní doklad,
  -- co musí zůstat, aby řádek dál seděl na skutečně přijaté platbě.
  update public.bookings set status = 'cancelled' where id = p_booking_id;

  -- Jeden e-mail na KAŽDÝ poukaz — stejná šablona i příloha jako při
  -- běžném nákupu (voucherEmail v _shared/email.ts).
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
$fn$;

revoke execute on function public.vystavit_poukaz_z_rezervace(uuid) from public, anon;
grant  execute on function public.vystavit_poukaz_z_rezervace(uuid) to authenticated, service_role;

-- Hotovo. Zaplacená rezervace jde přeměnit na dárkový poukaz(y) stejné
-- hodnoty, beze změny účetnictví.
