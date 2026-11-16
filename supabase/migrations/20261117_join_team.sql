-- crm_people: the CRM's Employees section (team members and affiliates), fed by the website's
-- "Join the team" and "Become an affiliate" forms (edge function `application`, service role).
-- Applied as migration crm_people (2026-11-16). Staff-only like every crm_* table.
create table if not exists public.crm_people (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'team' check (kind in ('team','affiliate')),
  status text not null default 'applied' check (status in ('applied','active','declined','inactive')),
  first_name text, last_name text, business_name text, role text,
  email text, phone text, instagram text, website text, areas text,
  experience text, availability text, notes text,
  photo_url text, show_on_site boolean not null default false,
  source text not null default 'website',
  application jsonb not null default '{}'::jsonb,   -- the website answers, as sent
  extra jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.crm_people is 'CRM Employees: team members and affiliates, incl. website applications (status applied). Staff only.';
alter table public.crm_people enable row level security;
drop policy if exists "staff full access" on public.crm_people;
create policy "staff full access" on public.crm_people for all using (public.is_crm_staff()) with check (public.is_crm_staff());
create index if not exists crm_people_kind_status on public.crm_people (kind, status);

-- The website's About "Team" tiles: only active team members Chanel ticks "Show on website" for,
-- and only their first name, role, Instagram and photo. Nothing else is ever public.
create or replace function public.site_team()
returns table (name text, role text, instagram text, photo_url text)
language sql stable security definer set search_path = public as $$
  select first_name, role, instagram, photo_url from public.crm_people
  where kind = 'team' and status = 'active' and show_on_site
  order by created_at
$$;
revoke all on function public.site_team() from public;
grant execute on function public.site_team() to anon, authenticated;

