-- Vale Alerta — initial PostGIS / Supabase schema
-- Run against a fresh Postgres instance with auth.users (Supabase) available.

create extension if not exists postgis;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Authenticated user profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  municipality text,
  is_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Crowdsourced landslide / washout photo pins
-- ---------------------------------------------------------------------------
create table if not exists public.hazard_pins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete restrict,
  hazard_type text not null
    check (hazard_type in ('landslide', 'washout', 'flood', 'blocked_road', 'other')),
  geom geometry(Point, 4326) not null,
  photo_url text not null,
  caption text,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint hazard_pins_geom_in_wgs84 check (st_srid(geom) = 4326)
);

create index if not exists hazard_pins_geom_gix
  on public.hazard_pins using gist (geom);

create index if not exists hazard_pins_user_idx
  on public.hazard_pins (user_id);

create index if not exists hazard_pins_type_observed_idx
  on public.hazard_pins (hazard_type, observed_at desc);

comment on table public.hazard_pins is
  'Citizen photo pins for landslides, washouts, and related valley hazards.';

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.hazard_pins enable row level security;

create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "hazard_pins_select_public"
  on public.hazard_pins for select
  to anon, authenticated
  using (true);

create policy "hazard_pins_insert_own"
  on public.hazard_pins for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "hazard_pins_update_own"
  on public.hazard_pins for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "hazard_pins_delete_own"
  on public.hazard_pins for delete
  to authenticated
  using (user_id = auth.uid());
