"use client";

import * as React from "react";
import { MessageCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { discardWaitlistEntry, markAppointmentReminded } from "@/lib/actions/agenda";

/** Descarta una entrada de la lista de espera. */
export function DiscardWaitlistButton({ id }: { id: string }) {
  const [pending, startTransition] = React.useTransition();
  return (
    <Button size="sm" variant="ghost" disabled={pending} onClick={() => startTransition(async () => void (await discardWaitlistEntry(id)))}>
      Descartar
    </Button>
  );
}

/** Enlace de WhatsApp para recordar una cita; al abrirlo anota que se envió. */
export function ReminderLink({ id, url, reminded }: { id: string; url: string; reminded: boolean }) {
  const [, startTransition] = React.useTransition();
  return (
    <Button asChild size="sm" variant="whatsapp">
      <a href={url} target="_blank" rel="noopener noreferrer" onClick={() => startTransition(async () => void (await markAppointmentReminded(id)))}>
        <MessageCircle /> {reminded ? "Recordar otra vez" : "Recordar"}
      </a>
    </Button>
  );
}
