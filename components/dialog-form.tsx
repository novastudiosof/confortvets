"use client";

import * as React from "react";

import { ActionForm } from "@/components/action-form";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils";

interface DialogFormProps {
  /** Texto del botón que abre el diálogo. */
  trigger: React.ReactNode;
  triggerVariant?: ButtonProps["variant"];
  triggerSize?: ButtonProps["size"];
  triggerClassName?: string;
  title: string;
  description?: React.ReactNode;
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  children?: React.ReactNode;
  submitLabel?: string;
  submitVariant?: ButtonProps["variant"];
  wide?: boolean;
  disabled?: boolean;
  encType?: "multipart/form-data";
  defaultOpen?: boolean;
}

/** Botón que abre un diálogo con un formulario conectado a una server action. */
export function DialogForm({
  trigger,
  triggerVariant = "default",
  triggerSize,
  triggerClassName,
  title,
  description,
  action,
  children,
  submitLabel = "Guardar",
  submitVariant,
  wide = false,
  disabled = false,
  encType,
  defaultOpen = false,
}: DialogFormProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  const close = React.useCallback(() => setOpen(false), []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size={triggerSize} className={triggerClassName} disabled={disabled}>
          {trigger}
        </Button>
      </DialogTrigger>
      <DialogContent className={cn("max-h-[90vh] overflow-y-auto", wide && "max-w-2xl")}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <ActionForm
          action={action}
          onSuccess={close}
          submitLabel={submitLabel}
          submitVariant={submitVariant}
          encType={encType}
          secondary={
            <Button type="button" variant="outline" onClick={close}>
              Cancelar
            </Button>
          }
        >
          {children}
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
