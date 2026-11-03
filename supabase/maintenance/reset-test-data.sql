-- ConfortVets — limpia los DATOS de prueba y conserva la CONFIGURACIÓN.
-- No es una migración: se ejecuta a mano, una sola vez, en el SQL Editor.
--
-- SE BORRA (datos):
--   tutores, pacientes, pesos, consultas, notas, correcciones, exámenes,
--   fórmulas, vacunas, desparasitaciones, recordatorios, autorizaciones
--   firmadas, citas y lista de espera, inventario, compras, ventas, pagos y
--   cajas, bitácora, intentos de ingreso, consecutivos y archivos (fotos,
--   PDF, firmas).
-- SE CONSERVA (configuración):
--   organizaciones, sus usuarios y módulos, marca y logo, especies y razas,
--   tipos de control, vacunas y desparasitantes del catálogo, medicamentos,
--   plantillas de texto y de autorizaciones, reglas y mensajes de
--   recordatorio, campos personalizados, horario, tipos de cita, ajustes de
--   agenda e inventario, y el catálogo de módulos y permisos.
--
-- Funciona aunque falten tablas de módulos que aún no se han instalado.

do $$
declare
  data_tables text[] := array[
    'tutors', 'patients', 'patient_weights',
    'consultations', 'consultation_addenda', 'consultation_revisions', 'exam_files',
    'prescriptions', 'prescription_items',
    'vaccinations', 'dewormings', 'reminders',
    'consents',
    'appointments', 'agenda_waitlist',
    'products', 'suppliers', 'stock_lots', 'stock_movements', 'purchases', 'purchase_items',
    'sales', 'sale_items', 'payments', 'cash_sessions', 'cash_movements',
    'activity_log', 'login_attempts', 'org_counters'
  ];
  existing text;
begin
  select string_agg(x, ', ') into existing
    from unnest(data_tables) x
   where to_regclass('public.' || x) is not null;

  -- TRUNCATE no activa los bloqueos de "no se borra" de las tablas inmutables.
  execute 'truncate table ' || existing || ' restart identity cascade';

  -- Archivos: se conserva solo el logo (es parte de la marca).
  delete from files where kind <> 'logo';

  -- La numeración de documentos vuelve a empezar.
  if to_regclass('public.document_series') is not null then
    execute 'update document_series set next_number = 1';
  end if;
end $$;

-- Resumen de lo que quedó (todo en 0 salvo la configuración).
select 'tutors' as tabla, count(*) as filas from tutors
union all select 'patients', count(*) from patients
union all select 'consultations', count(*) from consultations
union all select 'vaccinations', count(*) from vaccinations
union all select 'consents', count(*) from consents
union all select 'files (solo logo)', count(*) from files
union all select 'activity_log', count(*) from activity_log
union all select '— configuración —', null
union all select 'organizations', count(*) from organizations
union all select 'profiles', count(*) from profiles
union all select 'species', count(*) from species
union all select 'consent_templates', count(*) from consent_templates
union all select 'agenda_hours', count(*) from agenda_hours;
