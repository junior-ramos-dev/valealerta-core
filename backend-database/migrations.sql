-- Vale Alerta — PostGIS / Supabase
-- Run in the SQL editor of a new project (PostGIS + auth.users).
-- First admin: update public.profiles set role = 'admin' where id = '<auth uid>';

create extension if not exists postgis;
create extension if not exists pgcrypto;

do $$ begin
  create type public.app_role as enum ('reporter', 'validator', 'admin');
exception
  when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Authenticated user profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  municipality text,
  role public.app_role not null default 'reporter',
  is_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists role public.app_role not null default 'reporter';
alter table public.profiles add column if not exists preferred_region_id text;
alter table public.profiles add column if not exists preferred_city_id text;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id,
    display_name,
    role,
    municipality,
    preferred_region_id,
    preferred_city_id
  )
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      split_part(new.email, '@', 1)
    ),
    'reporter',
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'municipality', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'preferred_region_id', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'preferred_city_id', '')), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.my_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()),
    'reporter'::public.app_role
  );
$$;

create or replace function public.set_profile_role(target uuid, new_role public.app_role)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.my_role() is distinct from 'admin'::public.app_role then
    raise exception 'only admin can change roles';
  end if;
  update public.profiles set role = new_role, updated_at = now() where id = target;
end;
$$;

grant execute on function public.my_role() to anon, authenticated;
grant execute on function public.set_profile_role(uuid, public.app_role) to authenticated;

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
-- DEM correction reports — GeoJSON in-table (no file upload)
-- ---------------------------------------------------------------------------
create table if not exists public.topo_patch_reports (
  id uuid primary key default gen_random_uuid(),
  region_id text not null,
  user_id uuid not null references public.profiles (id) on delete restrict,
  name text,
  delta_m double precision not null,
  geojson jsonb not null,
  form jsonb not null default '{}'::jsonb,
  validated_by uuid references public.profiles (id) on delete set null,
  validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint topo_patch_reports_delta_nonzero check (delta_m <> 0),
  constraint topo_patch_reports_geojson_polygon check (
    geojson ->> 'type' = 'Polygon'
  )
);

alter table public.topo_patch_reports add column if not exists geojson jsonb;
alter table public.topo_patch_reports add column if not exists updated_at timestamptz not null default now();

create index if not exists topo_patch_reports_region_idx
  on public.topo_patch_reports (region_id, created_at desc);

create index if not exists topo_patch_reports_user_idx
  on public.topo_patch_reports (user_id);

create index if not exists topo_patch_reports_geojson_gix
  on public.topo_patch_reports using gist (
    ST_SetSRID(ST_GeomFromGeoJSON(geojson::text), 4326)
  );

comment on table public.topo_patch_reports is
  'One Polygon GeoJSON + Δz per observer. The app reads rows as soon as they are saved; overlapping reports are averaged in the client.';

comment on column public.topo_patch_reports.geojson is
  'RFC 7946 Polygon geometry object (type + coordinates), not a FeatureCollection file.';

comment on column public.topo_patch_reports.form is
  'Copy of the in-app form at submit (name, delta_m, notes).';

create or replace function public.validate_topo_patch(report_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.my_role() not in ('validator'::public.app_role, 'admin'::public.app_role) then
    raise exception 'only validator or admin can validate in loco';
  end if;
  update public.topo_patch_reports
  set validated_by = auth.uid(),
      validated_at = now(),
      updated_at = now()
  where id = report_id;
end;
$$;

grant execute on function public.validate_topo_patch(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.hazard_pins enable row level security;
alter table public.topo_patch_reports enable row level security;

drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = public.my_role());

drop policy if exists "hazard_pins_select_public" on public.hazard_pins;
create policy "hazard_pins_select_public"
  on public.hazard_pins for select
  to anon, authenticated
  using (true);

drop policy if exists "hazard_pins_insert_own" on public.hazard_pins;
create policy "hazard_pins_insert_own"
  on public.hazard_pins for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "hazard_pins_update_own" on public.hazard_pins;
create policy "hazard_pins_update_own"
  on public.hazard_pins for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "hazard_pins_delete_own" on public.hazard_pins;
create policy "hazard_pins_delete_own"
  on public.hazard_pins for delete
  to authenticated
  using (user_id = auth.uid());

-- Anyone can read demarcations so the flood map updates as soon as a report is saved.
drop policy if exists "topo_patch_reports_select_public" on public.topo_patch_reports;
drop policy if exists "topo_patch_reports_select_authenticated" on public.topo_patch_reports;
create policy "topo_patch_reports_select_public"
  on public.topo_patch_reports for select
  to anon, authenticated
  using (true);

drop policy if exists "topo_patch_reports_insert_own" on public.topo_patch_reports;
create policy "topo_patch_reports_insert_own"
  on public.topo_patch_reports for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "topo_patch_reports_update_own" on public.topo_patch_reports;
create policy "topo_patch_reports_update_own"
  on public.topo_patch_reports for update
  to authenticated
  using (
    user_id = auth.uid()
    or public.my_role() in ('validator'::public.app_role, 'admin'::public.app_role)
  )
  with check (
    user_id = auth.uid()
    or public.my_role() in ('validator'::public.app_role, 'admin'::public.app_role)
  );

drop policy if exists "topo_patch_reports_delete_own" on public.topo_patch_reports;
create policy "topo_patch_reports_delete_own"
  on public.topo_patch_reports for delete
  to authenticated
  using (
    user_id = auth.uid()
    or public.my_role() = 'admin'::public.app_role
  );
