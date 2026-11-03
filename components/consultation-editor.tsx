"use client";

import * as React from "react";
import { useActionState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TextAreaField } from "@/components/ui/fields";
import type { ActionResult } from "@/lib/action-result";

/** Id del formulario: los botones de otras secciones lo usan con el atributo `form`. */
export const CONSULTATION_FORM_ID = "consulta-form";

/**
 * Formulario de la consulta en borrador. Usa `display: contents` para que sus
 * secciones se ordenen junto a las demás de la página (exámenes, fórmula) con
 * `order`, sin anidar formularios. Todo es opcional: se va guardando el
 * borrador y solo al final (orden 100) aparece "Guardar y cerrar".
 */
export function ConsultationEditor({
  action,
  canClose,
  mode = "draft",
  children,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  canClose: boolean;
  /** "admin": corrección de una historia cerrada (pide motivo y no cierra ni guarda borrador). */
  mode?: "draft" | "admin";
  children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form id={CONSULTATION_FORM_ID} action={formAction} className="contents">
      {children}

      {state?.error && (
        <p style={{ order: 98 }} role="alert" className="rounded-[var(--radius-brand-sm)] bg-brand-danger/10 px-3 py-2 text-sm text-brand-danger">
          {state.error}
        </p>
      )}
      {state?.success && (
        <p style={{ order: 99 }} role="status" className="rounded-[var(--radius-brand-sm)] bg-brand-success/10 px-3 py-2 text-sm text-brand-success">
          {state.success}
        </p>
      )}

      {mode === "admin" ? (
        <div style={{ order: 100 }} className="flex flex-col gap-3 rounded-[var(--radius-brand-md)] border border-brand-border bg-white px-5 py-4 shadow-sm">
          <TextAreaField label="Motivo de la corrección" name="edit_reason" required rows={2} hint="Queda guardado en el historial junto con la versión anterior." />
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              Guardar corrección
            </Button>
          </div>
        </div>
      ) : (
        <div style={{ order: 100 }} className="flex flex-wrap items-center justify-end gap-2 rounded-[var(--radius-brand-md)] border border-brand-border bg-white px-5 py-4 shadow-sm">
          {canClose ? (
            <p className="mr-auto text-sm text-brand-muted">Revisa lo que llenaste. Al cerrar, la consulta ya no se puede editar.</p>
          ) : null}
          <Button type="submit" name="intent" value="save" variant="outline" disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            Guardar borrador
          </Button>
          {canClose && (
            <Button type="submit" name="intent" value="close" disabled={pending}>
              Guardar y cerrar consulta
            </Button>
          )}
        </div>
      )}
    </form>
  );
}
