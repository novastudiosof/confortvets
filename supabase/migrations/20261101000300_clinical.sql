-- ConfortVets — historia clínica: consultas, controles, exámenes, fórmulas.
-- Las consultas cerradas NO se modifican ni se borran: se corrigen con notas
-- aclaratorias o se anulan con motivo (docs/DISENO.md, sección 8).

create table control_types (
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
create trigger control_types_updated_at before update on control_types
  for each row execute function set_updated_at();

create table consultations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  patient_id uuid not null,
  kind text not null default 'consulta' check (kind in ('consulta', 'control')),
  parent_consultation_id uuid,
  consulted_at timestamptz not null default now(),
  professional_id uuid default auth.uid(),
  professional_name text not null,
  reason text,                                  -- motivo de consulta
  anamnesis text,
  weight_kg numeric(6, 2) check (weight_kg is null or weight_kg > 0),
  temperature_c numeric(4, 1) check (temperature_c is null or temperature_c between 20 and 50),
  heart_rate int check (heart_rate is null or heart_rate between 0 and 400),        -- FC
  resp_rate int check (resp_rate is null or resp_rate between 0 and 200),           -- FR
  mucous_membranes text,
  capillary_refill_s numeric(3, 1) check (capillary_refill_s is null or capillary_refill_s >= 0),
  hydration text,
  body_condition int check (body_condition is null or body_condition between 1 and 9),
  differential_diagnoses text,
  exams_notes text,                             -- exámenes solicitados / observaciones
  definitive_diagnosis text,
  treatment text,
  recommendations text,
  control_type_id uuid,
  next_control_date date,
  custom_fields jsonb not null default '{}'::jsonb,
  status text not null default 'borrador' check (status in ('borrador', 'cerrada', 'anulada')),
  closed_at timestamptz,
  closed_by uuid,
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (patient_id, organization_id) references patients (id, organization_id),
  foreign key (parent_consultation_id, organization_id) references consultations (id, organization_id),
  foreign key (control_type_id, organization_id) references control_types (id, organization_id)
);
create index consultations_patient_idx on consultations (organization_id, patient_id, consulted_at desc);
create trigger consultations_updated_at before update on consultations
  for each row execute function set_updated_at();

create or replace function consultations_guard()
returns trigger
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_void_keys text[] := array['status', 'voided_at', 'voided_by', 'void_reason', 'updated_at'];
begin
  if tg_op = 'INSERT' then
    if new.status <> 'borrador' then
      raise exception 'Una consulta nueva siempre empieza como borrador.' using errcode = 'P0001';
    end if;
    return new;
  end if;

  if new.organization_id <> old.organization_id or new.patient_id <> old.patient_id then
    raise exception 'No se puede cambiar el paciente de una consulta.' using errcode = 'P0001';
  end if;

  if old.status = 'anulada' then
    raise exception 'La consulta está anulada y no se puede modificar.' using errcode = 'P0001';
  end if;

  if old.status = 'cerrada' then
    if new.status <> 'anulada' then
      raise exception 'La consulta está cerrada. Agrega una nota aclaratoria.' using errcode = 'P0001';
    end if;
    if (to_jsonb(new) - v_void_keys) <> (to_jsonb(old) - v_void_keys) then
      raise exception 'Al anular una consulta solo se registra el motivo.' using errcode = 'P0001';
    end if;
    if coalesce(btrim(new.void_reason), '') = '' then
      raise exception 'Indica el motivo de la anulación.' using errcode = 'P0001';
    end if;
    if v_user is not null and not has_permission('clinical.void') then
      raise exception 'No tienes permiso para anular consultas.' using errcode = '42501';
    end if;
    new.voided_at := now();
    new.voided_by := v_user;
    return new;
  end if;

  -- old.status = 'borrador'
  if new.status = 'cerrada' then
    if v_user is not null and not has_permission('clinical.close') then
      raise exception 'No tienes permiso para cerrar consultas.' using errcode = '42501';
    end if;
    new.closed_at := now();
    new.closed_by := v_user;
  elsif new.status = 'anulada' then
    if coalesce(btrim(new.void_reason), '') = '' then
      raise exception 'Indica el motivo de la anulación.' using errcode = 'P0001';
    end if;
    if v_user is not null and not has_permission('clinical.void') then
      raise exception 'No tienes permiso para anular consultas.' using errcode = '42501';
    end if;
    new.voided_at := now();
    new.voided_by := v_user;
  end if;
  return new;
end;
$$;
create trigger consultations_guard before insert or update on consultations
  for each row execute function consultations_guard();

create or replace function consultations_no_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Las consultas no se borran: anúlalas con un motivo.' using errcode = 'P0001';
end;
$$;
create trigger consultations_no_delete before delete on consultations
  for each row execute function consultations_no_delete();

-- Notas aclaratorias posteriores al cierre (solo se agregan).
create table consultation_addenda (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  consultation_id uuid not null,
  content text not null check (btrim(content) <> ''),
  author_id uuid default auth.uid(),
  author_name text not null,
  created_at timestamptz not null default now(),
  foreign key (consultation_id, organization_id) references consultations (id, organization_id)
);
create index consultation_addenda_idx on consultation_addenda (organization_id, consultation_id);
create trigger consultation_addenda_immutable before update or delete on consultation_addenda
  for each row execute function block_mutation();

create or replace function addenda_require_closed()
returns trigger
language plpgsql
as $$
declare
  v_status text;
begin
  select status into v_status from consultations
    where id = new.consultation_id and organization_id = new.organization_id;
  if v_status <> 'cerrada' then
    raise exception 'Las notas aclaratorias se agregan a consultas cerradas.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger consultation_addenda_closed before insert on consultation_addenda
  for each row execute function addenda_require_closed();

-- Resultados de exámenes complementarios (PDF o imagen).
create table exam_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  consultation_id uuid not null,
  patient_id uuid not null,
  file_id uuid not null,
  exam_name text not null,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (consultation_id, organization_id) references consultations (id, organization_id),
  foreign key (patient_id, organization_id) references patients (id, organization_id),
  foreign key (file_id, organization_id) references files (id, organization_id)
);
create index exam_files_idx on exam_files (organization_id, consultation_id);

-- Catálogos de apoyo
create table medications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null,
  presentation text,
  default_dose text,
  default_frequency text,
  default_duration text,
  route text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);
create trigger medications_updated_at before update on medications
  for each row execute function set_updated_at();

create table text_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  kind text not null check (kind in ('anamnesis', 'diagnosis', 'treatment', 'recommendations', 'exam')),
  title text not null,
  body text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger text_templates_updated_at before update on text_templates
  for each row execute function set_updated_at();

-- Fórmulas médicas
create table prescriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  consultation_id uuid not null,
  patient_id uuid not null,
  number int not null,
  issued_at timestamptz not null default now(),
  professional_name text not null,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, number),
  unique (consultation_id),
  foreign key (consultation_id, organization_id) references consultations (id, organization_id),
  foreign key (patient_id, organization_id) references patients (id, organization_id)
);
create trigger prescriptions_updated_at before update on prescriptions
  for each row execute function set_updated_at();

create table prescription_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  prescription_id uuid not null,
  medication_name text not null,
  presentation text,
  dose text,
  frequency text,
  duration text,
  route text,
  instructions text,
  sort_order int not null default 0,
  foreign key (prescription_id, organization_id) references prescriptions (id, organization_id) on delete cascade
);
create index prescription_items_idx on prescription_items (organization_id, prescription_id);

create or replace function prescriptions_set_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.number is null or new.number = 0 then
    new.number := next_counter(new.organization_id, 'prescription');
  end if;
  return new;
end;
$$;
-- "number" es obligatorio; el valor 0 pide un consecutivo automático.
alter table prescriptions alter column number set default 0;
create trigger prescriptions_number before insert on prescriptions
  for each row execute function prescriptions_set_number();

-- Una fórmula solo se edita mientras su consulta es borrador.
create or replace function assert_consultation_draft(p_consultation uuid, p_org uuid)
returns void
language plpgsql
as $$
declare
  v_status text;
begin
  select status into v_status from consultations
    where id = p_consultation and organization_id = p_org;
  if v_status is distinct from 'borrador' then
    raise exception 'La consulta ya está cerrada: la fórmula no se puede modificar.'
      using errcode = 'P0001';
  end if;
end;
$$;

create or replace function prescriptions_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    perform assert_consultation_draft(old.consultation_id, old.organization_id);
    return old;
  end if;
  perform assert_consultation_draft(new.consultation_id, new.organization_id);
  return new;
end;
$$;
create trigger prescriptions_guard before insert or update or delete on prescriptions
  for each row execute function prescriptions_guard();

create or replace function prescription_items_guard()
returns trigger
language plpgsql
as $$
declare
  v_consultation uuid;
  v_org uuid;
  v_prescription uuid;
begin
  v_prescription := case when tg_op = 'DELETE' then old.prescription_id else new.prescription_id end;
  v_org := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  select consultation_id into v_consultation from prescriptions
    where id = v_prescription and organization_id = v_org;
  -- Si la fórmula ya no existe (borrado en cascada) no hay nada que validar.
  if v_consultation is not null then
    perform assert_consultation_draft(v_consultation, v_org);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger prescription_items_guard before insert or update or delete on prescription_items
  for each row execute function prescription_items_guard();

-- ==========================================================================
-- RLS
-- ==========================================================================
select _apply_tenant_rls('control_types', 'member', 'settings.write');
select _apply_tenant_rls('medications', 'member', 'clinical.write');
select _apply_tenant_rls('text_templates', 'member', 'clinical.write', true, true);
select _apply_tenant_rls('consultations', 'clinical.read', 'clinical.write');
select _apply_tenant_rls('consultation_addenda', 'clinical.read', 'clinical.write', false, false);
select _apply_tenant_rls('exam_files', 'clinical.read', 'clinical.write');
select _apply_tenant_rls('prescriptions', 'clinical.read', 'prescriptions.write', true, true);
select _apply_tenant_rls('prescription_items', 'clinical.read', 'prescriptions.write', true, true);
