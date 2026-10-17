-- ProjectBuddy · esquema de la base de dades (Supabase / Postgres)
-- Enganxa tot aquest fitxer al SQL Editor del teu projecte Supabase i executa'l un sol cop.
--
-- També serveix per posar al dia una base de dades creada amb una versió
-- anterior: tot és idempotent, el pots tornar a executar sense perdre res.
--
-- Cada fila pertany a un usuari (Supabase Auth). Les polítiques RLS del final
-- fan que cada usuari només pugui veure i tocar les seves pròpies files; la
-- clau "anon" de js/config.js sola ja no dona accés a cap dada.

-- Taula principal: cada idea/projecte
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade default auth.uid(),
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
  status text not null default 'idea',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Si ja tenies la taula "projects" creada d'abans (app instal·lada abans que
-- s'afegís l'estat de la idea), aquesta línia sola n'hi ha prou per posar-la
-- al dia sense perdre res: torna a enganxar-la i executa-la al SQL Editor.
alter table public.projects add column if not exists status text not null default 'idea';

-- Categories i ubicacions personalitzades que vas afegint
-- (les predeterminades viuen al client, aquestes són les que tu mateix crees)
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade default auth.uid(),
  name text not null,
  color_slot smallint not null default 1 check (color_slot between 1 and 8),
  created_at timestamptz not null default now()
);

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade default auth.uid(),
  name text not null,
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

-- ---------------------------------------------------------------------------
-- Usuaris: cada fila té propietari
-- ---------------------------------------------------------------------------

-- Bases de dades d'abans del login: afegeix la columna de propietari
alter table public.projects   add column if not exists user_id uuid references auth.users (id) on delete cascade default auth.uid();
alter table public.categories add column if not exists user_id uuid references auth.users (id) on delete cascade default auth.uid();
alter table public.locations  add column if not exists user_id uuid references auth.users (id) on delete cascade default auth.uid();

-- Les files que ja existien sense propietari (d'abans del login) passen a ser
-- del primer usuari registrat, que és qui feia servir l'app fins ara.
update public.projects   set user_id = (select id from auth.users order by created_at limit 1) where user_id is null;
update public.categories set user_id = (select id from auth.users order by created_at limit 1) where user_id is null;
update public.locations  set user_id = (select id from auth.users order by created_at limit 1) where user_id is null;

alter table public.projects   alter column user_id set not null;
alter table public.categories alter column user_id set not null;
alter table public.locations  alter column user_id set not null;

-- Noms de categoria/ubicació únics per usuari (abans eren únics globals)
alter table public.categories drop constraint if exists categories_name_key;
alter table public.locations  drop constraint if exists locations_name_key;
create unique index if not exists uq_categories_user_name on public.categories (user_id, name);
create unique index if not exists uq_locations_user_name  on public.locations (user_id, name);

-- ---------------------------------------------------------------------------
-- Seguretat (RLS): només el propietari veu i modifica les seves files
-- ---------------------------------------------------------------------------
alter table public.projects enable row level security;
alter table public.categories enable row level security;
alter table public.locations enable row level security;

-- Les polítiques obertes de la versió sense login
drop policy if exists "projects: open access" on public.projects;
drop policy if exists "categories: open access" on public.categories;
drop policy if exists "locations: open access" on public.locations;

drop policy if exists "projects: own rows" on public.projects;
create policy "projects: own rows" on public.projects
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "categories: own rows" on public.categories;
create policy "categories: own rows" on public.categories
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "locations: own rows" on public.locations;
create policy "locations: own rows" on public.locations
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Índex útils per a la pàgina d'estadístiques
create index if not exists idx_projects_created on public.projects (created_at desc);
create index if not exists idx_projects_category on public.projects (category);
create index if not exists idx_projects_user on public.projects (user_id);

-- ---------------------------------------------------------------------------
-- Projectes: agrupen idees
-- ---------------------------------------------------------------------------
-- (Per motius històrics la taula "projects" de dalt guarda les idees; els
-- projectes de veritat, que reuneixen diverses idees, viuen en aquesta.)
create table if not exists public.project_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  title text not null default '',
  content text not null default '',
  category text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_project_groups_updated_at on public.project_groups;
create trigger trg_project_groups_updated_at
  before update on public.project_groups
  for each row execute function public.set_updated_at();

-- Cada idea pot estar enllaçada a un projecte. Si s'esborra el projecte, les
-- idees es queden, només es desenllacen.
alter table public.projects add column if not exists group_id uuid references public.project_groups (id) on delete set null;
create index if not exists idx_projects_group on public.projects (group_id);
create index if not exists idx_project_groups_user on public.project_groups (user_id);

alter table public.project_groups enable row level security;

drop policy if exists "project_groups: own rows" on public.project_groups;
create policy "project_groups: own rows" on public.project_groups
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Estat del projecte (com el de les idees): idea, en_curs, feta, abandonada
alter table public.project_groups add column if not exists status text not null default 'idea';

-- Fa que l'API vegi de seguida la taula i la columna noves
notify pgrst, 'reload schema';
