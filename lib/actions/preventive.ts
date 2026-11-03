"use server";

import { revalidatePath } from "next/cache";

import { dbError, fail, ok, optNum, optStr, str, type ActionResult } from "@/lib/action-result";
import { logActivity } from "@/lib/activity";
import { guard } from "@/lib/auth";
import { addDays, isIsoDate } from "@/lib/logic/dates";
import { createClient } from "@/lib/supabase/server";

interface PreventiveFields {
  applied_at: string;
  lot: string | null;
  expires_at: string | null;
  next_due_at: string | null;
  weight_kg: number | null;
  temperature_c: number | null;
  general_state: string | null;
  notes: string | null;
}

/** Lee y valida los campos comunes de una vacuna o desparasitación. */
function readPreventive(
  formData: FormData,
  today: string,
  boosterDays: number | null
): { fields: PreventiveFields } | { error: string } {
  const applied = str(formData, "applied_at") || today;
  if (!isIsoDate(applied)) return { error: "La fecha de aplicación no es válida" };
  if (applied > today) return { error: "La fecha de aplicación no puede ser futura" };

  const expires = optStr(formData, "expires_at");
  if (expires) {
    if (!isIsoDate(expires)) return { error: "La fecha de vencimiento no es válida" };
    if (expires < applied) return { error: "El producto estaba vencido el día de la aplicación" };
  }

  let next = optStr(formData, "next_due_at");
  if (next) {
    if (!isIsoDate(next)) return { error: "La fecha del refuerzo no es válida" };
    if (next < applied) return { error: "El refuerzo no puede ser anterior a la aplicación" };
  } else if (boosterDays && formData.get("no_next") !== "on") {
    next = addDays(applied, boosterDays);
  }

  const weight = optNum(formData, "weight_kg");
  if (weight === undefined || (weight !== null && (weight <= 0 || weight > 250))) return { error: "El peso no es válido" };
  const temperature = optNum(formData, "temperature_c");
  if (temperature === undefined || (temperature !== null && (temperature < 20 || temperature > 50))) {
    return { error: "La temperatura no es válida (°C)" };
  }

  return {
    fields: {
      applied_at: applied,
      lot: optStr(formData, "lot"),
      expires_at: expires,
      next_due_at: next,
      weight_kg: weight,
      temperature_c: temperature,
      general_state: optStr(formData, "general_state"),
      notes: optStr(formData, "notes"),
    },
  };
}

async function patientIsActive(patientId: string): Promise<boolean | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("patients").select("status").eq("id", patientId).maybeSingle();
  if (!data) return null;
  return data.status === "activo";
}

export async function addVaccination(patientId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("preventive.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const active = await patientIsActive(patientId);
  if (active === null) return fail("No se encontró el paciente");
  if (!active) return fail("El paciente está registrado como fallecido");

  const supabase = await createClient();
  const vaccineId = optStr(formData, "vaccine_id");
  let name = optStr(formData, "vaccine_name");
  let boosterDays: number | null = null;
  if (vaccineId) {
    const { data: vaccine } = await supabase
      .from("vaccine_catalog")
      .select("name, default_booster_days")
      .eq("id", vaccineId)
      .maybeSingle();
    if (!vaccine) return fail("La vacuna elegida no existe");
    name = vaccine.name as string;
    boosterDays = (vaccine.default_booster_days as number | null) ?? null;
  }
  if (!name) return fail("Elige o escribe el nombre de la vacuna");

  const parsed = readPreventive(formData, ctx.today, boosterDays);
  if ("error" in parsed) return fail(parsed.error);

  const { error } = await supabase.from("vaccinations").insert({
    ...parsed.fields,
    organization_id: ctx.org.id,
    patient_id: patientId,
    vaccine_id: vaccineId,
    vaccine_name: name,
    applied_by_name: ctx.settings.professional_name?.trim() || ctx.profile.full_name,
  });
  if (error) return fail(dbError(error, "No se pudo registrar la vacuna"));

  await logActivity(ctx, "Registró una vacuna", { entity: "patient", entityId: patientId, detail: name });
  revalidatePath(`/dashboard/pacientes/${patientId}`);
  revalidatePath("/dashboard/pendientes");
  return ok("Vacuna registrada");
}

export async function voidVaccination(patientId: string, vaccinationId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("preventive.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const reason = str(formData, "reason");
  if (reason.length < 5) return fail("Escribe el motivo de la anulación (mínimo 5 caracteres)");

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("vaccinations")
    .update({ status: "anulada", void_reason: reason })
    .eq("id", vaccinationId)
    .eq("organization_id", ctx.org.id)
    .eq("status", "aplicada")
    .select("id");
  if (error) return fail(dbError(error, "No se pudo anular"));
  if (!updated || updated.length === 0) return fail("El registro ya estaba anulado");

  await logActivity(ctx, "Anuló una vacuna", { entity: "patient", entityId: patientId, detail: reason });
  revalidatePath(`/dashboard/pacientes/${patientId}`);
  revalidatePath("/dashboard/pendientes");
  return ok("Registro anulado");
}

export async function addDeworming(patientId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("preventive.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const active = await patientIsActive(patientId);
  if (active === null) return fail("No se encontró el paciente");
  if (!active) return fail("El paciente está registrado como fallecido");

  const kind = str(formData, "kind");
  if (kind !== "interna" && kind !== "externa") return fail("Elige si la desparasitación es interna o externa");

  const supabase = await createClient();
  const productId = optStr(formData, "product_id");
  let name = optStr(formData, "product_name");
  let boosterDays: number | null = null;
  if (productId) {
    const { data: product } = await supabase
      .from("deworming_products")
      .select("name, kind, default_booster_days")
      .eq("id", productId)
      .maybeSingle();
    if (!product) return fail("El producto elegido no existe");
    if (product.kind !== "ambas" && product.kind !== kind) {
      return fail(`Ese producto es de desparasitación ${product.kind}`);
    }
    name = product.name as string;
    boosterDays = (product.default_booster_days as number | null) ?? null;
  }
  if (!name) return fail("Elige o escribe el nombre del producto");

  const parsed = readPreventive(formData, ctx.today, boosterDays);
  if ("error" in parsed) return fail(parsed.error);

  const { error } = await supabase.from("dewormings").insert({
    ...parsed.fields,
    organization_id: ctx.org.id,
    patient_id: patientId,
    kind,
    product_id: productId,
    product_name: name,
    applied_by_name: ctx.settings.professional_name?.trim() || ctx.profile.full_name,
  });
  if (error) return fail(dbError(error, "No se pudo registrar la desparasitación"));

  await logActivity(ctx, "Registró una desparasitación", { entity: "patient", entityId: patientId, detail: `${kind}: ${name}` });
  revalidatePath(`/dashboard/pacientes/${patientId}`);
  revalidatePath("/dashboard/pendientes");
  return ok("Desparasitación registrada");
}

export async function voidDeworming(patientId: string, dewormingId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("preventive.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const reason = str(formData, "reason");
  if (reason.length < 5) return fail("Escribe el motivo de la anulación (mínimo 5 caracteres)");

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("dewormings")
    .update({ status: "anulada", void_reason: reason })
    .eq("id", dewormingId)
    .eq("organization_id", ctx.org.id)
    .eq("status", "aplicada")
    .select("id");
  if (error) return fail(dbError(error, "No se pudo anular"));
  if (!updated || updated.length === 0) return fail("El registro ya estaba anulado");

  await logActivity(ctx, "Anuló una desparasitación", { entity: "patient", entityId: patientId, detail: reason });
  revalidatePath(`/dashboard/pacientes/${patientId}`);
  revalidatePath("/dashboard/pendientes");
  return ok("Registro anulado");
}

// ---------------------------------------------------------------------------
// Recordatorios
// ---------------------------------------------------------------------------
const REMINDER_STATUSES = ["enviado", "hecho", "descartado", "pendiente"] as const;

/** Cambia el estado de un recordatorio (se llama desde la pantalla de pendientes). */
export async function setReminderStatus(
  reminderId: string,
  status: (typeof REMINDER_STATUSES)[number],
  message?: string
): Promise<ActionResult> {
  const g = await guard("reminders.manage");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;
  if (!REMINDER_STATUSES.includes(status)) return fail("Estado no válido");

  const now = new Date().toISOString();
  const patch: Record<string, unknown> =
    status === "enviado"
      ? { status, sent_at: now, sent_by: ctx.userId, message_sent: (message ?? "").slice(0, 2000) || null }
      : status === "pendiente"
        ? { status, handled_at: null }
        : { status, handled_at: now };

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("reminders")
    .update(patch)
    .eq("id", reminderId)
    .eq("organization_id", ctx.org.id)
    .select("id");
  if (error) return fail(dbError(error, "No se pudo actualizar el recordatorio"));
  if (!updated || updated.length === 0) return fail("No se encontró el recordatorio");

  revalidatePath("/dashboard/pendientes");
  revalidatePath("/dashboard", "layout");
  return ok("Actualizado");
}
