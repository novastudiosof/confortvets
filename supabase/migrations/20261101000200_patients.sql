-- ConfortVets — tutores, pacientes, catálogos y campos personalizados.
-- Toda relación entre tablas de negocio usa clave compuesta
-- (id, organization_id): la base de datos impide que una fila apunte a datos
-- de otra organización aunque la aplicación tuviera un error.

-- ==========================================================================
-- Catálogos de especies y razas (editables por organización)
-- ==========================================================================
create table species (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, name)
);
create trigger species_updated_at before update on species
  for each row execute function set_updated_at();

create table breeds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  species_id uuid not null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, species_id, name),
  foreign key (species_id, organization_id) references species (id, organization_id)
);
create trigger breeds_updated_at before update on breeds
  for each row execute function set_updated_at();

-- ==========================================================================
-- Tutores
-- ==========================================================================
create table tutors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  full_name text not null,
  document_number text,                    -- cédula
  phone text,
  whatsapp text,
  email text,
  address text,
  neighborhood text,                       -- barrio
  city text,
  notes text,
  custom_fields jsonb not null default '{}'::jsonb,
  data_consent boolean not null default false,       -- autorización de datos
  data_consent_at timestamptz,
  contact_consent boolean not null default false,    -- autoriza WhatsApp/llamadas
  contact_consent_at timestamptz,
  is_active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create unique index tutors_document_key
  on tutors (organization_id, document_number) where document_number is not null;
create index tutors_name_idx on tutors (organization_id, lower(full_name));
create trigger tutors_updated_at before update on tutors
  for each row execute function set_updated_at();

-- ==========================================================================
-- Pacientes
-- ==========================================================================
create table patients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  tutor_id uuid not null,
  name text not null,
  species_id uuid not null,
  breed_id uuid,
  breed_text text,                         -- raza escrita a mano
  sex text not null default 'indeterminado'
    check (sex in ('macho', 'hembra', 'indeterminado')),
  color text,
  birth_date date,
  birth_date_approx boolean not null default false,
  microchip text,
  sterilized boolean,
  allergies text,
  background text,                         -- antecedentes
  photo_file_id uuid references files(id) on delete set null,
  status text not null default 'activo' check (status in ('activo', 'fallecido')),
  deceased_at date,
  deceased_reason text,
  custom_fields jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (tutor_id, organization_id) references tutors (id, organization_id),
  foreign key (species_id, organization_id) references species (id, organization_id),
  foreign key (breed_id, organization_id) references breeds (id, organization_id)
);
create index patients_tutor_idx on patients (organization_id, tutor_id);
create index patients_name_idx on patients (organization_id, lower(name));
create trigger patients_updated_at before update on patients
  for each row execute function set_updated_at();

create table patient_weights (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  patient_id uuid not null,
  weight_kg numeric(6, 2) not null check (weight_kg > 0),
  measured_at date not null default current_date,
  consultation_id uuid,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (patient_id, organization_id) references patients (id, organization_id)
);
create index patient_weights_idx on patient_weights (organization_id, patient_id, measured_at);

-- ==========================================================================
-- Campos personalizados por organización
-- ==========================================================================
create table custom_field_defs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  entity text not null check (entity in ('tutor', 'patient', 'consultation')),
  section text,
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  label text not null,
  field_type text not null check (field_type in ('text', 'number', 'select', 'boolean', 'date')),
  options jsonb not null default '[]'::jsonb,
  required boolean not null default false,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, entity, key)
);
create trigger custom_field_defs_updated_at before update on custom_field_defs
  for each row execute function set_updated_at();

-- ==========================================================================
-- RLS
-- ==========================================================================
select _apply_tenant_rls('species', 'member', 'settings.write');
select _apply_tenant_rls('breeds', 'member', 'settings.write');
select _apply_tenant_rls('custom_field_defs', 'member', 'settings.write');
select _apply_tenant_rls('tutors', 'tutors.read', 'tutors.write');
select _apply_tenant_rls('patients', 'patients.read', 'patients.write');
select _apply_tenant_rls('patient_weights', 'patients.read', 'patients.write', true, true);

-- ==========================================================================
-- Resumen de uso para el panel del super admin. Solo cuenta filas: no expone
-- ningún dato clínico ni personal.
-- ==========================================================================
create or replace function org_usage()
returns table (
  organization_id uuid,
  storage_bytes bigint,
  users_count bigint,
  tutors_count bigint,
  patients_count bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select o.id,
      coalesce((select sum(f.size_bytes) from files f
                where f.organization_id = o.id and f.deleted_at is null), 0)::bigint,
      (select count(*) from profiles p where p.organization_id = o.id),
      (select count(*) from tutors t where t.organization_id = o.id),
      (select count(*) from patients pa where pa.organization_id = o.id)
    from organizations o;
end;
$$;
