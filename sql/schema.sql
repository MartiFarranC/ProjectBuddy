-- ProjectBuddy · esquema de la base de dades (Supabase / Postgres)
-- Enganxa tot aquest fitxer al SQL Editor del teu projecte Supabase i executa'l un sol cop.
--
-- Sense login ni contrasenya: qualsevol dispositiu amb la clau "anon" (la que
-- va al js/config.js) pot llegir i escriure aquestes taules directament.
-- És la clau que fa que l'app funcioni sense cap fricció, però també vol dir
-- que la URL de la pàgina no té cap protecció pròpia: no la comparteixis ni
-- la publicitis si vols que les idees quedin només per a tu.

-- Taula principal: cada idea/projecte
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  content text not null default '',
  category text,
  location text,
  difficulty smallint check (difficulty between 1 and 5),
  necessity smallint check (necessity between 1 and 5),
  desire smallint check (desire between 1 and 5),
  needs_external boolean not null default false,
  external_detail text,
  questionnaire_done boolean not null default false,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Categories i ubicacions personalitzades que vas afegint
-- (les predeterminades viuen al client, aquestes són les que tu mateix crees)
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color_slot smallint not null default 1 check (color_slot between 1 and 8),
  created_at timestamptz not null default now()
);

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

-- updated_at automàtic
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_projects_updated_at on public.projects;
create trigger trg_projects_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- RLS activat amb una única política oberta per al rol "anon": explícita i
-- fàcil de revisar/enretirar més endavant si mai vols tornar a posar-hi login.
alter table public.projects enable row level security;
alter table public.categories enable row level security;
alter table public.locations enable row level security;

create policy "projects: open access" on public.projects
  for all to anon using (true) with check (true);

create policy "categories: open access" on public.categories
  for all to anon using (true) with check (true);

create policy "locations: open access" on public.locations
  for all to anon using (true) with check (true);

-- Índex útils per a la pàgina d'estadístiques
create index if not exists idx_projects_created on public.projects (created_at desc);
create index if not exists idx_projects_category on public.projects (category);
