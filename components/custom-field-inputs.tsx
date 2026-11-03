import { CheckboxField, SelectField, TextField } from "@/components/ui/fields";
import type { CustomFieldDef } from "@/lib/logic/custom-fields";

/** Campos personalizados de una entidad. Los nombres llevan el prefijo cf_. */
export function CustomFieldInputs({
  defs,
  values = {},
}: {
  defs: CustomFieldDef[];
  values?: Record<string, unknown>;
}) {
  if (defs.length === 0) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {defs.map((def) => {
        const name = `cf_${def.key}`;
        const current = values[def.key];
        switch (def.field_type) {
          case "boolean":
            return (
              <CheckboxField
                key={def.key}
                name={name}
                label={def.label}
                defaultChecked={current === true}
                className="sm:col-span-2"
              />
            );
          case "select":
            return (
              <SelectField
                key={def.key}
                name={name}
                label={def.label}
                required={def.required}
                placeholder="Elegir..."
                defaultValue={typeof current === "string" ? current : ""}
                options={def.options.map((o) => ({ value: o, label: o }))}
              />
            );
          case "number":
            return (
              <TextField
                key={def.key}
                name={name}
                label={def.label}
                required={def.required}
                inputMode="decimal"
                defaultValue={current === undefined || current === null ? "" : String(current)}
              />
            );
          case "date":
            return (
              <TextField
                key={def.key}
                name={name}
                label={def.label}
                type="date"
                required={def.required}
                defaultValue={typeof current === "string" ? current : ""}
              />
            );
          default:
            return (
              <TextField
                key={def.key}
                name={name}
                label={def.label}
                required={def.required}
                defaultValue={typeof current === "string" ? current : ""}
              />
            );
        }
      })}
    </div>
  );
}

/** Muestra los valores guardados de los campos personalizados. */
export function customFieldItems(
  defs: CustomFieldDef[],
  values: Record<string, unknown>
): { label: string; value: React.ReactNode }[] {
  return defs
    .filter((d) => values[d.key] !== undefined && values[d.key] !== null && values[d.key] !== "")
    .map((d) => ({
      label: d.label,
      value: d.field_type === "boolean" ? (values[d.key] ? "Sí" : "No") : String(values[d.key]),
    }));
}
