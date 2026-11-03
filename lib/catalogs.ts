/**
 * Definición de los catálogos que cada veterinario edita desde Configuración.
 * Es una LISTA BLANCA: las acciones genéricas solo operan sobre estas tablas
 * y estas columnas.
 */
export type CatalogFieldType = "text" | "textarea" | "number" | "select" | "checkbox" | "lines";

export interface CatalogField {
  name: string;
  label: string;
  type: CatalogFieldType;
  required?: boolean;
  hint?: string;
  /** Opciones fijas (select). */
  options?: { value: string; label: string }[];
  /** Las opciones vienen de otra tabla del catálogo (select). */
  optionsFrom?: "species";
  /** No se puede cambiar después de crear. */
  immutable?: boolean;
  /** Mostrar en la tabla. */
  list?: boolean;
  /** Valor por defecto al crear. */
  defaultValue?: string;
}

export interface CatalogDef {
  key: string;
  table: string;
  title: string;
  description: string;
  fields: CatalogField[];
  hasActive: boolean;
  orderBy: string;
  /** Al editar, sube el número de versión (autorizaciones). */
  bumpVersion?: boolean;
}

const KIND_CONSENT = [
  { value: "vacuna", label: "Vacuna" },
  { value: "anestesia", label: "Anestesia o sedación" },
  { value: "procedimiento", label: "Procedimiento" },
  { value: "eutanasia", label: "Eutanasia" },
  { value: "datos", label: "Tratamiento de datos" },
  { value: "otro", label: "Otra" },
];

export const CATALOGS: Record<string, CatalogDef> = {
  species: {
    key: "species",
    table: "species",
    title: "Especies",
    description: "Las especies que atiendes. Puedes agregar otras (conejos, aves, reptiles...).",
    hasActive: true,
    orderBy: "sort_order",
    fields: [{ name: "name", label: "Nombre", type: "text", required: true, list: true }],
  },
  breeds: {
    key: "breeds",
    table: "breeds",
    title: "Razas",
    description: "Razas para elegir al crear un paciente. También se puede escribir una raza a mano.",
    hasActive: true,
    orderBy: "name",
    fields: [
      { name: "species_id", label: "Especie", type: "select", optionsFrom: "species", required: true, list: true },
      { name: "name", label: "Nombre", type: "text", required: true, list: true },
    ],
  },
  control_types: {
    key: "control_types",
    table: "control_types",
    title: "Tipos de control",
    description: "Para clasificar los controles y sus recordatorios.",
    hasActive: true,
    orderBy: "sort_order",
    fields: [{ name: "name", label: "Nombre", type: "text", required: true, list: true }],
  },
  vaccine_catalog: {
    key: "vaccine_catalog",
    table: "vaccine_catalog",
    title: "Vacunas",
    description: "Vacunas que aplicas. Con los días de refuerzo, la próxima fecha se sugiere sola.",
    hasActive: true,
    orderBy: "name",
    fields: [
      { name: "name", label: "Nombre", type: "text", required: true, list: true },
      { name: "species_id", label: "Especie", type: "select", optionsFrom: "species", list: true, hint: "Déjala vacía si sirve para todas." },
      { name: "default_booster_days", label: "Días para el refuerzo", type: "number", list: true, hint: "Por ejemplo 365 para un refuerzo anual." },
    ],
  },
  deworming_products: {
    key: "deworming_products",
    table: "deworming_products",
    title: "Desparasitantes",
    description: "Productos de desparasitación interna y externa.",
    hasActive: true,
    orderBy: "name",
    fields: [
      { name: "name", label: "Nombre", type: "text", required: true, list: true },
      {
        name: "kind",
        label: "Tipo",
        type: "select",
        required: true,
        list: true,
        defaultValue: "ambas",
        options: [
          { value: "interna", label: "Interna" },
          { value: "externa", label: "Externa" },
          { value: "ambas", label: "Interna y externa" },
        ],
      },
      { name: "default_booster_days", label: "Días para el refuerzo", type: "number", list: true },
    ],
  },
  medications: {
    key: "medications",
    table: "medications",
    title: "Medicamentos",
    description: "Para completar rápido las fórmulas. En la fórmula también se puede escribir otro medicamento.",
    hasActive: true,
    orderBy: "name",
    fields: [
      { name: "name", label: "Nombre", type: "text", required: true, list: true },
      { name: "presentation", label: "Presentación", type: "text", list: true },
      { name: "default_dose", label: "Dosis habitual", type: "text" },
      { name: "default_frequency", label: "Frecuencia habitual", type: "text" },
      { name: "default_duration", label: "Duración habitual", type: "text" },
      { name: "route", label: "Vía", type: "text" },
    ],
  },
  text_templates: {
    key: "text_templates",
    table: "text_templates",
    title: "Plantillas de texto",
    description: "Frases y formatos que insertas con un clic en la historia clínica.",
    hasActive: true,
    orderBy: "title",
    fields: [
      {
        name: "kind",
        label: "Se usa en",
        type: "select",
        required: true,
        list: true,
        options: [
          { value: "anamnesis", label: "Anamnesis" },
          { value: "diagnosis", label: "Diagnósticos" },
          { value: "treatment", label: "Tratamiento" },
          { value: "recommendations", label: "Recomendaciones" },
          { value: "exam", label: "Exámenes" },
        ],
      },
      { name: "title", label: "Título", type: "text", required: true, list: true },
      { name: "body", label: "Texto", type: "textarea", required: true },
    ],
  },
  consent_templates: {
    key: "consent_templates",
    table: "consent_templates",
    title: "Textos de autorizaciones",
    description:
      "Plantillas de las autorizaciones. Variables: {tutor} {documento} {paciente} {especie} {clinica} {profesional} {procedimiento} {fecha} {telefono_clinica}. Los textos de ejemplo deben ser revisados por un abogado antes de usarse con clientes.",
    hasActive: true,
    orderBy: "kind",
    bumpVersion: true,
    fields: [
      { name: "kind", label: "Tipo", type: "select", required: true, list: true, options: KIND_CONSENT },
      { name: "title", label: "Título", type: "text", required: true, list: true },
      { name: "body", label: "Texto", type: "textarea", required: true },
    ],
  },
  appointment_types: {
    key: "appointment_types",
    table: "appointment_types",
    title: "Tipos de cita",
    description: "Los motivos de cita que ofreces, con su duración y color en la agenda.",
    hasActive: true,
    orderBy: "sort_order",
    fields: [
      { name: "name", label: "Nombre", type: "text", required: true, list: true },
      { name: "duration_minutes", label: "Duración (minutos)", type: "number", required: true, list: true, defaultValue: "30" },
      { name: "color", label: "Color", type: "text", list: true, hint: "Formato #RRGGBB, por ejemplo #3B82F6. Si lo dejas vacío se usa el azul." },
    ],
  },
  custom_field_defs: {
    key: "custom_field_defs",
    table: "custom_field_defs",
    title: "Campos personalizados",
    description:
      "Agrega campos propios a tutores, pacientes o consultas. Aparecen en el formulario correspondiente.",
    hasActive: true,
    orderBy: "sort_order",
    fields: [
      {
        name: "entity",
        label: "En",
        type: "select",
        required: true,
        list: true,
        immutable: true,
        options: [
          { value: "tutor", label: "Tutores" },
          { value: "patient", label: "Pacientes" },
          { value: "consultation", label: "Consultas" },
        ],
      },
      { name: "label", label: "Nombre del campo", type: "text", required: true, list: true },
      {
        name: "key",
        label: "Clave interna",
        type: "text",
        required: true,
        immutable: true,
        hint: "Minúsculas, números y guion bajo (ej. condicion_corporal). No se puede cambiar después.",
      },
      {
        name: "field_type",
        label: "Tipo",
        type: "select",
        required: true,
        list: true,
        immutable: true,
        options: [
          { value: "text", label: "Texto" },
          { value: "number", label: "Número" },
          { value: "select", label: "Lista de opciones" },
          { value: "boolean", label: "Sí / No" },
          { value: "date", label: "Fecha" },
        ],
      },
      { name: "options", label: "Opciones (una por línea)", type: "lines", hint: "Solo para el tipo «Lista de opciones»." },
      { name: "section", label: "Sección", type: "text", hint: "Opcional, para agrupar." },
      { name: "required", label: "Obligatorio", type: "checkbox" },
    ],
  },
};

export const CATALOG_ORDER = [
  "species",
  "breeds",
  "control_types",
  "vaccine_catalog",
  "deworming_products",
  "medications",
  "text_templates",
  "consent_templates",
  "custom_field_defs",
];
