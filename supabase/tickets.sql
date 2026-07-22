-- =====================================================================
--  Jóga s králíčky — vstupenka s QR kódem
--  Spusť: Supabase → SQL Editor → New query → Run. Bezpečné víckrát.
--
--  QR kód na vstupence obsahuje odkaz  .../vstupenka.html#<id rezervace>.
--  Tahle funkce k tomu ID vrátí jen to, co patří na vstupenku — žádný
--  e-mail ani telefon. Samotné ID je náhodné UUID, takže funguje jako klíč:
--  kdo ho nemá, nic nepřečte.
--
--  Předpoklad: už máš spuštěné schema.sql a payments.sql.
-- =====================================================================

create or replace function public.get_ticket(p_id uuid)
returns json
language sql
security definer
stable
set search_path = public
as $$
  select json_build_object(
    'name',           b.name,
    'spots',          b.spots,
    'status',         b.status,
    'payment_status', b.payment_status,
    'payment_method', b.payment_method,
    'paid_at',        b.paid_at,
    'lesson',         l.title,
    'starts_at',      l.starts_at,
    'duration_min',   l.duration_min,
    'lesson_status',  l.status
  )
  from public.bookings b
  join public.lessons  l on l.id = b.lesson_id
  where b.id = p_id;
$$;

grant execute on function public.get_ticket(uuid) to anon, authenticated;

-- Hotovo. Neplatné ID vrátí prázdno → stránka ukáže „vstupenka nenalezena".
</content>
</invoke>
