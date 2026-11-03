-- ConfortVets — historial preventivo (vacunas y desparasitación) y recordatorios.
-- Los registros de vacunación/desparasitación son hechos: no se editan, se
-- anulan con motivo y se vuelven a registrar. Los recordatorios los generan
-- disparadores de la base de datos.

create table vaccine_catalog (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null,
  species_id uuid,
  default_booster_days int check (default_booster_days is null or default_booster_days > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, name),
  foreign key (species_id, organization_id) references species (id, organization_id)
);
create trigger vaccine_catalog_updated_at before update on vaccine_catalog
  for each row execute function set_updated_at();

create table deworming_products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null,
  kind text not null default 'ambas' check (kind in ('interna', 'externa', 'ambas')),
  default_booster_days int check (default_booster_days is null or default_booster_days > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, name)
);
create trigger deworming_products_updated_at before update on deworming_products
  for each row execute function set_updated_at();

create table vaccinations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  patient_id uuid not null,
  vaccine_id uuid,
  vaccine_name text not null,
  applied_at date not null,
  lot text,
  expires_at date,
  next_due_at date,
  weight_kg numeric(6, 2) check (weight_kg is null or weight_kg > 0),
  temperature_c numeric(4, 1) check (temperature_c is null or temperature_c between 20 and 50),
  general_state text,
  consultation_id uuid,
  notes text,
  applied_by uuid default auth.uid(),
  applied_by_name text,
  status text not null default 'aplicada' check (status in ('aplicada', 'anulada')),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  check (next_due_at is null or next_due_at >= applied_at),
  foreign key (patient_id, organization_id) references patients (id, organization_id),
  foreign key (vaccine_id, organization_id) references vaccine_catalog (id, organization_id),
  foreign key (consultation_id, organization_id) references consultations (id, organization_id)
);
create index vaccinations_patient_idx on vaccinations (organization_id, patient_id, applied_at desc);
create trigger vaccinations_updated_at before update on vaccinations
  for each row execute function set_updated_at();

create table dewormings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  patient_id uuid not null,
  kind text not null check (kind in ('interna', 'externa')),
  product_id uuid,
  product_name text not null,
  applied_at date not null,
  lot text,
  expires_at date,
  next_due_at date,                              -- fecha de refuerzo
  weight_kg numeric(6, 2) check (weight_kg is null or weight_kg > 0),
  temperature_c numeric(4, 1) check (temperature_c is null or temperature_c between 20 and 50),
  general_state text,
  consultation_id uuid,
  notes text,
  applied_by uuid default auth.uid(),
  applied_by_name text,
  status text not null default 'aplicada' check (status in ('aplicada', 'anulada')),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  check (next_due_at is null or next_due_at >= applied_at),
  foreign key (patient_id, organization_id) references patients (id, organization_id),
  foreign key (product_id, organization_id) references deworming_products (id, organization_id),
  foreign key (consultation_id, organization_id) references consultations (id, organization_id)
);
create index dewormings_patient_idx on dewormings (organization_id, patient_id, applied_at desc);
create trigger dewormings_updated_at before update on dewormings
  for each row execute function set_updated_at();

-- Reglas y textos de recordatorio (editables por organización)
create table reminder_rules (
  organization_id uuid not null references organizations(id),
  kind text not null check (kind in ('vacuna', 'desparasitante', 'control')),
  days_before int not null default 7 check (days_before between 0 and 120),
  enabled boolean not null default true,
  primary key (organization_id, kind)
);

create table message_templates (
  organization_id uuid not null references organizations(id),
  kind text not null check (kind in ('vacuna', 'desparasitante', 'control')),
  body text not null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, kind)
);
create trigger message_templates_updated_at before update on message_templates
  for each row execute function set_updated_at();

create table reminders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  patient_id uuid not null,
  tutor_id uuid not null,
  kind text not null check (kind in ('vacuna', 'desparasitante', 'control')),
  title text not null,                           -- p. ej. "Rabia" o "Chequeo preventivo"
  due_date date not null,
  remind_from date not null,                     -- desde cuándo aparece en pendientes
  source_type text not null check (source_type in ('vaccination', 'deworming', 'consultation')),
  source_id uuid not null,
  status text not null default 'pendiente'
    check (status in ('pendiente', 'enviado', 'hecho', 'descartado')),
  sent_at timestamptz,
  sent_by uuid,
  handled_at timestamptz,
  message_sent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_type, source_id),
  foreign key (patient_id, organization_id) references patients (id, organization_id),
  foreign key (tutor_id, organization_id) references tutors (id, organization_id)
);
create index reminders_pending_idx on reminders (organization_id, status, remind_from);
create trigger reminders_updated_at before update on reminders
  for each row execute function set_updated_at();

-- ==========================================================================
-- Registros inmutables (solo se anulan)
-- ==========================================================================
create or replace function void_only_guard()
returns trigger
language plpgsql
as $$
declare
  v_keys text[] := array['status', 'voided_at', 'voided_by', 'void_reason', 'updated_at'];
begin
  if tg_op = 'DELETE' then
    raise exception 'Este registro no se borra: anúlalo con un motivo.' using errcode = 'P0001';
  end if;
  if old.status = 'anulada' then
    raise exception 'El registro está anulado y no se puede modificar.' using errcode = 'P0001';
  end if;
  if new.status <> 'anulada'
     or (to_jsonb(new) - v_keys) <> (to_jsonb(old) - v_keys) then
    raise exception 'El registro no se edita: anúlalo con un motivo y vuelve a registrarlo.'
      using errcode = 'P0001';
  end if;
  if coalesce(btrim(new.void_reason), '') = '' then
    raise exception 'Indica el motivo de la anulación.' using errcode = 'P0001';
  end if;
  new.voided_at := now();
  new.voided_by := auth.uid();
  return new;
end;
$$;
create trigger vaccinations_void_only before update or delete on vaccinations
  for each row execute function void_only_guard();
create trigger dewormings_void_only before update or delete on dewormings
  for each row execute function void_only_guard();

-- ==========================================================================
-- Generación automática de recordatorios
-- ==========================================================================
create or replace function _reminder_lead_days(p_org uuid, p_kind text)
returns int
language sql
stable
as $$
  select case when r.enabled then r.days_before else null end
  from reminder_rules r where r.organization_id = p_org and r.kind = p_kind
$$;

-- Un recordatorio por vacuna aplicada con próxima fecha. Al aplicar de nuevo
-- la misma vacuna, el recordatorio anterior queda como "hecho".
create or replace function trg_vaccination_reminder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tutor uuid;
  v_lead int;
begin
  if tg_op = 'INSERT' and new.status = 'aplicada' then
    update reminders set status = 'hecho', handled_at = now()
      where organization_id = new.organization_id
        and patient_id = new.patient_id
        and kind = 'vacuna'
        and lower(title) = lower(new.vaccine_name)
        and status in ('pendiente', 'enviado');

    if new.next_due_at is not null then
      v_lead := _reminder_lead_days(new.organization_id, 'vacuna');
      if v_lead is not null then
        select tutor_id into v_tutor from patients
          where id = new.patient_id and organization_id = new.organization_id;
        insert into reminders (organization_id, patient_id, tutor_id, kind, title,
                               due_date, remind_from, source_type, source_id)
        values (new.organization_id, new.patient_id, v_tutor, 'vacuna', new.vaccine_name,
                new.next_due_at, new.next_due_at - v_lead, 'vaccination', new.id);
      end if;
    end if;
  elsif tg_op = 'UPDATE' and old.status = 'aplicada' and new.status = 'anulada' then
    update reminders set status = 'descartado', handled_at = now()
      where source_type = 'vaccination' and source_id = new.id
        and status in ('pendiente', 'enviado');
  end if;
  return new;
end;
$$;
create trigger vaccinations_reminder after insert or update on vaccinations
  for each row execute function trg_vaccination_reminder();

create or replace function trg_deworming_reminder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tutor uuid;
  v_lead int;
  v_title text;
begin
  v_title := 'Desparasitación ' || new.kind;
  if tg_op = 'INSERT' and new.status = 'aplicada' then
    update reminders set status = 'hecho', handled_at = now()
      where organization_id = new.organization_id
        and patient_id = new.patient_id
        and kind = 'desparasitante'
        and lower(title) = lower(v_title)
        and status in ('pendiente', 'enviado');

    if new.next_due_at is not null then
      v_lead := _reminder_lead_days(new.organization_id, 'desparasitante');
      if v_lead is not null then
        select tutor_id into v_tutor from patients
          where id = new.patient_id and organization_id = new.organization_id;
        insert into reminders (organization_id, patient_id, tutor_id, kind, title,
                               due_date, remind_from, source_type, source_id)
        values (new.organization_id, new.patient_id, v_tutor, 'desparasitante', v_title,
                new.next_due_at, new.next_due_at - v_lead, 'deworming', new.id);
      end if;
    end if;
  elsif tg_op = 'UPDATE' and old.status = 'aplicada' and new.status = 'anulada' then
    update reminders set status = 'descartado', handled_at = now()
      where source_type = 'deworming' and source_id = new.id
        and status in ('pendiente', 'enviado');
  end if;
  return new;
end;
$$;
create trigger dewormings_reminder after insert or update on dewormings
  for each row execute function trg_deworming_reminder();

-- Un recordatorio de control cuando se cierra una consulta con próxima fecha.
create or replace function trg_consultation_reminder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tutor uuid;
  v_lead int;
  v_title text;
begin
  if new.status = 'cerrada' and (tg_op = 'INSERT' or old.status <> 'cerrada')
     and new.next_control_date is not null then
    v_lead := _reminder_lead_days(new.organization_id, 'control');
    if v_lead is not null then
      select tutor_id into v_tutor from patients
        where id = new.patient_id and organization_id = new.organization_id;
      select coalesce(ct.name, 'Control') into v_title
        from (select 1) x
        left join control_types ct
          on ct.id = new.control_type_id and ct.organization_id = new.organization_id;
      insert into reminders (organization_id, patient_id, tutor_id, kind, title,
                             due_date, remind_from, source_type, source_id)
      values (new.organization_id, new.patient_id, v_tutor, 'control', v_title,
              new.next_control_date, new.next_control_date - v_lead, 'consultation', new.id)
      on conflict (source_type, source_id) do nothing;
    end if;
  elsif tg_op = 'UPDATE' and new.status = 'anulada' and old.status <> 'anulada' then
    update reminders set status = 'descartado', handled_at = now()
      where source_type = 'consultation' and source_id = new.id
        and status in ('pendiente', 'enviado');
  end if;
  return new;
end;
$$;
create trigger consultations_reminder after insert or update on consultations
  for each row execute function trg_consultation_reminder();

-- Los usuarios solo pueden cambiar el estado de un recordatorio.
create or replace function reminders_guard()
returns trigger
language plpgsql
as $$
declare
  v_keys text[] := array['status', 'sent_at', 'sent_by', 'handled_at', 'message_sent', 'updated_at'];
begin
  if tg_op = 'DELETE' then
    raise exception 'Los recordatorios no se borran: márcalos como descartados.' using errcode = 'P0001';
  end if;
  if (to_jsonb(new) - v_keys) <> (to_jsonb(old) - v_keys) then
    raise exception 'Solo se puede cambiar el estado del recordatorio.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger reminders_guard before update or delete on reminders
  for each row execute function reminders_guard();

-- ==========================================================================
-- RLS
-- ==========================================================================
select _apply_tenant_rls('vaccine_catalog', 'member', 'settings.write');
select _apply_tenant_rls('deworming_products', 'member', 'settings.write');
select _apply_tenant_rls('vaccinations', 'preventive.read', 'preventive.write');
select _apply_tenant_rls('dewormings', 'preventive.read', 'preventive.write');

-- reminder_rules y message_templates tienen clave (organization_id, kind):
-- mismas políticas, escritura con settings.write.
select _apply_tenant_rls('reminder_rules', 'member', 'settings.write');
select _apply_tenant_rls('message_templates', 'member', 'settings.write');

-- reminders: las crean los disparadores; los usuarios leen y cambian estado.
alter table reminders enable row level security;
create policy reminders_select on reminders for select to authenticated
  using (organization_id = (select current_org()) and (select has_permission('preventive.read')));
create policy reminders_update on reminders for update to authenticated
  using (organization_id = (select current_org())
         and (select has_permission('reminders.manage'))
         and (select is_membership_active()))
  with check (organization_id = (select current_org())
         and (select has_permission('reminders.manage'))
         and (select is_membership_active()));
