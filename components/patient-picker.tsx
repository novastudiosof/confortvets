"use client";

import * as React from "react";
import { Check, Search } from "lucide-react";

import { Field, fieldControlClass } from "@/components/ui/fields";

export interface PickerPatient {
  id: string;
  /** Texto que se muestra: "Luna · Ana Pérez". */
  label: string;
}

/**
 * Buscador de paciente: se escribe parte del nombre (del paciente o del
 * tutor) y se elige de la lista. El id elegido viaja en un campo oculto.
 */
export function PatientPicker({
  patients,
  name = "patient_id",
  label = "Paciente",
  defaultId,
}: {
  patients: PickerPatient[];
  name?: string;
  label?: string;
  defaultId?: string;
}) {
  const initial = patients.find((p) => p.id === defaultId) ?? null;
  const [selected, setSelected] = React.useState<PickerPatient | null>(initial);
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);

  const matches = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return patients.slice(0, 8);
    return patients.filter((p) => p.label.toLowerCase().includes(q)).slice(0, 8);
  }, [patients, query]);

  return (
    <Field label={label} htmlFor={`${name}-search`} required>
      <input type="hidden" name={name} value={selected?.id ?? ""} />
      {selected ? (
        <div className="flex items-center justify-between gap-2 rounded-[var(--radius-brand-sm)] border border-brand-success/40 bg-brand-success/5 px-3 py-2 text-sm">
          <span className="inline-flex min-w-0 items-center gap-2">
            <Check className="h-4 w-4 shrink-0 text-brand-success" />
            <span className="truncate font-medium">{selected.label}</span>
          </span>
          <button
            type="button"
            className="shrink-0 text-xs text-brand-dark hover:underline"
            onClick={() => {
              setSelected(null);
              setQuery("");
              setOpen(true);
            }}
          >
            Cambiar
          </button>
        </div>
      ) : (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-brand-muted" />
          <input
            id={`${name}-search`}
            type="search"
            autoComplete="off"
            placeholder="Escribe el nombre del paciente o del tutor"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            className={`${fieldControlClass} h-10 pl-9`}
          />
          {open && (
            <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-[var(--radius-brand-sm)] border border-brand-border bg-white shadow-lg">
              {matches.length === 0 ? (
                <li className="px-3 py-2 text-sm text-brand-muted">No hay coincidencias. Crea primero el tutor y el paciente.</li>
              ) : (
                matches.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-black/5"
                      onClick={() => {
                        setSelected(p);
                        setOpen(false);
                      }}
                    >
                      {p.label}
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      )}
    </Field>
  );
}
