"use client";

import * as React from "react";
import { Check, MessageCircle, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { setReminderStatus } from "@/lib/actions/preventive";

/**
 * Acciones de un recordatorio. Enviar abre WhatsApp con el mensaje ya escrito
 * y lo marca como enviado; es un clic por mensaje (gratis, sin API de pago).
 */
export function ReminderActions({
  id,
  link,
  message,
  status,
  canManage,
}: {
  id: string;
  link: string | null;
  message: string;
  status: "pendiente" | "enviado";
  canManage: boolean;
}) {
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function run(next: "enviado" | "hecho" | "descartado") {
    setError(null);
    startTransition(async () => {
      const result = await setReminderStatus(id, next, next === "enviado" ? message : undefined);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        {link ? (
          <Button
            type="button"
            variant="whatsapp"
            size="sm"
            disabled={pending || !canManage}
            onClick={() => {
              // Se abre antes de la acción para que el navegador no bloquee la ventana.
              window.open(link, "_blank", "noopener,noreferrer");
              if (status === "pendiente") run("enviado");
            }}
          >
            <MessageCircle /> {status === "enviado" ? "Enviar de nuevo" : "Enviar por WhatsApp"}
          </Button>
        ) : (
          <span className="rounded-full bg-brand-warning/15 px-2.5 py-1 text-xs text-brand-warning">Sin WhatsApp</span>
        )}
        {canManage && (
          <>
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => run("hecho")}>
              <Check /> Ya está hecho
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => run("descartado")}>
              <X /> Descartar
            </Button>
          </>
        )}
      </div>
      {error && <p className="text-xs text-brand-danger">{error}</p>}
    </div>
  );
}
