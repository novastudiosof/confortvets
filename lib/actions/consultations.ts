"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { dbError, fail, ok, optNum, optStr, str, type ActionResult } from "@/lib/action-result";
import { logActivity } from "@/lib/activity";
import { guard } from "@/lib/auth";
import { loadCustomFieldDefs } from "@/lib/custom-fields-server";
import { deleteStoredFile, storeUpload } from "@/lib/files";
import { readCustomFieldInputs, validateCustomFields } from "@/lib/logic/custom-fields";
import { isIsoDate } from "@/lib/logic/dates";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function professionalName(ctx: { settings: { professional_name: string | null }; profile: { full_name: string } }): string {
  return ctx.settings.professional_name?.trim() || ctx.profile.full_name;
}

export async function startConsultation(
  patientId: string,
  kind: "consulta" | "control",
  _prev: ActionResult,
  _formData: FormData
): Promise<ActionResult> {
  const g = await guard("clinical.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const supabase = await createClient();
  const { data: patient } = await supabase.from("patients").select("id").eq("id", patientId).maybeSingle();
  if (!patient) return fail("No se encontró el paciente");

  // Un control se enlaza con la última consulta cerrada del paciente.
  let parentId: string | null = null;
  if (kind === "control") {
    const { data: last } = await supabase
      .from("consultations")
      .select("id")
      .eq("patient_id", patientId)
      .eq("kind", "consulta")
      .eq("status", "cerrada")
      .order("consulted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    parentId = (last?.id as string | undefined) ?? null;
  }

  const { data, error } = await supabase
    .from("consultations")
    .insert({
      organization_id: ctx.org.id,
      patient_id: patientId,
      kind,
      parent_consultation_id: parentId,
      professional_name: professionalName(ctx),
    })
    .select("id")
    .single();
  if (error || !data) return fail(dbError(error, "No se pudo crear la consulta"));

  await logActivity(ctx, kind === "consulta" ? "Inició una consulta" : "Inició un control", {
    entity: "consultation",
    entityId: data.id,
  });
  revalidatePath(`/dashboard/pacientes/${patientId}`);
  redirect(`/dashboard/consultas/${data.id}`);
}

function intField(formData: FormData, name: string, label: string, min: number, max: number): { value: number | null } | { error: string } {
  const n = optNum(formData, name);
  if (n === undefined) return { error: `${label} no es válido` };
  if (n === null) return { value: null };
  if (!Number.isInteger(n) || n < min || n > max) return { error: `${label} debe estar entre ${min} y ${max}` };
  return { value: n };
}

/** Lee y valida los campos clínicos del formulario de una consulta. */
async function parseConsultationFields(
  formData: FormData,
  today: string,
  allowPastControl: boolean
): Promise<{ row: Record<string, unknown>; weight: number | null } | { error: string }> {
  const weight = optNum(formData, "weight_kg");
  if (weight === undefined || (weight !== null && (weight <= 0 || weight > 250))) return { error: "El peso no es válido" };
  const temperature = optNum(formData, "temperature_c");
  if (temperature === undefined || (temperature !== null && (temperature < 20 || temperature > 50))) {
    return { error: "La temperatura no es válida (°C)" };
  }
  const heartRate = intField(formData, "heart_rate", "La frecuencia cardiaca", 0, 400);
  if ("error" in heartRate) return { error: heartRate.error };
  const respRate = intField(formData, "resp_rate", "La frecuencia respiratoria", 0, 200);
  if ("error" in respRate) return { error: respRate.error };
  const bodyCondition = intField(formData, "body_condition", "La condición corporal", 1, 9);
  if ("error" in bodyCondition) return { error: bodyCondition.error };
  const refill = optNum(formData, "capillary_refill_s");
  if (refill === undefined || (refill !== null && (refill < 0 || refill > 30))) return { error: "El llenado capilar no es válido" };

  const nextControl = optStr(formData, "next_control_date");
  if (nextControl && !isIsoDate(nextControl)) return { error: "La fecha del próximo control no es válida" };
  if (nextControl && !allowPastControl && nextControl < today) {
    return { error: "La fecha del próximo control debe ser hoy o futura" };
  }

  const defs = await loadCustomFieldDefs("consultation");
  const custom = validateCustomFields(defs, readCustomFieldInputs(formData, defs));
  if (custom.errors.length) return { error: custom.errors[0] };

  return {
    weight,
    row: {
      reason: optStr(formData, "reason"),
      anamnesis: optStr(formData, "anamnesis"),
      weight_kg: weight,
      temperature_c: temperature,
      heart_rate: heartRate.value,
      resp_rate: respRate.value,
      mucous_membranes: optStr(formData, "mucous_membranes"),
      capillary_refill_s: refill,
      hydration: optStr(formData, "hydration"),
      body_condition: bodyCondition.value,
      differential_diagnoses: optStr(formData, "differential_diagnoses"),
      exams_notes: optStr(formData, "exams_notes"),
      definitive_diagnosis: optStr(formData, "definitive_diagnosis"),
      treatment: optStr(formData, "treatment"),
      recommendations: optStr(formData, "recommendations"),
      control_type_id: optStr(formData, "control_type_id"),
      next_control_date: nextControl,
      custom_fields: custom.values,
    },
  };
}

/** Actualiza la curva de peso del paciente a partir del peso de la consulta. */
async function syncConsultationWeight(
  orgId: string,
  patientId: string,
  consultationId: string,
  weight: number | null,
  today: string,
  userId: string
): Promise<void> {
  // Es un efecto derivado de la consulta (ya validada), por eso usa la llave de servicio.
  const admin = createAdminClient();
  await admin.from("patient_weights").delete().eq("organization_id", orgId).eq("consultation_id", consultationId);
  if (weight) {
    await admin.from("patient_weights").insert({
      organization_id: orgId,
      patient_id: patientId,
      weight_kg: weight,
      measured_at: today,
      consultation_id: consultationId,
      created_by: userId,
    });
  }
}

export async function saveConsultation(consultationId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("clinical.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const supabase = await createClient();
  const { data: current } = await supabase
    .from("consultations")
    .select("id, kind, status, patient_id")
    .eq("id", consultationId)
    .maybeSingle();
  if (!current) return fail("No se encontró la consulta");
  if (current.status !== "borrador") return fail("La consulta ya está cerrada. Agrega una nota aclaratoria.");

  const intent = str(formData, "intent");

  const parsed = await parseConsultationFields(formData, ctx.today, false);
  if ("error" in parsed) return fail(parsed.error);
  const { row, weight } = parsed;
  const reason = row.reason as string | null;
  const anamnesis = row.anamnesis as string | null;
  const recommendations = row.recommendations as string | null;

  if (intent === "close") {
    if (current.kind === "consulta" && !reason) return fail("Escribe el motivo de consulta antes de cerrar");
    if (current.kind === "control" && !anamnesis && !recommendations) {
      return fail("Escribe la anamnesis o las recomendaciones antes de cerrar el control");
    }
  }
  if (intent === "close") row.status = "cerrada";

  const { data: updated, error } = await supabase
    .from("consultations")
    .update(row)
    .eq("id", consultationId)
    .eq("organization_id", ctx.org.id)
    .eq("status", "borrador")
    .select("id");
  if (error) return fail(dbError(error, "No se pudo guardar la consulta"));
  if (!updated || updated.length === 0) return fail("No se pudo guardar: la consulta ya no es un borrador");

  await syncConsultationWeight(ctx.org.id, current.patient_id as string, consultationId, weight, ctx.today, ctx.userId);

  if (intent === "close") {
    await logActivity(ctx, "Cerró una consulta", { entity: "consultation", entityId: consultationId });
  }
  revalidatePath(`/dashboard/consultas/${consultationId}`);
  revalidatePath(`/dashboard/pacientes/${current.patient_id}`);
  return ok(intent === "close" ? "Consulta cerrada" : "Borrador guardado");
}

/**
 * El administrador corrige una consulta ya cerrada. Exige un motivo y guarda la
 * versión anterior (consultation_revisions); la consulta sigue cerrada.
 */
export async function adminEditConsultation(consultationId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("clinical.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;
  if (ctx.profile.role !== "owner") return fail("Solo el administrador puede editar una historia cerrada.");

  const reason = str(formData, "edit_reason");
  if (reason.length < 5) return fail("Escribe el motivo de la corrección (mínimo 5 caracteres)");

  const parsed = await parseConsultationFields(formData, ctx.today, true);
  if ("error" in parsed) return fail(parsed.error);

  const supabase = await createClient();
  const { data: current } = await supabase.from("consultations").select("id, patient_id, status").eq("id", consultationId).maybeSingle();
  if (!current) return fail("No se encontró la consulta");
  if (current.status !== "cerrada") return fail("Solo se editan consultas cerradas.");

  const { error } = await supabase.rpc("consultation_admin_edit", {
    p_consultation: consultationId,
    p_changes: parsed.row,
    p_reason: reason,
  });
  if (error) return fail(dbError(error, "No se pudo guardar la corrección"));

  await syncConsultationWeight(ctx.org.id, current.patient_id as string, consultationId, parsed.weight, ctx.today, ctx.userId);
  await logActivity(ctx, "Corrigió una historia cerrada", { entity: "consultation", entityId: consultationId, detail: reason });
  revalidatePath(`/dashboard/consultas/${consultationId}`);
  revalidatePath(`/dashboard/pacientes/${current.patient_id}`);
  redirect(`/dashboard/consultas/${consultationId}`);
}

export async function voidConsultation(consultationId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("clinical.void");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const reason = str(formData, "reason");
  if (reason.length < 5) return fail("Escribe el motivo de la anulación (mínimo 5 caracteres)");

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("consultations")
    .update({ status: "anulada", void_reason: reason })
    .eq("id", consultationId)
    .eq("organization_id", ctx.org.id)
    .neq("status", "anulada")
    .select("id, patient_id");
  if (error) return fail(dbError(error, "No se pudo anular la consulta"));
  if (!updated || updated.length === 0) return fail("La consulta no se pudo anular");

  await logActivity(ctx, "Anuló una consulta", { entity: "consultation", entityId: consultationId, detail: reason });
  revalidatePath(`/dashboard/consultas/${consultationId}`);
  revalidatePath(`/dashboard/pacientes/${updated[0].patient_id}`);
  return ok("Consulta anulada");
}

export async function addAddendum(consultationId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("clinical.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const content = str(formData, "content");
  if (content.length < 3) return fail("Escribe la nota aclaratoria");

  const supabase = await createClient();
  const { error } = await supabase.from("consultation_addenda").insert({
    organization_id: ctx.org.id,
    consultation_id: consultationId,
    content: content.slice(0, 4000),
    author_name: professionalName(ctx),
  });
  if (error) return fail(dbError(error, "No se pudo guardar la nota"));

  await logActivity(ctx, "Agregó una nota aclaratoria", { entity: "consultation", entityId: consultationId });
  revalidatePath(`/dashboard/consultas/${consultationId}`);
  return ok("Nota agregada");
}

// ---------------------------------------------------------------------------
// Exámenes complementarios (PDF o imagen)
// ---------------------------------------------------------------------------
export async function uploadExam(consultationId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("clinical.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;
  if (!ctx.permissions.has("files.upload")) return fail("No tienes permiso para subir archivos.");

  const examName = str(formData, "exam_name");
  if (examName.length < 2) return fail("Escribe el nombre del examen");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("Elige el archivo del resultado");

  const supabase = await createClient();
  const { data: consultation } = await supabase
    .from("consultations")
    .select("id, patient_id, status")
    .eq("id", consultationId)
    .maybeSingle();
  if (!consultation) return fail("No se encontró la consulta");
  if (consultation.status === "anulada") return fail("La consulta está anulada");

  const stored = await storeUpload(file, {
    orgId: ctx.org.id,
    userId: ctx.userId,
    kind: "exam",
    allowPdf: true,
    allowImage: true,
  });
  if (!stored.ok) return fail(stored.error);

  const { error } = await supabase.from("exam_files").insert({
    organization_id: ctx.org.id,
    consultation_id: consultationId,
    patient_id: consultation.patient_id,
    file_id: stored.fileId,
    exam_name: examName,
    notes: optStr(formData, "notes"),
  });
  if (error) {
    await deleteStoredFile(stored.fileId, ctx.org.id, ctx.userId);
    return fail(dbError(error, "No se pudo guardar el examen"));
  }

  await logActivity(ctx, "Subió un resultado de examen", { entity: "consultation", entityId: consultationId, detail: examName });
  revalidatePath(`/dashboard/consultas/${consultationId}`);
  return ok("Examen agregado");
}

/** Solo se quita un examen mientras la consulta es borrador; después queda en la historia. */
export async function deleteExam(consultationId: string, examId: string, _prev: ActionResult, _formData: FormData): Promise<ActionResult> {
  const g = await guard("clinical.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const supabase = await createClient();
  const { data: consultation } = await supabase.from("consultations").select("status").eq("id", consultationId).maybeSingle();
  if (!consultation) return fail("No se encontró la consulta");
  if (consultation.status !== "borrador") {
    return fail("La consulta ya está cerrada: los resultados quedan en la historia.");
  }

  const { data: exam } = await supabase
    .from("exam_files")
    .select("id, file_id")
    .eq("id", examId)
    .eq("consultation_id", consultationId)
    .maybeSingle();
  if (!exam) return fail("No se encontró el examen");

  await deleteStoredFile(exam.file_id as string, ctx.org.id, ctx.userId);
  await logActivity(ctx, "Quitó un resultado de examen", { entity: "consultation", entityId: consultationId });
  revalidatePath(`/dashboard/consultas/${consultationId}`);
  return ok("Examen quitado");
}

// ---------------------------------------------------------------------------
// Fórmula médica
// ---------------------------------------------------------------------------
export async function savePrescription(consultationId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("prescriptions.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const names = formData.getAll("med_name").map(String);
  const get = (field: string, i: number) => {
    const v = (formData.getAll(field)[i] ?? "").toString().trim();
    return v === "" ? null : v.slice(0, 500);
  };
  const items: Record<string, unknown>[] = [];
  names.forEach((rawName, i) => {
    const name = rawName.trim();
    if (!name) return;
    items.push({
      organization_id: ctx.org.id,
      medication_name: name.slice(0, 200),
      presentation: get("med_presentation", i),
      dose: get("med_dose", i),
      frequency: get("med_frequency", i),
      duration: get("med_duration", i),
      route: get("med_route", i),
      instructions: get("med_instructions", i),
      sort_order: items.length,
    });
  });
  if (items.length === 0) return fail("Agrega al menos un medicamento");
  if (items.length > 30) return fail("Una fórmula admite hasta 30 medicamentos");

  const supabase = await createClient();
  const { data: consultation } = await supabase
    .from("consultations")
    .select("id, patient_id, status")
    .eq("id", consultationId)
    .maybeSingle();
  if (!consultation) return fail("No se encontró la consulta");
  if (consultation.status !== "borrador") return fail("La consulta ya está cerrada: la fórmula no se puede modificar.");

  const notes = optStr(formData, "prescription_notes");
  let { data: prescription } = await supabase
    .from("prescriptions")
    .select("id")
    .eq("consultation_id", consultationId)
    .maybeSingle();

  if (!prescription) {
    const { data: created, error } = await supabase
      .from("prescriptions")
      .insert({
        organization_id: ctx.org.id,
        consultation_id: consultationId,
        patient_id: consultation.patient_id,
        professional_name: professionalName(ctx),
        notes,
      })
      .select("id")
      .single();
    if (error || !created) return fail(dbError(error, "No se pudo crear la fórmula"));
    prescription = created;
  } else {
    const { error } = await supabase.from("prescriptions").update({ notes }).eq("id", prescription.id);
    if (error) return fail(dbError(error, "No se pudo guardar la fórmula"));
  }

  // Inserta los nuevos medicamentos antes de borrar los anteriores: si algo
  // falla, la fórmula no queda vacía.
  const { data: previous } = await supabase.from("prescription_items").select("id").eq("prescription_id", prescription.id);
  const { error: insertError } = await supabase
    .from("prescription_items")
    .insert(items.map((it) => ({ ...it, prescription_id: prescription!.id })));
  if (insertError) return fail(dbError(insertError, "No se pudo guardar la fórmula"));

  const oldIds = (previous ?? []).map((p) => p.id as string);
  if (oldIds.length) await supabase.from("prescription_items").delete().in("id", oldIds);

  revalidatePath(`/dashboard/consultas/${consultationId}`);
  return ok("Fórmula guardada");
}
