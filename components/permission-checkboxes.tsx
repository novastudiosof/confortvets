import { CheckboxField } from "@/components/ui/fields";
import { MODULE_LABELS, type PermissionDef } from "@/lib/logic/permissions";

/** Permisos agrupados por módulo, con casillas (campo `permissions`). */
export function PermissionCheckboxes({
  groups,
  selected = [],
}: {
  groups: { module: string; items: PermissionDef[] }[];
  selected?: string[];
}) {
  if (groups.length === 0) {
    return <p className="text-sm text-brand-muted">No hay permisos disponibles para asignar.</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <fieldset key={g.module} className="rounded-[var(--radius-brand-sm)] border border-brand-border p-3">
          <legend className="px-1 text-sm font-semibold text-brand-ink">{MODULE_LABELS[g.module] ?? g.module}</legend>
          <div className="flex flex-col gap-2">
            {g.items.map((p) => (
              <CheckboxField key={p.key} label={p.label} name="permissions" value={p.key} defaultChecked={selected.includes(p.key)} id={`perm-${p.key}-${selected.length}`} />
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
