"use server";

import { revalidatePath } from "next/cache";

import { checked, dbError, fail, ok, optNum, str, type ActionResult } from "@/lib/action-result";
import { logActivity } from "@/lib/activity";
import { guard } from "@/lib/auth";
import { hasOverlappingRanges, isTime, minutesOf, trimTime, zonedToUtc } from "@/lib/logic/agenda";
import { isIsoDate } from "@/lib/logic/dates";
import { createClient } from "@/lib/supabase/server";

function refresh(): void {
  revalidatePath("/dashboard/configuracion");
  revalidatePath("/dashboard/agenda");
}

export async function saveAgendaSettings(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("settings.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const slot = optNum(formData, "slot_minutes");
  if (slot === null || slot === undefined || !Number.isInteger(slot) || slot < 5 || slot > 240) {
    return fail("El tamaño del espacio debe estar entre 5 y 240 minutos");
  }
  const template = str(formData, "reminder_template");
  if (template.length < 10) return fail("Escribe el mensaje de recordatorio de la cita");
  if (template.length > 1000) return fail("El mensaje es demasiado largo (máximo 1000 caracteres)");

  const supabase = await createClient();
  const { error } = await supabase
    .from("agenda_settings")
    .update({ slot_minutes: slot, allow_overlap: checked(formData, "allow_overlap"), reminder_template: template })
    .eq("organization_id", ctx.org.id);
  if (error) return fail(dbError(error, "No se pudo guardar"));

  await logActivity(ctx, "Cambió los ajustes de la agenda");
  refresh();
  return ok("Ajustes guardados");
}

/** Agrega una franja de atención a uno o varios días de la semana. */
export async function addAgendaHours(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("settings.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const days = formData
    .getAll("days")
    .map((d) => Number(d))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  if (days.length === 0) return fail("Elige al menos un día");

  const start = str(formData, "starts_at");
  const end = str(formData, "ends_at");
  if (!isTime(start) || !isTime(end)) return fail("Escribe la hora de inicio y la de fin");
  if (minutesOf(end) <= minutesOf(start)) return fail("La hora de fin debe ser después de la de inicio");

  const supabase = await createClient();
  const { data: existing } = await supabase.from("agenda_hours").select("weekday, starts_at, ends_at").in("weekday", days);
  for (const day of days) {
    const ranges = (existing ?? [])
      .filter((h) => h.weekday === day)
      .map((h) => ({ start: trimTime(h.starts_at as string), end: trimTime(h.ends_at as string) }));
    if (hasOverlappingRanges([...ranges, { start, end }])) {
      return fail("La franja se cruza con otra que ya existe ese día. Quita la anterior o elige otra hora.");
    }
  }

  const { error } = await supabase
    .from("agenda_hours")
    .insert(days.map((weekday) => ({ organization_id: ctx.org.id, weekday, starts_at: start, ends_at: end })));
  if (error) return fail(dbError(error, "No se pudo guardar el horario"));

  await logActivity(ctx, "Agregó una franja de atención", { detail: `${start}–${end}` });
  refresh();
  return ok("Horario agregado");
}

export async function deleteAgendaHours(hourId: string): Promise<ActionResult> {
  const g = await guard("settings.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const supabase = await createClient();
  const { error } = await supabase.from("agenda_hours").delete().eq("id", hourId).eq("organization_id", ctx.org.id);
  if (error) return fail(dbError(error, "No se pudo quitar la franja"));

  await logActivity(ctx, "Quitó una franja de atención");
  refresh();
  return ok("Franja quitada");
}

/** Bloquea un periodo (festivo, vacaciones, una cirugía larga...). */
export async function addAgendaBlock(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("settings.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const fromDate = str(formData, "from_date");
  const toDate = str(formData, "to_date") || fromDate;
  const allDay = checked(formData, "all_day");
  const fromTime = allDay ? "00:00" : str(formData, "from_time") || "00:00";
  const toTime = allDay ? "23:59" : str(formData, "to_time") || "23:59";
  const reason = str(formData, "reason");

  if (!isIsoDate(fromDate) || !isIsoDate(toDate)) return fail("Elige las fechas del bloqueo");
  if (!isTime(fromTime) || !isTime(toTime)) return fail("Las horas no son válidas");
  if (reason.length < 3) return fail("Escribe el motivo del bloqueo");

  const start = zonedToUtc(fromDate, fromTime, ctx.tz);
  // 23:59 como "todo el día" se extiende hasta el final del minuto.
  const end = new Date(zonedToUtc(toDate, toTime, ctx.tz).getTime() + (toTime === "23:59" ? 59_999 : 0));
  if (end <= start) return fail("El fin del bloqueo debe ser después del inicio");

  const supabase = await createClient();
  const { error } = await supabase
    .from("agenda_blocks")
    .insert({ organization_id: ctx.org.id, starts_at: start.toISOString(), ends_at: end.toISOString(), reason });
  if (error) return fail(dbError(error, "No se pudo guardar el bloqueo"));

  await logActivity(ctx, "Bloqueó un periodo de la agenda", { detail: reason });
  refresh();
  return ok("Bloqueo agregado");
}

export async function deleteAgendaBlock(blockId: string): Promise<ActionResult> {
  const g = await guard("settings.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const supabase = await createClient();
  const { error } = await supabase.from("agenda_blocks").delete().eq("id", blockId).eq("organization_id", ctx.org.id);
  if (error) return fail(dbError(error, "No se pudo quitar el bloqueo"));

  await logActivity(ctx, "Quitó un bloqueo de la agenda");
  refresh();
  return ok("Bloqueo quitado");
}
