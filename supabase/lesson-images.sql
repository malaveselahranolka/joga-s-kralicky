-- =====================================================================
--  Jóga s králíčky — OBRÁZEK U LEKCE
--  Spusť: Supabase → SQL Editor → New query → vlož celý soubor → Run.
--  Je bezpečné spustit ho víckrát.
--
--  Předpoklad: máš už spuštěné schema.sql, payments.sql, tickets.sql
--  a online-only.sql. Tenhle soubor spouštěj až po nich (přepisuje
--  pohled public_lessons a přidává do něj obrázek).
--
--  Co to udělá:
--   1) K lekci přidá políčko `image_url` (odkaz na obrázek).
--   2) Obrázek pustí i na veřejný web (pohled public_lessons).
--   3) Založí úložiště `lesson-images`, kam admin nahrává fotky.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) NOVÉ POLÍČKO U LEKCE
-- ---------------------------------------------------------------------
alter table public.lessons add column if not exists image_url text;

comment on column public.lessons.image_url is
  'Obrázek zobrazený u lekce v rezervacích. Odkaz na soubor v úložišti lesson-images, cesta v projektu (assets/photos/...) nebo vložený obrázek (data:). Prázdné = použije se výchozí fotka podle názvu lekce.';

-- ---------------------------------------------------------------------
-- 2) VEŘEJNÝ POHLED — stejný jako v online-only.sql, jen navíc s obrázkem
-- ---------------------------------------------------------------------
drop view if exists public.public_lessons;

create view public.public_lessons as
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
    )::int as remaining,
    l.image_url
  from public.lessons l
  left join public.bookings b on b.lesson_id = l.id
  where l.status = 'active' and l.starts_at > now()
  group by l.id;

grant select on public.public_lessons to anon, authenticated;

-- ---------------------------------------------------------------------
-- 3) ÚLOŽIŠTĚ NA FOTKY LEKCÍ
--    Veřejné ke čtení (obrázek musí jít zobrazit návštěvníkovi webu),
--    nahrávat a maza-t smí jen majitelka.
--
--    Kdyby tahle část skončila chybou o oprávnění, nevadí: založ kbelík
--    ručně v Supabase → Storage → New bucket → název `lesson-images`,
--    zaškrtni „Public bucket". Zbytek (policies) pak spusť znovu.
--    A i bez úložiště admin funguje — obrázek uloží rovnou do lekce.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('lesson-images', 'lesson-images', true)
on conflict (id) do update set public = true;

drop policy if exists lesson_images_read on storage.objects;
create policy lesson_images_read on storage.objects
  for select using (bucket_id = 'lesson-images');

drop policy if exists lesson_images_insert on storage.objects;
create policy lesson_images_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'lesson-images' and public.is_owner());

drop policy if exists lesson_images_update on storage.objects;
create policy lesson_images_update on storage.objects
  for update to authenticated
  using (bucket_id = 'lesson-images' and public.is_owner())
  with check (bucket_id = 'lesson-images' and public.is_owner());

drop policy if exists lesson_images_delete on storage.objects;
create policy lesson_images_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'lesson-images' and public.is_owner());
