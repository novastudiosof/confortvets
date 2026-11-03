"use client";

import * as React from "react";
import { useActionState } from "react";
import { Loader2 } from "lucide-react";

import { Button, type ButtonProps } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils";

type Action = (prev: ActionResult, formData: FormData) => Promise<ActionResult>;

interface ActionFormProps {
  action: Action;
  children?: React.ReactNode;
  submitLabel?: string;
  pendingLabel?: string;
  submitVariant?: ButtonProps["variant"];
  submitSize?: ButtonProps["size"];
  className?: string;
  /** Vacía el formulario cuando la acción termina bien. */
  resetOnSuccess?: boolean;
  onSuccess?: () => void;
  /** Botón adicional (por ejemplo "Cancelar") a la izquierda del de guardar. */
  secondary?: React.ReactNode;
  hideSubmit?: boolean;
  /** Se acepta por compatibilidad: React ya envía los archivos solo cuando la acción es una función. */
  encType?: "multipart/form-data";
}

/** Formulario que ejecuta una server action y muestra su error o éxito. */
export function ActionForm({
  action,
  children,
  submitLabel = "Guardar",
  pendingLabel = "Guardando...",
  submitVariant,
  submitSize,
  className,
  resetOnSuccess = false,
  onSuccess,
  secondary,
  hideSubmit = false,
}: ActionFormProps) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const formRef = React.useRef<HTMLFormElement>(null);
  const onSuccessRef = React.useRef(onSuccess);
  React.useEffect(() => {
    onSuccessRef.current = onSuccess;
  });

  React.useEffect(() => {
    if (state?.success) {
      if (resetOnSuccess) formRef.current?.reset();
      onSuccessRef.current?.();
    }
  }, [state, resetOnSuccess]);

  return (
    <form ref={formRef} action={formAction} className={cn("flex flex-col gap-4", className)}>
      {children}
      {state?.error && (
        <p role="alert" className="rounded-[var(--radius-brand-sm)] bg-brand-danger/10 px-3 py-2 text-sm text-brand-danger">
          {state.error}
        </p>
      )}
      {state?.success && !onSuccess && (
        <p role="status" className="rounded-[var(--radius-brand-sm)] bg-brand-success/10 px-3 py-2 text-sm text-brand-success">
          {state.success}
        </p>
      )}
      {!hideSubmit && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {secondary}
          <Button type="submit" disabled={pending} variant={submitVariant} size={submitSize}>
            {pending && <Loader2 className="animate-spin" />}
            {pending ? pendingLabel : submitLabel}
          </Button>
        </div>
      )}
    </form>
  );
}
