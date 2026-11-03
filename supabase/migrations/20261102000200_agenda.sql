-- ConfortVets — módulo Agenda: citas, horario de atención, bloqueos, tipos de
-- cita y lista de espera.
-- Las citas no se borran: se cancelan, se marcan como no asistió o se atienden.
-- Los horarios se guardan como hora local del consultorio (organization_settings
-- .timezone); las citas, como instante (timestamptz).

-- ==========================================================================
-- Módulo y permisos
-- ==========================================================================
update modules
   set available = true,
       description = 'Citas, horario de atención, bloqueos, lista de espera y recordatorios de cita por WhatsApp.'
 where key = 'agenda';

insert into permissions (key, module_key, description, sort_order) values
  ('agenda.read', 'agenda', 'Ver la agenda y las citas', 400),
  ('agenda.write', 'agenda', 'Crear, mover y cancelar citas y la lista de espera', 401)
on conflict (key) do update
  set module_key = excluded.module_key, description = excluded.description,
      sort_order = excluded.sort_order;

-- ==========================================================================
-- Parámetros, horario y bloqueos
-- ==========================================================================
create table agenda_settings (
  organization_id uuid primary key references organizations(id),
  slot_minutes int not null default 30 check (slot_minutes between 5 and 240),
  allow_overlap boolean not null default false,     -- permitir citas al mismo tiempo
  reminder_template text not null,
  updated_at timestamptz not null default now()
);
create trigger agenda_settings_updated_at before update on agenda_settings
  for each row execute function set_updated_at();

-- Franjas de atención por día (varias por día: mañana y tarde). 0 = domingo.
create table agenda_hours (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  weekday int not null check (weekday between 0 and 6),
  starts_at time not null,
  ends_at time not null,
  check (ends_at > starts_at),
  unique (organization_id, weekday, starts_at)
);
create index agenda_hours_idx on agenda_hours (organization_id, weekday);

-- Tiempo no disponible: festivos, vacaciones, una cirugía larga...
create table agenda_blocks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index agenda_blocks_idx on agenda_blocks (organization_id, starts_at);

create table appointment_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null,
  duration_minutes int not null default 30 check (duration_minutes between 5 and 600),
  color text,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, name)
);
create trigger appointment_types_updated_at before update on appointment_types
  for each row execute function set_updated_at();

-- ==========================================================================
-- Citas
-- ==========================================================================
create table appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  patient_id uuid not null,
  tutor_id uuid not null,                          -- lo fija el disparador desde el paciente
  type_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'programada'
    check (status in ('programada', 'confirmada', 'en_sala', 'atendida', 'cancelada', 'no_asistio')),
  reason text,
  notes text,
  consultation_id uuid,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  reminder_sent_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (patient_id, organization_id) references patients (id, organization_id),
  foreign key (tutor_id, organization_id) references tutors (id, organization_id),
  foreign key (type_id, organization_id) references appointment_types (id, organization_id),
  foreign key (consultation_id, organization_id) references consultations (id, organization_id)
);
create index appointments_time_idx on appointments (organization_id, starts_at);
create index appointments_patient_idx on appointments (organization_id, patient_id, starts_at desc);
create trigger appointments_updated_at before update on appointments
  for each row execute function set_updated_at();

create or replace function appointments_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active text[] := array['programada', 'confirmada', 'en_sala'];
  v_tutor uuid;
  v_allow boolean;
  v_block text;
begin
  if tg_op = 'INSERT' then
    if new.status not in ('programada', 'confirmada') then
      raise exception 'Una cita nueva empieza programada o confirmada.' using errcode = 'P0001';
    end if;
  else
    if new.organization_id <> old.organization_id or new.patient_id <> old.patient_id then
      raise exception 'No se puede cambiar el paciente de una cita: cancélala y crea otra.' using errcode = 'P0001';
    end if;
    if old.status in ('atendida', 'cancelada', 'no_asistio') then
      raise exception 'La cita ya está cerrada (%): no se puede modificar.', old.status using errcode = 'P0001';
    end if;
    if new.status <> old.status and not (
         (old.status = 'programada' and new.status in ('confirmada', 'en_sala', 'atendida', 'cancelada', 'no_asistio'))
      or (old.status = 'confirmada' and new.status in ('programada', 'en_sala', 'atendida', 'cancelada', 'no_asistio'))
      or (old.status = 'en_sala' and new.status in ('atendida', 'cancelada', 'no_asistio'))
    ) then
      raise exception 'Ese cambio de estado no es válido.' using errcode = 'P0001';
    end if;
  end if;

  if new.ends_at <= new.starts_at then
    raise exception 'La cita debe terminar después de empezar.' using errcode = 'P0001';
  end if;
  if new.ends_at - new.starts_at > interval '12 hours' then
    raise exception 'Una cita no puede durar más de 12 horas.' using errcode = 'P0001';
  end if;

  select tutor_id into v_tutor from patients
    where id = new.patient_id and organization_id = new.organization_id;
  if v_tutor is null then
    raise exception 'No se encontró el paciente.' using errcode = 'P0001';
  end if;
  new.tutor_id := v_tutor;

  if new.status = 'confirmada' and (tg_op = 'INSERT' or old.status <> 'confirmada') then
    new.confirmed_at := now();
  end if;
  if new.status = 'cancelada' and (tg_op = 'INSERT' or old.status <> 'cancelada') then
    new.cancelled_at := now();
  end if;

  -- Cruces: solo al crear o al mover la cita.
  if new.status = any (v_active)
     and (tg_op = 'INSERT' or new.starts_at <> old.starts_at or new.ends_at <> old.ends_at) then
    select allow_overlap into v_allow from agenda_settings where organization_id = new.organization_id;
    if not coalesce(v_allow, false) and exists (
      select 1 from appointments a
      where a.organization_id = new.organization_id and a.id <> new.id
        and a.status = any (v_active)
        and a.starts_at < new.ends_at and a.ends_at > new.starts_at
    ) then
      raise exception 'Ya hay una cita en ese horario.' using errcode = 'P0001';
    end if;

    select b.reason into v_block from agenda_blocks b
      where b.organization_id = new.organization_id
        and b.starts_at < new.ends_at and b.ends_at > new.starts_at
      limit 1;
    if v_block is not null then
      raise exception 'Ese horario está bloqueado: %.', v_block using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
create trigger appointments_guard before insert or update on appointments
  for each row execute function appointments_guard();

create or replace function appointments_no_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Las citas no se borran: cancélalas con un motivo.' using errcode = 'P0001';
end;
$$;
create trigger appointments_no_delete before delete on appointments
  for each row execute function appointments_no_delete();

-- ==========================================================================
-- Lista de espera
-- ==========================================================================
create table agenda_waitlist (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  patient_id uuid not null,
  tutor_id uuid not null,
  type_id uuid,
  notes text,
  status text not null default 'esperando' check (status in ('esperando', 'agendada', 'descartada')),
  appointment_id uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (patient_id, organization_id) references patients (id, organization_id),
  foreign key (tutor_id, organization_id) references tutors (id, organization_id),
  foreign key (type_id, organization_id) references appointment_types (id, organization_id),
  foreign key (appointment_id, organization_id) references appointments (id, organization_id)
);
create index agenda_waitlist_idx on agenda_waitlist (organization_id, status, created_at);
create trigger agenda_waitlist_updated_at before update on agenda_waitlist
  for each row execute function set_updated_at();

create or replace function agenda_waitlist_set_tutor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select tutor_id into new.tutor_id from patients
    where id = new.patient_id and organization_id = new.organization_id;
  if new.tutor_id is null then
    raise exception 'No se encontró el paciente.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger agenda_waitlist_tutor before insert on agenda_waitlist
  for each row execute function agenda_waitlist_set_tutor();

-- ==========================================================================
-- RLS: leer con agenda.read; las citas y la espera se escriben con
-- agenda.write; horario, bloqueos y tipos son configuración (settings.write).
-- ==========================================================================
select _apply_tenant_rls('agenda_settings', 'agenda.read', 'settings.write');
select _apply_tenant_rls('agenda_hours', 'agenda.read', 'settings.write', true, true);
select _apply_tenant_rls('agenda_blocks', 'agenda.read', 'settings.write', true, true);
select _apply_tenant_rls('appointment_types', 'agenda.read', 'settings.write');
select _apply_tenant_rls('appointments', 'agenda.read', 'agenda.write');
select _apply_tenant_rls('agenda_waitlist', 'agenda.read', 'agenda.write');

-- ==========================================================================
-- Datos por defecto de la agenda (cada organización recibe su propia copia)
-- ==========================================================================
create or replace function seed_agenda_defaults(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into agenda_settings (organization_id, reminder_template) values (
    p_org,
    'Hola {tutor}, te escribimos de {clinica}. Te recordamos la cita de {paciente} el {fecha} a las {hora}. Si no puedes asistir, avísanos para reprogramarla.'
  ) on conflict (organization_id) do nothing;

  if not exists (select 1 from agenda_hours where organization_id = p_org) then
    insert into agenda_hours (organization_id, weekday, starts_at, ends_at)
    select p_org, d, t.s, t.e
    from generate_series(1, 5) d,
         (values ('08:00'::time, '12:00'::time), ('14:00'::time, '18:00'::time)) as t(s, e);
    insert into agenda_hours (organization_id, weekday, starts_at, ends_at)
    values (p_org, 6, '08:00', '12:00');
  end if;

  insert into appointment_types (organization_id, name, duration_minutes, color, sort_order) values
    (p_org, 'Consulta general', 30, '#3B82F6', 1),
    (p_org, 'Vacunación', 15, '#10B981', 2),
    (p_org, 'Control', 20, '#8B5CF6', 3),
    (p_org, 'Procedimiento o cirugía', 60, '#F59E0B', 4)
  on conflict (organization_id, name) do nothing;
end;
$$;

create or replace function trg_org_agenda_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform seed_agenda_defaults(new.id);
  return new;
end;
$$;
create trigger organizations_agenda_defaults after insert on organizations
  for each row execute function trg_org_agenda_defaults();

-- Organizaciones que ya existen
select seed_agenda_defaults(id) from organizations;

revoke execute on function seed_agenda_defaults(uuid) from public, anon, authenticated;
revoke execute on function trg_org_agenda_defaults() from public, anon, authenticated;
