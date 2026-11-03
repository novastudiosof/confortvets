/**
 * Catálogo de permisos. Es un ESPEJO de la tabla `permissions` y de las
 * funciones has_module()/has_permission() de la base de datos, que son la
 * autoridad (RLS). Aquí solo se usa para ocultar menús y botones.
 */
export interface PermissionDef {
  key: string;
  module: string;
  label: string;
}

export const PERMISSIONS: PermissionDef[] = [
  { key: "tutors.read", module: "core", label: "Ver tutores" },
  { key: "tutors.write", module: "core", label: "Crear y editar tutores" },
  { key: "patients.read", module: "core", label: "Ver pacientes" },
  { key: "patients.write", module: "core", label: "Crear y editar pacientes y su peso" },
  { key: "files.upload", module: "core", label: "Subir archivos (fotos y documentos)" },
  { key: "settings.write", module: "core", label: "Editar configuración, marca y catálogos" },
  { key: "data.export", module: "core", label: "Exportar los datos de la organización" },
  { key: "clinical.read", module: "clinical", label: "Ver historias clínicas" },
  { key: "clinical.write", module: "clinical", label: "Crear y editar consultas en borrador, notas y exámenes" },
  { key: "clinical.close", module: "clinical", label: "Cerrar consultas" },
  { key: "clinical.void", module: "clinical", label: "Anular consultas" },
  { key: "prescriptions.write", module: "clinical", label: "Crear y editar fórmulas" },
  { key: "preventive.read", module: "preventive", label: "Ver vacunas, desparasitación y recordatorios" },
  { key: "preventive.write", module: "preventive", label: "Registrar y anular vacunas y desparasitaciones" },
  { key: "reminders.manage", module: "preventive", label: "Marcar recordatorios como enviados o hechos" },
  { key: "consents.read", module: "consents", label: "Ver autorizaciones" },
  { key: "consents.create", module: "consents", label: "Crear autorizaciones" },
  { key: "consents.sign", module: "consents", label: "Registrar firmas de autorizaciones" },
  { key: "agenda.read", module: "agenda", label: "Ver la agenda y las citas" },
  { key: "agenda.write", module: "agenda", label: "Crear, mover y cancelar citas y la lista de espera" },
];

export const MODULE_LABELS: Record<string, string> = {
  core: "Tutores y pacientes",
  clinical: "Historia clínica",
  preventive: "Preventivo y recordatorios",
  consents: "Autorizaciones",
  agenda: "Agenda",
  inventory: "Inventario y caja",
  hospital: "Hospitalización y cirugía",
  portal: "Portal del tutor",
};

export interface EffectivePermissionInput {
  role: "super_admin" | "owner" | "auxiliar";
  /** Módulos habilitados para la organización (incluye los núcleo). */
  enabledModules: Set<string>;
  /** Permisos asignados al auxiliar. */
  grants: Set<string>;
  /** Permisos restringidos por el super admin para la organización. */
  restricted: Set<string>;
}

/** Misma regla que has_permission() en la base de datos. */
export function effectivePermissions(input: EffectivePermissionInput): Set<string> {
  const out = new Set<string>();
  if (input.role === "super_admin") return out;
  for (const p of PERMISSIONS) {
    if (!input.enabledModules.has(p.module)) continue;
    if (input.restricted.has(p.key)) continue;
    if (input.role === "owner" || input.grants.has(p.key)) out.add(p.key);
  }
  return out;
}

/** Permisos agrupados por módulo, solo los de módulos habilitados. */
export function permissionsByModule(
  enabledModules: Set<string>,
  restricted: Set<string> = new Set()
): { module: string; items: PermissionDef[] }[] {
  const groups = new Map<string, PermissionDef[]>();
  for (const p of PERMISSIONS) {
    if (!enabledModules.has(p.module) || restricted.has(p.key)) continue;
    if (!groups.has(p.module)) groups.set(p.module, []);
    groups.get(p.module)!.push(p);
  }
  return [...groups.entries()].map(([module, items]) => ({ module, items }));
}
