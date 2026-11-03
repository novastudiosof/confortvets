"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { checked, dbError, fail, ok, optNum, optStr, str, type ActionResult } from "@/lib/action-result";
import { logActivity } from "@/lib/activity";
import { can, guard, hasModule } from "@/lib/auth";
import { formatDate, isIsoDate } from "@/lib/logic/dates";
import {
  fitsInHours,
  formatTime12,
  isTime,
  trimTime,
  weekdayOf,
  zonedToUtc,
  type AppointmentStatus,
} from "@/lib/logic/agenda";
import { createClient } from "@/lib/supabase/server";

type AgendaCtx = Extract<Awaited<ReturnType<typeof guard>>, { ok: true }>["ctx"];

interface ParsedAppointment {
  row: {
    type_id: string | null;
    starts_at: string;
    ends_at: string;
    reason: string | null;
    notes: string | null;
  };
  date: string;
  time: string;
}

/** Lee y valida los campos de fecha, hora, duración y tipo de una cita. */
async function readAppointment(formData: FormData, ctx: AgendaCtx): Promise<ParsedAppointment | { error: string }> {
  const date = str(formData, "date");
  const time = str(formData, "time");
  if (!isIsoDate(date)) return { error: "Elige la fecha de la cita" };
  if (!isTime(time)) return { error: "Elige la hora de la cita" };

  const supabase = await createClient();

  const typeId = optStr(formData, "type_id");
  let typeDuration: number | null = null;
  if (typeId) {
    const { data: type } = await supabase.from("appointment_types").select("id, duration_minutes").eq("id", typeId).maybeSingle();
    if (!type) return { error: "El tipo de cita no existe" };
    typeDuration = type.duration_minutes as number;
  }

  const durationInput = optNum(formData, "duration_minutes");
  if (durationInput === undefined) return { error: "La duración no es válida" };
  const duration = durationInput ?? typeDuration ?? 30;
  if (!Number.isInteger(duration) || duration < 5 || duration > 600) {
    return { error: "La duración debe estar entre 5 y 600 minutos" };
  }

  // Horario de atención: avisa, y deja agendar fuera de él solo si se confirma.
  if (!checked(formData, "force")) {
    const { data: hours } = await supabase
      .from("agenda_hours")
      .select("starts_at, ends_at")
      .eq("weekday", weekdayOf(date));
    const ranges = (hours ?? []).map((h) => ({ start: trimTime(h.starts_at as string), end: trimTime(h.ends_at as string) }));
    if (!fitsInHours(time, duration, ranges)) {
      return {
        error: `Esa cita queda fuera del horario de atención (${formatDate(date)} a las ${formatTime12(time)}). Marca «Agendar de todos modos» si es a propósito.`,
      };
    }
  }

  const start = zonedToUtc(date, time, ctx.tz);
  const end = new Date(start.getTime() + duration * 60000);
  return {
    row: {
      type_id: typeId,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      reason: optStr(formData, "reason"),
      notes: optStr(formData, "notes"),
    },
    date,
    time,
  };
}

function refresh(): void {
  revalidatePath("/dashboard/agenda");
  revalidatePath("/dashboard");
}

export async function createAppointment(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("agenda.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const patientId = str(formData, "patient_id");
  if (!patientId) return fail("Elige el paciente");

  const parsed = await readAppointment(formData, ctx);
  if ("error" in parsed) return fail(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("appointments")
    .insert({
      organization_id: ctx.org.id,
      patient_id: patientId,
      status: checked(formData, "confirmed") ? "confirmada" : "programada",
      ...parsed.row,
    })
    .select("id")
    .single();
  if (error || !data) return fail(dbError(error, "No se pudo crear la cita"));

  // Si venía de la lista de espera, queda como agendada.
  const waitlistId = optStr(formData, "waitlist_id");
  if (waitlistId) {
    await supabase
      .from("agenda_waitlist")
      .update({ status: "agendada", appointment_id: data.id })
      .eq("id", waitlistId)
      .eq("organization_id", ctx.org.id)
      .eq("status", "esperando");
  }

  await logActivity(ctx, "Agendó una cita", {
    entity: "appointment",
    entityId: data.id,
    detail: `${formatDate(parsed.date)} ${parsed.time}`,
  });
  refresh();
  return ok("Cita agendada");
}

export async function updateAppointment(appointmentId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("agenda.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const parsed = await readAppointment(formData, ctx);
  if ("error" in parsed) return fail(parsed.error);

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("appointments")
    .update({ ...parsed.row, reminder_sent_at: null })
    .eq("id", appointmentId)
    .eq("organization_id", ctx.org.id)
    .select("id");
  if (error) return fail(dbError(error, "No se pudo guardar la cita"));
  if (!updated || updated.length === 0) return fail("No se encontró la cita");

  await logActivity(ctx, "Reprogramó o editó una cita", {
    entity: "appointment",
    entityId: appointmentId,
    detail: `${formatDate(parsed.date)} ${parsed.time}`,
  });
  refresh();
  return ok("Cita actualizada");
}

const SIMPLE_TRANSITIONS: AppointmentStatus[] = ["programada", "confirmada", "en_sala", "no_asistio"];

/** Confirmar, marcar que llegó, volver a programada o marcar que no asistió. */
export async function setAppointmentStatus(appointmentId: string, status: AppointmentStatus): Promise<ActionResult> {
  const g = await guard("agenda.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;
  if (!SIMPLE_TRANSITIONS.includes(status)) return fail("Estado no válido");

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("appointments")
    .update({ status })
    .eq("id", appointmentId)
    .eq("organization_id", ctx.org.id)
    .select("id");
  if (error) return fail(dbError(error, "No se pudo cambiar el estado"));
  if (!updated || updated.length === 0) return fail("No se encontró la cita");

  await logActivity(ctx, `Cambió una cita a «${status}»`, { entity: "appointment", entityId: appointmentId });
  refresh();
  return ok("Listo");
}

export async function cancelAppointment(appointmentId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("agenda.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const reason = optStr(formData, "cancel_reason");
  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("appointments")
    .update({ status: "cancelada", cancel_reason: reason })
    .eq("id", appointmentId)
    .eq("organization_id", ctx.org.id)
    .select("id");
  if (error) return fail(dbError(error, "No se pudo cancelar la cita"));
  if (!updated || updated.length === 0) return fail("No se encontró la cita");

  await logActivity(ctx, "Canceló una cita", { entity: "appointment", entityId: appointmentId, detail: reason ?? undefined });
  refresh();
  return ok("Cita cancelada");
}

/**
 * Atender la cita: abre una consulta en borrador con el paciente y el motivo
 * de la cita (si el usuario puede escribir historias), y la marca atendida.
 */
export async function attendAppointment(appointmentId: string): Promise<ActionResult> {
  const g = await guard("agenda.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const supabase = await createClient();
  const { data: appt } = await supabase
    .from("appointments")
    .select("id, patient_id, status, reason, type_id, consultation_id")
    .eq("id", appointmentId)
    .maybeSingle();
  if (!appt) return fail("No se encontró la cita");
  if (appt.consultation_id) redirect(`/dashboard/consultas/${appt.consultation_id}`);
  if (!["programada", "confirmada", "en_sala"].includes(appt.status as string)) {
    return fail("Esta cita ya está cerrada");
  }

  const canClinical = hasModule(ctx, "clinical") && can(ctx, "clinical.write");
  let consultationId: string | null = null;

  if (canClinical) {
    let kind: "consulta" | "control" = "consulta";
    if (appt.type_id) {
      const { data: type } = await supabase.from("appointment_types").select("name").eq("id", appt.type_id).maybeSingle();
      if (type && /control/i.test(type.name as string)) kind = "control";
    }
    const { data: consultation, error: cError } = await supabase
      .from("consultations")
      .insert({
        organization_id: ctx.org.id,
        patient_id: appt.patient_id,
        kind,
        reason: kind === "consulta" ? appt.reason : null,
        professional_name: ctx.settings.professional_name?.trim() || ctx.profile.full_name,
      })
      .select("id")
      .single();
    if (cError || !consultation) return fail(dbError(cError, "No se pudo abrir la consulta"));
    consultationId = consultation.id as string;
  }

  const { error } = await supabase
    .from("appointments")
    .update({ status: "atendida", consultation_id: consultationId })
    .eq("id", appointmentId)
    .eq("organization_id", ctx.org.id);
  if (error) return fail(dbError(error, "No se pudo marcar la cita como atendida"));

  await logActivity(ctx, "Atendió una cita", { entity: "appointment", entityId: appointmentId });
  refresh();
  if (consultationId) redirect(`/dashboard/consultas/${consultationId}`);
  return ok("Cita atendida");
}

/** Anota que el recordatorio de la cita ya se envió (al abrir WhatsApp). */
export async function markAppointmentReminded(appointmentId: string): Promise<ActionResult> {
  const g = await guard("agenda.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const supabase = await createClient();
  const { error } = await supabase
    .from("appointments")
    .update({ reminder_sent_at: new Date().toISOString() })
    .eq("id", appointmentId)
    .eq("organization_id", ctx.org.id);
  if (error) return fail(dbError(error, "No se pudo anotar el recordatorio"));
  refresh();
  return ok("Anotado");
}

// ---------------------------------------------------------------------------
// Lista de espera
// ---------------------------------------------------------------------------
export async function addToWaitlist(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("agenda.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const patientId = str(formData, "patient_id");
  if (!patientId) return fail("Elige el paciente");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agenda_waitlist")
    .insert({
      organization_id: ctx.org.id,
      patient_id: patientId,
      type_id: optStr(formData, "type_id"),
      notes: optStr(formData, "notes"),
    })
    .select("id")
    .single();
  if (error || !data) return fail(dbError(error, "No se pudo agregar a la lista de espera"));

  await logActivity(ctx, "Agregó a la lista de espera", { entity: "agenda_waitlist", entityId: data.id });
  refresh();
  return ok("Agregado a la lista de espera");
}

export async function discardWaitlistEntry(entryId: string): Promise<ActionResult> {
  const g = await guard("agenda.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const supabase = await createClient();
  const { error } = await supabase
    .from("agenda_waitlist")
    .update({ status: "descartada" })
    .eq("id", entryId)
    .eq("organization_id", ctx.org.id)
    .eq("status", "esperando");
  if (error) return fail(dbError(error, "No se pudo descartar"));

  await logActivity(ctx, "Descartó una entrada de la lista de espera", { entity: "agenda_waitlist", entityId: entryId });
  refresh();
  return ok("Descartado");
}
