"use client";

import * as React from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { deleteAgendaBlock, deleteAgendaHours } from "@/lib/actions/agenda-settings";
import type { ActionResult } from "@/lib/action-result";

/** Botón pequeño para quitar una franja de horario o un bloqueo. */
export function RemoveButton({ kind, id, label }: { kind: "hours" | "block"; id: string; label: string }) {
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function remove() {
    setError(null);
    startTransition(async () => {
      const result: ActionResult = kind === "hours" ? await deleteAgendaHours(id) : await deleteAgendaBlock(id);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <span className="inline-flex flex-col">
      <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={remove} aria-label={`Quitar ${label}`}>
        <X /> Quitar
      </Button>
      {error && <span className="text-xs text-brand-danger">{error}</span>}
    </span>
  );
}
