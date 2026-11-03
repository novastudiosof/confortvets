import { Pencil, Plus } from "lucide-react";

import { ActionForm } from "@/components/action-form";
import { DialogForm } from "@/components/dialog-form";
import { Badge } from "@/components/ui/badge";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/ui/fields";
import { DataTable, EmptyState, Section, tdClass, thClass } from "@/components/ui/misc";
import { saveCatalogItem, toggleCatalogItem } from "@/lib/actions/settings";
import type { CatalogDef, CatalogField } from "@/lib/catalogs";

type Row = Record<string, unknown> & { id: string; is_active?: boolean };
interface Option {
  value: string;
  label: string;
}

function optionsFor(field: CatalogField, refs: Record<string, Option[]>): Option[] {
  if (field.optionsFrom) return refs[field.optionsFrom] ?? [];
  return field.options ?? [];
}

function FieldInput({ field, row, refs, editing }: { field: CatalogField; row?: Row; refs: Record<string, Option[]>; editing: boolean }) {
  const current = row?.[field.name];
  // Los campos inmutables solo se eligen al crear.
  if (editing && field.immutable) {
    const label = optionsFor(field, refs).find((o) => o.value === current)?.label ?? String(current ?? "—");
    return (
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-brand-ink">{field.label}</span>
        <span className="text-sm text-brand-muted">{label} (no se puede cambiar)</span>
      </div>
    );
  }
  switch (field.type) {
    case "textarea":
      return <TextAreaField label={field.label} name={field.name} defaultValue={(current as string | undefined) ?? ""} required={field.required} rows={7} hint={field.hint} />;
    case "lines":
      return (
        <TextAreaField
          label={field.label}
          name={field.name}
          defaultValue={Array.isArray(current) ? (current as string[]).join("\n") : ""}
          rows={4}
          hint={field.hint}
        />
      );
    case "checkbox":
      return <CheckboxField label={field.label} name={field.name} defaultChecked={current === true} hint={field.hint} />;
    case "number":
      return (
        <TextField
          label={field.label}
          name={field.name}
          inputMode="numeric"
          defaultValue={current === null || current === undefined ? "" : String(current)}
          required={field.required}
          hint={field.hint}
        />
      );
    case "select":
      return (
        <SelectField
          label={field.label}
          name={field.name}
          defaultValue={(current as string | undefined) ?? field.defaultValue ?? ""}
          required={field.required}
          placeholder={field.required ? "Elegir..." : "Ninguna"}
          options={optionsFor(field, refs)}
          hint={field.hint}
        />
      );
    default:
      return <TextField label={field.label} name={field.name} defaultValue={(current as string | undefined) ?? ""} required={field.required} hint={field.hint} />;
  }
}

function displayValue(field: CatalogField, value: unknown, refs: Record<string, Option[]>): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field.type === "checkbox") return value ? "Sí" : "No";
  if (field.type === "select") return optionsFor(field, refs).find((o) => o.value === value)?.label ?? String(value);
  return String(value);
}

/** Tabla editable de un catálogo (alta, edición y activar/desactivar). */
export function CatalogSection({
  def,
  rows,
  refs,
  canEdit,
}: {
  def: CatalogDef;
  rows: Row[];
  refs: Record<string, Option[]>;
  canEdit: boolean;
}) {
  const listFields = def.fields.filter((f) => f.list);

  return (
    <Section
      title={def.title}
      actions={
        canEdit && (
          <DialogForm
            trigger={
              <>
                <Plus /> Agregar
              </>
            }
            title={`Agregar a ${def.title.toLowerCase()}`}
            action={saveCatalogItem.bind(null, def.key, null)}
            wide
          >
            {def.fields.map((f) => (
              <FieldInput key={f.name} field={f} refs={refs} editing={false} />
            ))}
          </DialogForm>
        )
      }
    >
      <p className="mb-4 text-sm text-brand-muted">{def.description}</p>
      {rows.length === 0 ? (
        <EmptyState>No hay elementos todavía.</EmptyState>
      ) : (
        <DataTable>
          <thead>
            <tr>
              {listFields.map((f) => (
                <th key={f.name} className={thClass}>
                  {f.label}
                </th>
              ))}
              {def.hasActive && <th className={thClass}>Estado</th>}
              {canEdit && <th className={thClass} />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={row.is_active === false ? "text-brand-muted" : ""}>
                {listFields.map((f) => (
                  <td key={f.name} className={tdClass}>
                    {displayValue(f, row[f.name], refs)}
                  </td>
                ))}
                {def.hasActive && (
                  <td className={tdClass}>
                    <Badge variant={row.is_active === false ? "muted" : "success"}>{row.is_active === false ? "Inactivo" : "Activo"}</Badge>
                  </td>
                )}
                {canEdit && (
                  <td className={`${tdClass} whitespace-nowrap text-right`}>
                    <div className="flex justify-end gap-1">
                      <DialogForm
                        trigger={<Pencil />}
                        triggerVariant="ghost"
                        triggerSize="icon"
                        title={`Editar ${def.title.toLowerCase()}`}
                        action={saveCatalogItem.bind(null, def.key, row.id)}
                        wide
                      >
                        {def.fields.map((f) => (
                          <FieldInput key={f.name} field={f} row={row} refs={refs} editing />
                        ))}
                      </DialogForm>
                      {def.hasActive && (
                        <ActionForm
                          action={toggleCatalogItem.bind(null, def.key, row.id, row.is_active === false)}
                          submitLabel={row.is_active === false ? "Activar" : "Desactivar"}
                          submitVariant="ghost"
                          submitSize="sm"
                          className="!gap-0"
                        />
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </Section>
  );
}
