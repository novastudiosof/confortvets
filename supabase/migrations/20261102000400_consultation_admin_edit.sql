-- ConfortVets — el administrador puede corregir una historia ya cerrada.
-- Una consulta cerrada sigue siendo inmutable para todos, salvo para el
-- administrador (owner) mediante consultation_admin_edit(): exige un motivo,
-- guarda una copia de la versión anterior (append-only) y deja constancia de
-- quién y cuándo editó. Solo cambia el contenido clínico; el paciente, la
-- fecha, el profesional y el estado no se tocan.

alter table consultations
  add column edit_count int not null default 0,
  add column last_edited_at timestamptz,
  add column last_edited_by uuid;

create table consultation_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  consultation_id uuid not null,
  revision int not null,
  snapshot jsonb not null,                       -- la consulta tal como estaba antes de editar
  reason text not null check (btrim(reason) <> ''),
  edited_by uuid default auth.uid(),
  edited_by_name text,
  edited_at timestamptz not null default now(),
  unique (consultation_id, revision),
  foreign key (consultation_id, organization_id) references consultations (id, organization_id)
);
create index consultation_revisions_idx on consultation_revisions (organization_id, consultation_id, revision);
create trigger consultation_revisions_immutable before update or delete on consultation_revisions
  for each row execute function block_mutation();

alter table consultation_revisions enable row level security;
create policy consultation_revisions_select on consultation_revisions for select to authenticated
  using (organization_id = (select current_org()) and (select has_permission('clinical.read')));

-- Guarda de consultas: igual que antes, más el paso del administrador.
create or replace function consultations_guard()
returns trigger
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_void_keys text[] := array['status', 'voided_at', 'voided_by', 'void_reason', 'updated_at'];
  v_edit_keys text[] := array[
    'reason', 'anamnesis', 'weight_kg', 'temperature_c', 'heart_rate', 'resp_rate', 'mucous_membranes',
    'capillary_refill_s', 'hydration', 'body_condition', 'differential_diagnoses', 'exams_notes',
    'definitive_diagnosis', 'treatment', 'recommendations', 'control_type_id', 'next_control_date',
    'custom_fields', 'edit_count', 'last_edited_at', 'last_edited_by', 'updated_at'
  ];
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
    -- Edición del administrador (solo la hace consultation_admin_edit).
    if new.status = 'cerrada' and current_setting('app.consultation_admin_edit', true) = '1' then
      if (to_jsonb(new) - v_edit_keys) <> (to_jsonb(old) - v_edit_keys) then
        raise exception 'La edición del administrador solo cambia el contenido clínico.' using errcode = 'P0001';
      end if;
      return new;
    end if;
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

-- Los recordatorios solo cambian de estado, salvo cuando la edición del
-- administrador mueve la fecha del próximo control (marca dentro de su función).
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
  if current_setting('app.reminder_sync', true) = '1' then
    return new;
  end if;
  if (to_jsonb(new) - v_keys) <> (to_jsonb(old) - v_keys) then
    raise exception 'Solo se puede cambiar el estado del recordatorio.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- Edita una consulta cerrada (solo el administrador, con motivo).
create or replace function consultation_admin_edit(p_consultation uuid, p_changes jsonb, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := current_org();
  v_c consultations%rowtype;
  v_new consultations%rowtype;
  v_rev int;
  v_key text;
  v_lead int;
  v_title text;
  v_n int;
  v_allowed text[] := array[
    'reason', 'anamnesis', 'weight_kg', 'temperature_c', 'heart_rate', 'resp_rate', 'mucous_membranes',
    'capillary_refill_s', 'hydration', 'body_condition', 'differential_diagnoses', 'exams_notes',
    'definitive_diagnosis', 'treatment', 'recommendations', 'control_type_id', 'next_control_date',
    'custom_fields'
  ];
begin
  if v_org is null or not is_owner() then
    raise exception 'Solo el administrador puede editar una historia cerrada.' using errcode = '42501';
  end if;
  if not is_membership_active() then
    raise exception 'Tu membresía venció: solo puedes consultar.' using errcode = '42501';
  end if;
  if coalesce(length(btrim(p_reason)), 0) < 5 then
    raise exception 'Escribe el motivo de la corrección (mínimo 5 caracteres).' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_changes) is distinct from 'object' then
    raise exception 'No hay cambios para guardar.' using errcode = 'P0001';
  end if;
  for v_key in select jsonb_object_keys(p_changes) loop
    if not (v_key = any (v_allowed)) then
      raise exception 'El campo % no se puede editar.', v_key using errcode = 'P0001';
    end if;
  end loop;

  select * into v_c from consultations where id = p_consultation and organization_id = v_org for update;
  if not found then
    raise exception 'Consulta no encontrada.' using errcode = 'P0001';
  end if;
  if v_c.status <> 'cerrada' then
    raise exception 'Solo se editan historias cerradas (un borrador se edita normalmente).' using errcode = 'P0001';
  end if;

  v_new := jsonb_populate_record(v_c, p_changes);
  v_rev := v_c.edit_count + 1;

  insert into consultation_revisions (organization_id, consultation_id, revision, snapshot, reason, edited_by_name)
  values (v_org, p_consultation, v_rev, to_jsonb(v_c), btrim(p_reason),
          (select full_name from profiles where id = auth.uid()));

  perform set_config('app.consultation_admin_edit', '1', true);
  update consultations set
    reason = v_new.reason, anamnesis = v_new.anamnesis, weight_kg = v_new.weight_kg,
    temperature_c = v_new.temperature_c, heart_rate = v_new.heart_rate, resp_rate = v_new.resp_rate,
    mucous_membranes = v_new.mucous_membranes, capillary_refill_s = v_new.capillary_refill_s,
    hydration = v_new.hydration, body_condition = v_new.body_condition,
    differential_diagnoses = v_new.differential_diagnoses, exams_notes = v_new.exams_notes,
    definitive_diagnosis = v_new.definitive_diagnosis, treatment = v_new.treatment,
    recommendations = v_new.recommendations, control_type_id = v_new.control_type_id,
    next_control_date = v_new.next_control_date, custom_fields = v_new.custom_fields,
    edit_count = v_rev, last_edited_at = now(), last_edited_by = auth.uid()
  where id = p_consultation;
  perform set_config('app.consultation_admin_edit', '0', true);

  -- Si cambió la fecha del próximo control, el recordatorio la sigue.
  if v_new.next_control_date is distinct from v_c.next_control_date then
    if v_new.next_control_date is null then
      update reminders set status = 'descartado', handled_at = now()
        where source_type = 'consultation' and source_id = p_consultation and status in ('pendiente', 'enviado');
    else
      v_lead := _reminder_lead_days(v_org, 'control');
      if v_lead is not null then
        select coalesce(ct.name, 'Control') into v_title
          from (select 1) x
          left join control_types ct on ct.id = v_new.control_type_id and ct.organization_id = v_org;
        perform set_config('app.reminder_sync', '1', true);
        update reminders
           set due_date = v_new.next_control_date, remind_from = v_new.next_control_date - v_lead,
               title = v_title, status = 'pendiente', sent_at = null
         where source_type = 'consultation' and source_id = p_consultation and status in ('pendiente', 'enviado');
        get diagnostics v_n = row_count;
        perform set_config('app.reminder_sync', '0', true);
        if v_n = 0 and not exists (
          select 1 from reminders where source_type = 'consultation' and source_id = p_consultation
        ) then
          insert into reminders (organization_id, patient_id, tutor_id, kind, title,
                                 due_date, remind_from, source_type, source_id)
          select v_org, v_c.patient_id, p.tutor_id, 'control', v_title,
                 v_new.next_control_date, v_new.next_control_date - v_lead, 'consultation', p_consultation
          from patients p where p.id = v_c.patient_id and p.organization_id = v_org;
        end if;
      end if;
    end if;
  end if;
end;
$$;
