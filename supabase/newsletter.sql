-- =====================================================================
--  Jóga s králíčky — newsletter (odběr novinek e-mailem)
--  Spusť v Supabase → SQL Editor → New query → Run.
--  Bezpečné spustit víckrát (IF NOT EXISTS / OR REPLACE).
--
--  Návštěvník se přihlásí přes funkci subscribe_newsletter (nezapisuje
--  do tabulky přímo). Seznam vidí a spravuje jen majitelka v adminu.
-- =====================================================================

-- 1) Tabulka odběratelů -----------------------------------------------
create table if not exists public.newsletter_subscribers (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,
  source       text,                       -- odkud přišel (např. 'web-footer')
  unsubscribed boolean not null default false,
  created_at   timestamptz not null default now()
);

-- jeden e-mail jen jednou (case-insensitive)
create unique index if not exists newsletter_email_uidx
  on public.newsletter_subscribers (lower(email));

-- 2) Bezpečnost --------------------------------------------------------
alter table public.newsletter_subscribers enable row level security;

-- Seznam smí číst/spravovat jen majitelka.
drop policy if exists newsletter_owner_all on public.newsletter_subscribers;
create policy newsletter_owner_all on public.newsletter_subscribers
  for all using (public.is_owner()) with check (public.is_owner());

-- 3) Přihlášení k odběru (volá web) -----------------------------------
--    Funkce běží s právy vlastníka (security definer), takže zapíše i
--    bez přístupu k tabulce. Vrací jen { ok }. Duplicitní e-mail = ok.
create or replace function public.subscribe_newsletter(p_email text, p_source text default 'web')
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  e text := lower(btrim(coalesce(p_email, '')));
begin
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return json_build_object('ok', false, 'error', 'invalid_email');
  end if;

  insert into public.newsletter_subscribers (email, source)
    values (e, coalesce(nullif(btrim(p_source), ''), 'web'))
  on conflict (lower(email)) do update
    set unsubscribed = false;       -- opětovné přihlášení znovu aktivuje

  return json_build_object('ok', true);
end;
$$;

grant execute on function public.subscribe_newsletter(text, text) to anon, authenticated;

-- 4) Odhlášení odběru (volá web z odkazu v e-mailu) -------------------
create or replace function public.unsubscribe_newsletter(p_email text)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.newsletter_subscribers
    set unsubscribed = true
  where lower(email) = lower(btrim(coalesce(p_email, '')));
  return json_build_object('ok', true);
end;
$$;

grant execute on function public.unsubscribe_newsletter(text) to anon, authenticated;

-- Hotovo. E-maily nikdo cizí nepřečte — jen majitelka přes admin.
