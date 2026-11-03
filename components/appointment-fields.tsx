"use client";

import * as React from "react";

import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/ui/fields";

export interface TypeOption {
  id: string;
  name: string;
  duration_minutes: number;
}

export interface AppointmentDefaults {
  date: string;
  time: string;
  duration: number;
  typeId: string;
  reason: string;
  notes: string;
}

/**
 * Campos comunes de una cita (fecha, hora, duración, tipo, motivo y notas).
 * Al elegir el tipo se sugiere su duración.
 */
export function AppointmentFields({
  types,
  defaults,
  slotMinutes,
  showConfirmed = false,
}: {
  types: TypeOption[];
  defaults: AppointmentDefaults;
  slotMinutes: number;
  showConfirmed?: boolean;
}) {
  const [duration, setDuration] = React.useState(String(defaults.duration));

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Tipo de cita"
          name="type_id"
          placeholder="Sin tipo"
          defaultValue={defaults.typeId}
          options={types.map((t) => ({ value: t.id, label: `${t.name} (${t.duration_minutes} min)` }))}
          onChange={(e) => {
            const type = types.find((t) => t.id === e.target.value);
            if (type) setDuration(String(type.duration_minutes));
          }}
        />
        <TextField
          label="Duración (minutos)"
          name="duration_minutes"
          type="number"
          min={5}
          max={600}
          step={5}
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          required
        />
        <TextField label="Fecha" name="date" type="date" defaultValue={defaults.date} required />
        <TextField label="Hora" name="time" type="time" step={slotMinutes * 60} defaultValue={defaults.time} required />
      </div>
      <TextField label="Motivo" name="reason" defaultValue={defaults.reason} placeholder="Ej.: vacuna anual, revisión de piel" />
      <TextAreaField label="Notas internas" name="notes" defaultValue={defaults.notes} rows={2} />
      {showConfirmed && <CheckboxField label="Ya está confirmada por el tutor" name="confirmed" />}
      <CheckboxField label="Agendar de todos modos si queda fuera del horario de atención" name="force" />
    </>
  );
}
