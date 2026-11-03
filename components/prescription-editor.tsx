"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";

import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { TextAreaField, fieldControlClass } from "@/components/ui/fields";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils";

export interface MedicationOption {
  name: string;
  presentation: string | null;
  default_dose: string | null;
  default_frequency: string | null;
  default_duration: string | null;
  route: string | null;
}

interface Row {
  key: number;
  name: string;
  presentation: string;
  dose: string;
  frequency: string;
  duration: string;
  route: string;
  instructions: string;
}

const emptyRow = (key: number): Row => ({
  key,
  name: "",
  presentation: "",
  dose: "",
  frequency: "",
  duration: "",
  route: "",
  instructions: "",
});

/** Fórmula médica: filas de medicamentos que se pueden agregar y quitar. */
export function PrescriptionEditor({
  action,
  medications,
  initialRows,
  initialNotes,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  medications: MedicationOption[];
  initialRows: Omit<Row, "key">[];
  initialNotes: string;
}) {
  const [rows, setRows] = React.useState<Row[]>(() =>
    initialRows.length ? initialRows.map((r, i) => ({ ...r, key: i })) : [emptyRow(0)]
  );
  const nextKey = React.useRef(rows.length);

  function update(key: number, patch: Partial<Row>) {
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function changeName(key: number, name: string) {
    const known = medications.find((m) => m.name.toLowerCase() === name.toLowerCase());
    setRows((current) =>
      current.map((r) => {
        if (r.key !== key) return r;
        if (!known) return { ...r, name };
        // Completa lo que esté vacío con los valores habituales del medicamento.
        return {
          ...r,
          name: known.name,
          presentation: r.presentation || known.presentation || "",
          dose: r.dose || known.default_dose || "",
          frequency: r.frequency || known.default_frequency || "",
          duration: r.duration || known.default_duration || "",
          route: r.route || known.route || "",
        };
      })
    );
  }

  const input = cn(fieldControlClass, "h-9");

  return (
    <ActionForm action={action} submitLabel="Guardar fórmula" className="gap-4">
      <datalist id="medication-list">
        {medications.map((m) => (
          <option key={m.name} value={m.name} />
        ))}
      </datalist>

      <div className="flex flex-col gap-3">
        {rows.map((row, index) => (
          <div key={row.key} className="rounded-[var(--radius-brand-sm)] border border-brand-border p-3">
            <div className="grid gap-2 sm:grid-cols-6">
              <label className="sm:col-span-3">
                <span className="mb-1 block text-xs font-medium text-brand-muted">Medicamento {index + 1}</span>
                <input
                  name="med_name"
                  list="medication-list"
                  value={row.name}
                  onChange={(e) => changeName(row.key, e.target.value)}
                  className={input}
                  placeholder="Nombre"
                />
              </label>
              <label className="sm:col-span-3">
                <span className="mb-1 block text-xs font-medium text-brand-muted">Presentación</span>
                <input name="med_presentation" value={row.presentation} onChange={(e) => update(row.key, { presentation: e.target.value })} className={input} />
              </label>
              <label className="sm:col-span-2">
                <span className="mb-1 block text-xs font-medium text-brand-muted">Dosis</span>
                <input name="med_dose" value={row.dose} onChange={(e) => update(row.key, { dose: e.target.value })} className={input} />
              </label>
              <label className="sm:col-span-2">
                <span className="mb-1 block text-xs font-medium text-brand-muted">Frecuencia</span>
                <input name="med_frequency" value={row.frequency} onChange={(e) => update(row.key, { frequency: e.target.value })} className={input} />
              </label>
              <label className="sm:col-span-1">
                <span className="mb-1 block text-xs font-medium text-brand-muted">Duración</span>
                <input name="med_duration" value={row.duration} onChange={(e) => update(row.key, { duration: e.target.value })} className={input} />
              </label>
              <label className="sm:col-span-1">
                <span className="mb-1 block text-xs font-medium text-brand-muted">Vía</span>
                <input name="med_route" value={row.route} onChange={(e) => update(row.key, { route: e.target.value })} className={input} />
              </label>
              <label className="sm:col-span-6">
                <span className="mb-1 block text-xs font-medium text-brand-muted">Indicaciones</span>
                <input name="med_instructions" value={row.instructions} onChange={(e) => update(row.key, { instructions: e.target.value })} className={input} />
              </label>
            </div>
            {rows.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-2 text-brand-danger"
                onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
              >
                <Trash2 /> Quitar
              </Button>
            )}
          </div>
        ))}
      </div>

      <div>
        <Button type="button" variant="outline" size="sm" onClick={() => setRows((c) => [...c, emptyRow(nextKey.current++)])}>
          <Plus /> Agregar medicamento
        </Button>
      </div>

      <TextAreaField label="Observaciones de la fórmula" name="prescription_notes" defaultValue={initialNotes} rows={2} />
    </ActionForm>
  );
}
