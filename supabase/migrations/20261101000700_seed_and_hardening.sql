-- ConfortVets — catálogo de módulos y permisos, datos por defecto de cada
-- organización, creación de organizaciones y endurecimiento de permisos.

-- ==========================================================================
-- Módulos
-- ==========================================================================
insert into modules (key, name, description, is_core, available, sort_order) values
  ('core', 'Tutores y pacientes', 'Tutores, pacientes, usuarios y configuración.', true, true, 10),
  ('clinical', 'Historia clínica', 'Consultas, controles, exámenes y fórmulas médicas.', false, true, 20),
  ('preventive', 'Preventivo y recordatorios', 'Vacunas, desparasitación y recordatorios por WhatsApp.', false, true, 30),
  ('consents', 'Autorizaciones', 'Autorizaciones de vacuna, anestesia, procedimientos y eutanasia con firma.', false, true, 40),
  ('agenda', 'Agenda', 'Citas y lista de espera. Próximamente.', false, false, 50),
  ('inventory', 'Inventario y caja', 'Medicamentos, insumos, ventas y caja. Próximamente.', false, false, 60),
  ('hospital', 'Hospitalización y cirugía', 'Registro anestésico y monitoreo. Próximamente.', false, false, 70),
  ('portal', 'Portal del tutor', 'Carné de vacunas en línea para el tutor. Próximamente.', false, false, 80)
on conflict (key) do update
  set name = excluded.name, description = excluded.description,
      is_core = excluded.is_core, available = excluded.available,
      sort_order = excluded.sort_order;

-- ==========================================================================
-- Permisos
-- ==========================================================================
insert into permissions (key, module_key, description, sort_order) values
  ('tutors.read', 'core', 'Ver tutores', 10),
  ('tutors.write', 'core', 'Crear y editar tutores', 11),
  ('patients.read', 'core', 'Ver pacientes', 20),
  ('patients.write', 'core', 'Crear y editar pacientes y su peso', 21),
  ('files.upload', 'core', 'Subir archivos (fotos y documentos)', 30),
  ('settings.write', 'core', 'Editar configuración, marca y catálogos', 40),
  ('data.export', 'core', 'Exportar los datos de la organización', 50),
  ('clinical.read', 'clinical', 'Ver historias clínicas', 100),
  ('clinical.write', 'clinical', 'Crear y editar consultas en borrador, notas y exámenes', 101),
  ('clinical.close', 'clinical', 'Cerrar consultas', 102),
  ('clinical.void', 'clinical', 'Anular consultas', 103),
  ('prescriptions.write', 'clinical', 'Crear y editar fórmulas', 104),
  ('preventive.read', 'preventive', 'Ver vacunas, desparasitación y recordatorios', 200),
  ('preventive.write', 'preventive', 'Registrar y anular vacunas y desparasitaciones', 201),
  ('reminders.manage', 'preventive', 'Marcar recordatorios como enviados o hechos', 202),
  ('consents.read', 'consents', 'Ver autorizaciones', 300),
  ('consents.create', 'consents', 'Crear autorizaciones', 301),
  ('consents.sign', 'consents', 'Registrar firmas de autorizaciones', 302)
on conflict (key) do update
  set module_key = excluded.module_key, description = excluded.description,
      sort_order = excluded.sort_order;

-- ==========================================================================
-- Datos por defecto de una organización nueva. Cada una recibe su propia
-- copia y la edita sin afectar a las demás.
-- ==========================================================================
create or replace function seed_org_defaults(p_org uuid, p_business_name text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_dog uuid;
  v_cat uuid;
begin
  -- Especies y razas
  insert into species (organization_id, name, sort_order) values
    (p_org, 'Canino', 1), (p_org, 'Felino', 2);
  select id into v_dog from species where organization_id = p_org and name = 'Canino';
  select id into v_cat from species where organization_id = p_org and name = 'Felino';

  insert into breeds (organization_id, species_id, name)
  select p_org, v_dog, b from unnest(array[
    'Mestizo', 'Criollo', 'Labrador Retriever', 'Golden Retriever', 'Pastor Alemán',
    'Bulldog Francés', 'Bulldog Inglés', 'Poodle', 'Schnauzer', 'Chihuahua',
    'Yorkshire Terrier', 'Pug', 'Beagle', 'Rottweiler', 'Cocker Spaniel', 'Shih Tzu',
    'Pitbull', 'Husky Siberiano', 'Border Collie', 'Dálmata', 'Boxer', 'Doberman',
    'Maltés', 'Pomerania'
  ]) as b;
  insert into breeds (organization_id, species_id, name)
  select p_org, v_cat, b from unnest(array[
    'Mestizo', 'Criollo', 'Siamés', 'Persa', 'Angora', 'Maine Coon', 'Bengalí',
    'Ragdoll', 'Británico de pelo corto', 'Azul ruso', 'Sphynx'
  ]) as b;

  -- Tipos de control
  insert into control_types (organization_id, name, sort_order) values
    (p_org, 'Control de examen de laboratorio', 1),
    (p_org, 'Chequeo preventivo', 2),
    (p_org, 'Control por enfermedad', 3);

  -- Vacunas y desparasitantes (genéricos; cada veterinario los ajusta)
  insert into vaccine_catalog (organization_id, name, species_id, default_booster_days) values
    (p_org, 'Polivalente canina (moquillo, parvovirus, hepatitis, parainfluenza)', v_dog, 365),
    (p_org, 'Antirrábica', null, 365),
    (p_org, 'Leptospirosis', v_dog, 365),
    (p_org, 'Bordetella (tos de las perreras)', v_dog, 365),
    (p_org, 'Triple felina', v_cat, 365),
    (p_org, 'Leucemia felina', v_cat, 365);
  insert into deworming_products (organization_id, name, kind, default_booster_days) values
    (p_org, 'Desparasitante interno', 'interna', 90),
    (p_org, 'Desparasitante externo (pulgas y garrapatas)', 'externa', 30);

  -- Reglas y textos de recordatorio
  insert into reminder_rules (organization_id, kind, days_before) values
    (p_org, 'vacuna', 7), (p_org, 'desparasitante', 7), (p_org, 'control', 3);
  insert into message_templates (organization_id, kind, body) values
    (p_org, 'vacuna',
     'Hola {tutor}, te escribimos de {clinica}. Te recordamos que {paciente} tiene programada la vacuna {motivo} para el {fecha}. ¿Agendamos su cita?'),
    (p_org, 'desparasitante',
     'Hola {tutor}, te escribimos de {clinica}. A {paciente} le toca el refuerzo de desparasitación ({motivo}) el {fecha}. ¿Agendamos su cita?'),
    (p_org, 'control',
     'Hola {tutor}, te escribimos de {clinica}. {paciente} tiene un control pendiente ({motivo}) para el {fecha}. ¿Agendamos su cita?');

  -- Plantillas de texto para la historia clínica
  insert into text_templates (organization_id, kind, title, body) values
    (p_org, 'anamnesis', 'Anamnesis general',
     E'Tiempo de evolución:\nApetito:\nSed:\nVómito:\nDiarrea:\nMicción:\nVacunación y desparasitación:\nDieta:\nConvivencia con otros animales:'),
    (p_org, 'recommendations', 'Recomendaciones generales',
     E'Cumplir el tratamiento en las dosis y horarios indicados.\nMantener reposo y buena hidratación.\nVolver a control si hay empeoramiento o nuevos síntomas.');

  -- Medicamentos de ejemplo (sin dosis: las define el veterinario)
  insert into medications (organization_id, name, presentation) values
    (p_org, 'Suero oral', null);

  -- Autorizaciones (textos de EJEMPLO: deben ser revisados por un abogado)
  insert into consent_templates (organization_id, kind, title, body) values
    (p_org, 'vacuna', 'Autorización para vacunación',
     $t$Yo, {tutor}, identificado(a) con cédula {documento}, responsable de {paciente} ({especie}), autorizo al médico veterinario {profesional} de {clinica} para aplicar las vacunas indicadas.

Fui informado(a) de que la vacunación puede causar reacciones leves (decaimiento, fiebre, inflamación en el sitio de aplicación) y, en casos poco frecuentes, reacciones graves. Declaro que di información veraz sobre el estado de salud de mi mascota.

Fecha: {fecha}.$t$),
    (p_org, 'anestesia', 'Autorización para anestesia o sedación',
     $t$Yo, {tutor}, identificado(a) con cédula {documento}, responsable de {paciente} ({especie}), autorizo al médico veterinario {profesional} de {clinica} para realizar anestesia o sedación con el fin de practicar: {procedimiento}.

Fui informado(a) de que todo procedimiento anestésico tiene riesgos, incluidas complicaciones graves y, en casos poco frecuentes, la muerte, aun con los cuidados adecuados. Se me explicó la conveniencia de exámenes previos y las indicaciones de ayuno. Declaro que di información veraz sobre el estado de salud de mi mascota.

Fecha: {fecha}.$t$),
    (p_org, 'procedimiento', 'Autorización para procedimiento',
     $t$Yo, {tutor}, identificado(a) con cédula {documento}, responsable de {paciente} ({especie}), autorizo al médico veterinario {profesional} de {clinica} para realizar el siguiente procedimiento: {procedimiento}.

Se me explicaron el tipo de procedimiento, sus riesgos y efectos adversos posibles, las alternativas y los costos estimados. Entiendo que puedo retirar esta autorización antes de que el procedimiento se realice.

Fecha: {fecha}.$t$),
    (p_org, 'eutanasia', 'Autorización para eutanasia',
     $t$Yo, {tutor}, identificado(a) con cédula {documento}, responsable de {paciente} ({especie}), autorizo de manera libre y voluntaria al médico veterinario {profesional} de {clinica} para practicar la eutanasia.

Entiendo que el procedimiento es irreversible, que se realiza con un método humanitario e indoloro, y que se me explicaron las condiciones de salud del animal y las alternativas disponibles. Puedo retirar esta autorización antes de que se realice.

Fecha: {fecha}.$t$),
    (p_org, 'datos', 'Autorización de tratamiento de datos personales',
     $t$Yo, {tutor}, identificado(a) con cédula {documento}, autorizo a {clinica} para recolectar, almacenar y usar mis datos personales (nombre, cédula, teléfono, dirección, barrio y correo) con el fin de gestionar la atención veterinaria de mi mascota, enviarme recordatorios de vacunas, desparasitación y controles, y cumplir obligaciones legales.

Conozco mis derechos como titular: conocer, actualizar y rectificar mis datos, solicitar su supresión cuando proceda, y revocar esta autorización. Puedo ejercerlos comunicándome con {clinica}, teléfono {telefono_clinica}.

Fecha: {fecha}.$t$);

  -- Política de datos (plantilla de EJEMPLO por revisar con un abogado)
  update organization_settings
     set data_policy_text =
$p$Política de tratamiento de datos personales de {clinica}.

PLANTILLA DE EJEMPLO: debe ser revisada y ajustada por un abogado antes de usarse.

Responsable: {clinica}. Finalidad: gestionar la atención veterinaria, enviar recordatorios y cumplir obligaciones legales. Derechos del titular: conocer, actualizar, rectificar, solicitar la supresión y revocar la autorización. Contacto para ejercerlos: {telefono_clinica}.$p$
   where organization_id = p_org;
end;
$fn$;

-- ==========================================================================
-- Creación de una organización con su owner (la llama el servidor con la
-- llave de servicio, después de crear el usuario en Supabase Auth).
-- ==========================================================================
create or replace function create_organization(
  p_name text,
  p_slug text,
  p_owner_id uuid,
  p_owner_username text,
  p_owner_full_name text,
  p_owner_auth_email text,
  p_modules text[],
  p_valid_until date,
  p_max_auxiliares int,
  p_storage_quota_mb int
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid;
begin
  insert into organizations (name, slug, valid_until, max_auxiliares, storage_quota_mb)
  values (p_name, p_slug, p_valid_until, p_max_auxiliares, p_storage_quota_mb)
  returning id into v_org;

  insert into organization_settings (organization_id, business_name, professional_name)
  values (v_org, p_name, p_owner_full_name);

  insert into organization_modules (organization_id, module_key, enabled, enabled_at)
  select v_org, m.key,
         m.available and (m.is_core or m.key = any (coalesce(p_modules, '{}'))),
         now()
  from modules m;

  insert into profiles (id, organization_id, username, full_name, auth_email, role, must_change_password)
  values (p_owner_id, v_org, lower(p_owner_username), p_owner_full_name, p_owner_auth_email, 'owner', true);

  perform seed_org_defaults(v_org, p_name);
  return v_org;
end;
$fn$;

-- ==========================================================================
-- Endurecimiento: el rol anónimo no necesita acceder a nada; las funciones de
-- administración solo las ejecuta la llave de servicio.
-- ==========================================================================
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
alter default privileges in schema public revoke execute on functions from public, anon;

revoke execute on function next_counter(uuid, text) from authenticated;
revoke execute on function seed_org_defaults(uuid, text) from authenticated;
revoke execute on function create_organization(
  text, text, uuid, text, text, text, text[], date, int, int) from authenticated;
revoke execute on function _apply_tenant_rls(regclass, text, text, boolean, boolean) from authenticated;
