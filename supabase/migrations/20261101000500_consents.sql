-- ConfortVets — autorizaciones (consentimientos) con firma.
-- Cada autorización guarda una COPIA CONGELADA del texto que se firmó y una
-- huella (hash) calculada por la base de datos. Una vez firmada no se modifica.
-- Los textos de las plantillas son de ejemplo y deben ser revisados por un
-- abogado (docs/DISENO.md, sección 13).

create table consent_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  kind text not null check (kind in
    ('vacuna', 'anestesia', 'procedimiento', 'eutanasia', 'datos', 'otro')),
  title text not null,
  body text not null,
  version int not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create trigger consent_templates_updated_at before update on consent_templates
  for each row execute function set_updated_at();

create table consents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  kind text not null check (kind in
    ('vacuna', 'anestesia', 'procedimiento', 'eutanasia', 'datos', 'otro')),
  template_id uuid,
  template_version int,
  patient_id uuid,                                -- nulo en la autorización de datos
  tutor_id uuid not null,
  consultation_id uuid,
  title text not null,
  body text not null,                             -- texto ya con los datos del tutor/paciente
  procedure_description text,
  content_hash text,
  status text not null default 'pendiente'
    check (status in ('pendiente', 'firmada', 'rechazada', 'anulada')),
  signed_at timestamptz,
  signer_name text,
  signer_document text,
  signature_method text check (signature_method in ('pantalla', 'archivo')),
  signature_file_id uuid,
  upload_file_id uuid,
  signer_ip text,
  signer_user_agent text,
  decline_reason text,
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (template_id, organization_id) references consent_templates (id, organization_id),
  foreign key (patient_id, organization_id) references patients (id, organization_id),
  foreign key (tutor_id, organization_id) references tutors (id, organization_id),
  foreign key (consultation_id, organization_id) references consultations (id, organization_id),
  foreign key (signature_file_id, organization_id) references files (id, organization_id),
  foreign key (upload_file_id, organization_id) references files (id, organization_id)
);
create index consents_patient_idx on consents (organization_id, patient_id, created_at desc);
create index consents_tutor_idx on consents (organization_id, tutor_id, created_at desc);
create trigger consents_updated_at before update on consents
  for each row execute function set_updated_at();

create or replace function consents_guard()
returns trigger
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_void_keys text[] := array['status', 'voided_at', 'voided_by', 'void_reason', 'updated_at'];
begin
  if tg_op = 'DELETE' then
    raise exception 'Las autorizaciones no se borran: anúlalas con un motivo.' using errcode = 'P0001';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'pendiente' then
      raise exception 'Una autorización nueva siempre empieza pendiente.' using errcode = 'P0001';
    end if;
    return new;
  end if;

  if old.status in ('firmada', 'rechazada') then
    if new.status <> 'anulada'
       or (to_jsonb(new) - v_void_keys) <> (to_jsonb(old) - v_void_keys) then
      raise exception 'La autorización ya está resuelta y no se puede modificar.' using errcode = 'P0001';
    end if;
  end if;
  if old.status = 'anulada' then
    raise exception 'La autorización está anulada.' using errcode = 'P0001';
  end if;

  if new.status = 'anulada' then
    if coalesce(btrim(new.void_reason), '') = '' then
      raise exception 'Indica el motivo de la anulación.' using errcode = 'P0001';
    end if;
    new.voided_at := now();
    new.voided_by := v_user;
    return new;
  end if;

  if old.status = 'pendiente' and new.status = 'firmada' then
    if v_user is not null and not has_permission('consents.sign') then
      raise exception 'No tienes permiso para registrar firmas.' using errcode = '42501';
    end if;
    if coalesce(btrim(new.signer_name), '') = '' or coalesce(btrim(new.signer_document), '') = '' then
      raise exception 'Faltan el nombre y la cédula de quien firma.' using errcode = 'P0001';
    end if;
    if new.signature_method = 'pantalla' and new.signature_file_id is null then
      raise exception 'Falta la firma.' using errcode = 'P0001';
    end if;
    if new.signature_method = 'archivo' and new.upload_file_id is null then
      raise exception 'Falta el archivo firmado.' using errcode = 'P0001';
    end if;
    if new.signature_method is null then
      raise exception 'Indica cómo se firmó.' using errcode = 'P0001';
    end if;
    new.signed_at := now();
    new.content_hash := encode(sha256(convert_to(
      new.title || E'\n' || new.body || E'\n' || coalesce(new.procedure_description, '')
      || E'\n' || new.signer_name || E'\n' || new.signer_document
      || E'\n' || to_char(new.signed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'UTF8')), 'hex');
  elsif old.status = 'pendiente' and new.status = 'rechazada' then
    if v_user is not null and not has_permission('consents.sign') then
      raise exception 'No tienes permiso para registrar esta respuesta.' using errcode = '42501';
    end if;
    new.signed_at := now();
  elsif old.status = 'pendiente' and new.status = 'pendiente' then
    -- Se puede ajustar el procedimiento mientras esté pendiente.
    null;
  end if;
  return new;
end;
$$;
create trigger consents_guard before insert or update or delete on consents
  for each row execute function consents_guard();

-- Al firmarse una autorización de datos, el tutor queda con consentimiento.
create or replace function trg_consent_data()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind = 'datos' and new.status = 'firmada' and old.status <> 'firmada' then
    update tutors
       set data_consent = true, data_consent_at = new.signed_at
     where id = new.tutor_id and organization_id = new.organization_id;
  end if;
  return new;
end;
$$;
create trigger consents_data after update on consents
  for each row execute function trg_consent_data();

-- ==========================================================================
-- RLS
-- ==========================================================================
select _apply_tenant_rls('consent_templates', 'member', 'settings.write');

alter table consents enable row level security;
create policy consents_select on consents for select to authenticated
  using (organization_id = (select current_org()) and (select has_permission('consents.read')));
create policy consents_insert on consents for insert to authenticated
  with check (organization_id = (select current_org())
              and (select has_permission('consents.create'))
              and (select is_membership_active()));
create policy consents_update on consents for update to authenticated
  using (organization_id = (select current_org())
         and ((select has_permission('consents.create')) or (select has_permission('consents.sign')))
         and (select is_membership_active()))
  with check (organization_id = (select current_org())
         and ((select has_permission('consents.create')) or (select has_permission('consents.sign')))
         and (select is_membership_active()));
