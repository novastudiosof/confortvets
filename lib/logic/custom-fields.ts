import { isIsoDate } from "@/lib/logic/dates";

export type CustomFieldType = "text" | "number" | "select" | "boolean" | "date";

export interface CustomFieldDef {
  key: string;
  label: string;
  field_type: CustomFieldType;
  options: string[];
  required: boolean;
  is_active?: boolean;
  section?: string | null;
}

export interface CustomFieldsResult {
  values: Record<string, string | number | boolean>;
  errors: string[];
}

/** Valida los valores enviados (por clave) contra las definiciones activas. */
export function validateCustomFields(
  defs: CustomFieldDef[],
  input: Record<string, string | undefined | null>
): CustomFieldsResult {
  const values: Record<string, string | number | boolean> = {};
  const errors: string[] = [];

  for (const def of defs) {
    if (def.is_active === false) continue;
    const raw = (input[def.key] ?? "").toString().trim();

    if (def.field_type === "boolean") {
      const on = ["on", "true", "si", "sí", "1"].includes(raw.toLowerCase());
      if (def.required && !on) errors.push(`${def.label} es obligatorio`);
      values[def.key] = on;
      continue;
    }

    if (raw === "") {
      if (def.required) errors.push(`${def.label} es obligatorio`);
      continue;
    }

    switch (def.field_type) {
      case "number": {
        const n = Number(raw.replace(",", "."));
        if (!Number.isFinite(n)) errors.push(`${def.label} debe ser un número`);
        else values[def.key] = n;
        break;
      }
      case "date":
        if (!isIsoDate(raw)) errors.push(`${def.label} debe ser una fecha válida`);
        else values[def.key] = raw;
        break;
      case "select":
        if (!def.options.includes(raw)) errors.push(`${def.label}: opción no válida`);
        else values[def.key] = raw;
        break;
      default:
        values[def.key] = raw.slice(0, 2000);
    }
  }
  return { values, errors };
}

/** Lee los campos del formulario: cada uno viene con el nombre cf_<clave>. */
export function readCustomFieldInputs(
  formData: FormData,
  defs: CustomFieldDef[]
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const def of defs) {
    const v = formData.get(`cf_${def.key}`);
    if (typeof v === "string") out[def.key] = v;
  }
  return out;
}
