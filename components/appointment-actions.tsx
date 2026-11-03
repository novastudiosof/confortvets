"use client";

import * as React from "react";
import { CalendarClock, Check, DoorOpen, MessageCircle, Stethoscope, UserX, X } from "lucide-react";

import { AppointmentFields, type AppointmentDefaults, type TypeOption } from "@/components/appointment-fields";
import { DialogForm } from "@/components/dialog-form";
import { Button } from "@/components/ui/button";
import { TextAreaField } from "@/components/ui/fields";
import {
  attendAppointment,
  cancelAppointment,
  markAppointmentReminded,
  setAppointmentStatus,
  updateAppointment,
} from "@/lib/actions/agenda";
import type { ActionResult } from "@/lib/action-result";
import type { AppointmentStatus } from "@/lib/logic/agenda";

/**
 * Botones de una cita según su estado: atender, confirmar, llegó, recordar por
 * WhatsApp, mover, cancelar y no asistió.
 */
export function AppointmentActions({
  id,
  status,
  canAttend,
  whatsappUrl,
  reminded,
  types,
  defaults,
  slotMinutes,
}: {
  id: string;
  status: AppointmentStatus;
  /** El usuario puede atender (marcar atendida y abrir la consulta). */
  canAttend: boolean;
  whatsappUrl: string | null;
  reminded: boolean;
  types: TypeOption[];
  defaults: AppointmentDefaults;
  slotMinutes: number;
}) {
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function run(task: () => Promise<ActionResult>) {
    setError(null);
    startTransition(async () => {
      const result = await task();
      if (result?.error) setError(result.error);
    });
  }

  const active = status === "programada" || status === "confirmada" || status === "en_sala";
  if (!active) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        {canAttend && (
          <Button size="sm" disabled={pending} onClick={() => run(() => attendAppointment(id))}>
            <Stethoscope /> Atender
          </Button>
        )}
        {status === "programada" && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => setAppointmentStatus(id, "confirmada"))}>
            <Check /> Confirmar
          </Button>
        )}
        {status !== "en_sala" && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => setAppointmentStatus(id, "en_sala"))}>
            <DoorOpen /> Llegó
          </Button>
        )}
        {whatsappUrl && (
          <Button asChild size="sm" variant="whatsapp">
            <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" onClick={() => run(() => markAppointmentReminded(id))}>
              <MessageCircle /> {reminded ? "Recordar otra vez" : "Recordar"}
            </a>
          </Button>
        )}
        <DialogForm
          trigger={
            <>
              <CalendarClock /> Mover
            </>
          }
          triggerVariant="outline"
          triggerSize="sm"
          title="Mover o editar la cita"
          action={updateAppointment.bind(null, id)}
          wide
        >
          <AppointmentFields types={types} defaults={defaults} slotMinutes={slotMinutes} />
        </DialogForm>
        <DialogForm
          trigger={
            <>
              <X /> Cancelar
            </>
          }
          triggerVariant="ghost"
          triggerSize="sm"
          title="Cancelar la cita"
          description="La cita no se borra: queda como cancelada."
          action={cancelAppointment.bind(null, id)}
          submitLabel="Cancelar la cita"
          submitVariant="destructive"
        >
          <TextAreaField label="Motivo (opcional)" name="cancel_reason" rows={2} />
        </DialogForm>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setAppointmentStatus(id, "no_asistio"))}>
          <UserX /> No asistió
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-brand-danger">
          {error}
        </p>
      )}
    </div>
  );
}
