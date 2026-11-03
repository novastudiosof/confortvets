-- ConfortVets — núcleo multi-organización.
-- Organizaciones, usuarios, módulos, permisos, bitácora, archivos y las
-- funciones que usan todas las políticas RLS.
-- Ver docs/DISENO.md (secciones 4, 5, 8 y 9).

-- ==========================================================================
-- Utilidades
-- ==========================================================================
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ==========================================================================
-- Organizaciones
-- ==========================================================================
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  is_active boolean not null default true,
  valid_until date,                       -- membresía; null = sin vencimiento
  max_auxiliares int not null default 2 check (max_auxiliares >= 0),
  storage_quota_mb int not null default 100 check (storage_quota_mb >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger organizations_updated_at before update on organizations
  for each row execute function set_updated_at();

-- ==========================================================================
-- Archivos (registro de cada archivo subido; sirve para la cuota)
-- ==========================================================================
create table files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  kind text not null check (kind in
    ('logo', 'patient_photo', 'exam', 'signature', 'consent_upload', 'other')),
  storage_path text not null unique,
  original_name text,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid,
  unique (id, organization_id)
);
create index files_org_idx on files (organization_id) where deleted_at is null;

-- ==========================================================================
-- Marca y datos de la organización (todo editable desde la base de datos)
-- ==========================================================================
create table organization_settings (
  organization_id uuid primary key references organizations(id),
  business_name text not null,
  professional_name text,
  professional_card text,                 -- tarjeta profesional
  phone text,
  whatsapp text,                          -- solo dígitos con indicativo de país
  email text,
  address text,
  city text,
  logo_file_id uuid references files(id) on delete set null,
  primary_color text not null default '#3B82F6'
    check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  letterhead_text text,
  data_policy_text text,                  -- política de tratamiento de datos propia
  timezone text not null default 'America/Bogota',
  currency text not null default 'COP',
  updated_at timestamptz not null default now()
);
create trigger organization_settings_updated_at before update on organization_settings
  for each row execute function set_updated_at();

-- ==========================================================================
-- Usuarios
-- ==========================================================================
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid references organizations(id),
  username text not null,
  full_name text not null,
  auth_email text not null unique,        -- correo interno de Supabase Auth
  role text not null check (role in ('super_admin', 'owner', 'auxiliar')),
  is_active boolean not null default true,
  must_change_password boolean not null default false,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (role = 'super_admin' and organization_id is null)
    or (role <> 'super_admin' and organization_id is not null)
  ),
  check (username ~ '^[a-z0-9._-]{3,30}$')
);
create unique index profiles_username_key on profiles (lower(username));
create unique index profiles_one_owner on profiles (organization_id) where role = 'owner';
create index profiles_org_idx on profiles (organization_id);
create trigger profiles_updated_at before update on profiles
  for each row execute function set_updated_at();

-- Límite de auxiliares por organización (defensa en profundidad: la
-- aplicación también lo valida).
create or replace function enforce_max_auxiliares()
returns trigger
language plpgsql
as $$
declare
  v_max int;
  v_count int;
begin
  if new.role <> 'auxiliar' then
    return new;
  end if;
  select max_auxiliares into v_max from organizations where id = new.organization_id;
  select count(*) into v_count from profiles
    where organization_id = new.organization_id and role = 'auxiliar';
  if v_count >= v_max then
    raise exception 'max_auxiliares_exceeded' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger profiles_max_auxiliares before insert on profiles
  for each row execute function enforce_max_auxiliares();

-- ==========================================================================
-- Módulos y permisos
-- ==========================================================================
create table modules (
  key text primary key,
  name text not null,
  description text,
  is_core boolean not null default false,
  available boolean not null default true,  -- false = aún no construido
  sort_order int not null default 0
);

create table permissions (
  key text primary key,
  module_key text not null references modules(key),
  description text not null,
  sort_order int not null default 0
);

create table organization_modules (
  organization_id uuid not null references organizations(id),
  module_key text not null references modules(key),
  enabled boolean not null default false,
  enabled_at timestamptz,
  primary key (organization_id, module_key)
);

-- Restricciones que el super admin pone a una organización. Sin fila =
-- permitido.
create table organization_permissions (
  organization_id uuid not null references organizations(id),
  permission_key text not null references permissions(key),
  enabled boolean not null default true,
  primary key (organization_id, permission_key)
);

-- Permisos que el owner da a cada auxiliar.
create table auxiliary_permissions (
  profile_id uuid not null references profiles(id) on delete cascade,
  organization_id uuid not null references organizations(id),
  permission_key text not null references permissions(key),
  primary key (profile_id, permission_key)
);
create index auxiliary_permissions_org_idx on auxiliary_permissions (organization_id);

-- ==========================================================================
-- Bitácora (solo se inserta), control de intentos y contadores
-- ==========================================================================
create table activity_log (
  id bigint generated always as identity primary key,
  organization_id uuid references organizations(id),
  user_id uuid default auth.uid(),
  user_name text,
  action text not null,
  entity text,
  entity_id uuid,
  detail text,
  details jsonb,
  created_at timestamptz not null default now()
);
create index activity_log_org_idx on activity_log (organization_id, created_at desc);

create or replace function block_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Este registro no se puede modificar ni borrar (%).', tg_table_name
    using errcode = 'P0001';
end;
$$;
create trigger activity_log_immutable before update or delete on activity_log
  for each row execute function block_mutation();

create table login_attempts (
  id bigint generated always as identity primary key,
  username text not null,
  ip text,
  success boolean not null,
  created_at timestamptz not null default now()
);
create index login_attempts_user_idx on login_attempts (lower(username), created_at desc);

-- Consecutivos por organización (p. ej. número de fórmula).
create table org_counters (
  organization_id uuid not null references organizations(id),
  key text not null,
  value int not null default 0,
  primary key (organization_id, key)
);

create or replace function next_counter(p_org uuid, p_key text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v int;
begin
  insert into org_counters (organization_id, key, value) values (p_org, p_key, 1)
  on conflict (organization_id, key) do update set value = org_counters.value + 1
  returning value into v;
  return v;
end;
$$;

-- ==========================================================================
-- Funciones de seguridad usadas por RLS
-- ==========================================================================
create or replace function current_org()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select organization_id from profiles where id = auth.uid() and is_active
$$;

create or replace function current_user_role()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role from profiles where id = auth.uid() and is_active
$$;

create or replace function is_super_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((select role = 'super_admin' from profiles
                   where id = auth.uid() and is_active), false)
$$;

create or replace function is_owner()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((select role = 'owner' from profiles
                   where id = auth.uid() and is_active), false)
$$;

-- Usuario activo de una organización activa.
create or replace function is_org_member()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((
    select o.is_active
    from profiles p
    join organizations o on o.id = p.organization_id
    where p.id = auth.uid() and p.is_active and p.role in ('owner', 'auxiliar')
  ), false)
$$;

-- Miembro cuya membresía no está vencida (permite escribir).
create or replace function is_membership_active()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((
    select o.is_active
           and (o.valid_until is null
                or o.valid_until >= (now() at time zone 'America/Bogota')::date)
    from profiles p
    join organizations o on o.id = p.organization_id
    where p.id = auth.uid() and p.is_active and p.role in ('owner', 'auxiliar')
  ), false)
$$;

-- ¿El módulo está habilitado para la organización del usuario?
create or replace function has_module(p_module text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((
    select m.is_core or coalesce(om.enabled, false)
    from profiles p
    join organizations o on o.id = p.organization_id and o.is_active
    join modules m on m.key = p_module
    left join organization_modules om
      on om.organization_id = o.id and om.module_key = m.key
    where p.id = auth.uid() and p.is_active and p.role in ('owner', 'auxiliar')
  ), false)
$$;

-- ¿El usuario tiene el permiso? Owner: todos los de módulos activos.
-- Auxiliar: solo los que el owner le asignó. La restricción del super admin
-- (organization_permissions.enabled = false) aplica a todos.
create or replace function has_permission(p_permission text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((
    select
      (m.is_core or coalesce(om.enabled, false))
      and coalesce(op.enabled, true)
      and (
        p.role = 'owner'
        or (p.role = 'auxiliar' and exists (
              select 1 from auxiliary_permissions ap
              where ap.profile_id = p.id and ap.permission_key = pm.key))
      )
    from profiles p
    join organizations o on o.id = p.organization_id and o.is_active
    join permissions pm on pm.key = p_permission
    join modules m on m.key = pm.module_key
    left join organization_modules om
      on om.organization_id = o.id and om.module_key = m.key
    left join organization_permissions op
      on op.organization_id = o.id and op.permission_key = pm.key
    where p.id = auth.uid() and p.is_active and p.role in ('owner', 'auxiliar')
  ), false)
$$;

-- Cuota de almacenamiento: no deja insertar un archivo que la exceda.
create or replace function enforce_storage_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quota bigint;
  v_used bigint;
begin
  select storage_quota_mb::bigint * 1048576 into v_quota
    from organizations where id = new.organization_id;
  select coalesce(sum(size_bytes), 0) into v_used
    from files where organization_id = new.organization_id and deleted_at is null;
  if v_used + new.size_bytes > v_quota then
    raise exception 'storage_quota_exceeded' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger files_quota before insert on files
  for each row execute function enforce_storage_quota();

-- (org_usage, el resumen de uso para el super admin, se define en la
-- migración de pacientes porque cuenta tutores y pacientes.)

-- ==========================================================================
-- Ayudante para crear las políticas RLS estándar de una tabla de negocio.
--   read_perm  = permiso de lectura, o 'member' (cualquier miembro activo)
--   write_perm = permiso de escritura
-- Lectura: miembro de la organización con el permiso (aunque la membresía
-- esté vencida). Escritura: además requiere membresía vigente.
-- ==========================================================================
create or replace function _apply_tenant_rls(
  tbl regclass,
  read_perm text,
  write_perm text,
  allow_update boolean default true,
  allow_delete boolean default false
)
returns void
language plpgsql
as $$
declare
  n text := replace(tbl::text, 'public.', '');
  read_check text;
  write_check text;
begin
  if read_perm = 'member' then
    read_check := '(select is_org_member())';
  else
    read_check := format('(select has_permission(%L))', read_perm);
  end if;
  write_check := format('(select has_permission(%L)) and (select is_membership_active())', write_perm);

  execute format('alter table %s enable row level security', tbl);

  execute format('drop policy if exists %I on %s', n || '_select', tbl);
  execute format(
    'create policy %I on %s for select to authenticated using (organization_id = (select current_org()) and %s)',
    n || '_select', tbl, read_check);

  execute format('drop policy if exists %I on %s', n || '_insert', tbl);
  execute format(
    'create policy %I on %s for insert to authenticated with check (organization_id = (select current_org()) and %s)',
    n || '_insert', tbl, write_check);

  if allow_update then
    execute format('drop policy if exists %I on %s', n || '_update', tbl);
    execute format(
      'create policy %I on %s for update to authenticated using (organization_id = (select current_org()) and %s) with check (organization_id = (select current_org()) and %s)',
      n || '_update', tbl, write_check, write_check);
  end if;

  if allow_delete then
    execute format('drop policy if exists %I on %s', n || '_delete', tbl);
    execute format(
      'create policy %I on %s for delete to authenticated using (organization_id = (select current_org()) and %s)',
      n || '_delete', tbl, write_check);
  end if;
end;
$$;

-- ==========================================================================
-- RLS de las tablas del núcleo
-- ==========================================================================
alter table organizations enable row level security;
create policy organizations_select on organizations for select to authenticated
  using (id = (select current_org()) or (select is_super_admin()));
create policy organizations_insert on organizations for insert to authenticated
  with check ((select is_super_admin()));
create policy organizations_update on organizations for update to authenticated
  using ((select is_super_admin())) with check ((select is_super_admin()));

alter table organization_settings enable row level security;
create policy organization_settings_select on organization_settings for select to authenticated
  using (organization_id = (select current_org()) or (select is_super_admin()));
create policy organization_settings_insert on organization_settings for insert to authenticated
  with check ((select is_super_admin()));
create policy organization_settings_update on organization_settings for update to authenticated
  using (
    (organization_id = (select current_org())
      and (select has_permission('settings.write'))
      and (select is_membership_active()))
    or (select is_super_admin())
  )
  with check (
    (organization_id = (select current_org())
      and (select has_permission('settings.write'))
      and (select is_membership_active()))
    or (select is_super_admin())
  );

-- Los perfiles solo se crean y modifican desde el servidor con la llave de
-- servicio (que se salta RLS): no hay políticas de escritura para usuarios.
alter table profiles enable row level security;
create policy profiles_select on profiles for select to authenticated
  using (
    id = (select auth.uid())
    or (organization_id = (select current_org()) and (select is_owner()))
    or (select is_super_admin())
  );

alter table modules enable row level security;
create policy modules_select on modules for select to authenticated using (true);

alter table permissions enable row level security;
create policy permissions_select on permissions for select to authenticated using (true);

alter table organization_modules enable row level security;
create policy organization_modules_select on organization_modules for select to authenticated
  using (organization_id = (select current_org()) or (select is_super_admin()));
create policy organization_modules_insert on organization_modules for insert to authenticated
  with check ((select is_super_admin()));
create policy organization_modules_update on organization_modules for update to authenticated
  using ((select is_super_admin())) with check ((select is_super_admin()));

alter table organization_permissions enable row level security;
create policy organization_permissions_select on organization_permissions for select to authenticated
  using (organization_id = (select current_org()) or (select is_super_admin()));
create policy organization_permissions_insert on organization_permissions for insert to authenticated
  with check ((select is_super_admin()));
create policy organization_permissions_update on organization_permissions for update to authenticated
  using ((select is_super_admin())) with check ((select is_super_admin()));
create policy organization_permissions_delete on organization_permissions for delete to authenticated
  using ((select is_super_admin()));

alter table auxiliary_permissions enable row level security;
create policy auxiliary_permissions_select on auxiliary_permissions for select to authenticated
  using (
    profile_id = (select auth.uid())
    or (organization_id = (select current_org()) and (select is_owner()))
    or (select is_super_admin())
  );

alter table activity_log enable row level security;
create policy activity_log_select on activity_log for select to authenticated
  using (
    (organization_id = (select current_org()) and (select is_owner()))
    or (select is_super_admin())
  );
create policy activity_log_insert on activity_log for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (organization_id = (select current_org()) or (select is_super_admin()))
  );

alter table files enable row level security;
create policy files_select on files for select to authenticated
  using (organization_id = (select current_org()) and (select is_org_member()));
create policy files_insert on files for insert to authenticated
  with check (
    organization_id = (select current_org())
    and (select has_permission('files.upload'))
    and (select is_membership_active())
  );

-- Sin políticas: solo la llave de servicio puede leerlas o escribirlas.
alter table login_attempts enable row level security;
alter table org_counters enable row level security;
