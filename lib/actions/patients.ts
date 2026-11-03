"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { dbError, fail, ok, optNum, optStr, str, type ActionResult } from "@/lib/action-result";
import { logActivity } from "@/lib/activity";
import { guard, hasModule } from "@/lib/auth";
import { loadCustomFieldDefs } from "@/lib/custom-fields-server";
import { deleteStoredFile, storeUpload } from "@/lib/files";
import { readCustomFieldInputs, validateCustomFields } from "@/lib/logic/custom-fields";
import { isIsoDate, todayISO } from "@/lib/logic/dates";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

async function readPatient(
  formData: FormData,
  today: string
): Promise<{ row: Record<string, unknown>; weight: number | null } | { error: string }> {
  const name = str(formData, "name");
  if (name.length < 1) return { error: "Escribe el nombre del paciente" };

  const speciesId = str(formData, "species_id");
  if (!speciesId) return { error: "Elige la especie" };

  const sex = str(formData, "sex") || "indeterminado";
  if (!["macho", "hembra", "indeterminado"].includes(sex)) return { error: "El sexo no es válido" };

  const birth = optStr(formData, "birth_date");
  if (birth) {
    if (!isIsoDate(birth)) return { error: "La fecha de nacimiento no es válida" };
    if (birth > today) return { error: "La fecha de nacimiento no puede ser futura" };
  }

  const sterilizedRaw = str(formData, "sterilized");
  const sterilized = sterilizedRaw === "si" ? true : sterilizedRaw === "no" ? false : null;

  const weight = optNum(formData, "weight_kg");
  if (weight === undefined || (weight !== null && (weight <= 0 || weight > 250))) {
    return { error: "El peso no es válido" };
  }

  const defs = await loadCustomFieldDefs("patient");
  const custom = validateCustomFields(defs, readCustomFieldInputs(formData, defs));
  if (custom.errors.length) return { error: custom.errors[0] };

  const breedId = optStr(formData, "breed_id");

  return {
    weight,
    row: {
      name,
      species_id: speciesId,
      breed_id: breedId,
      breed_text: breedId ? null : optStr(formData, "breed_text"),
      sex,
      color: optStr(formData, "color"),
      birth_date: birth,
      birth_date_approx: formData.get("birth_date_approx") === "on",
      microchip: optStr(formData, "microchip"),
      sterilized,
      allergies: optStr(formData, "allergies"),
      background: optStr(formData, "background"),
      custom_fields: custom.values,
    },
  };
}

export async function createPatient(tutorId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("patients.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const parsed = await readPatient(formData, ctx.today);
  if ("error" in parsed) return fail(parsed.error);

  const supabase = await createClient();

  // Con el módulo de autorizaciones activo, el tutor debe haber resuelto la
  // autorización de tratamiento de datos antes de registrar sus mascotas.
  if (hasModule(ctx, "consents")) {
    const { data: tutor } = await supabase.from("tutors").select("data_consent").eq("id", tutorId).maybeSingle();
    if (tutor && !tutor.data_consent) {
      return fail("Falta la autorización de tratamiento de datos del tutor. Resuélvela en su ficha antes de crear pacientes.");
    }
  }

  const { data, error } = await supabase
    .from("patients")
    .insert({ ...parsed.row, tutor_id: tutorId, organization_id: ctx.org.id })
    .select("id")
    .single();
  if (error || !data) return fail(dbError(error, "No se pudo crear el paciente"));

  if (parsed.weight) {
    await supabase.from("patient_weights").insert({
      organization_id: ctx.org.id,
      patient_id: data.id,
      weight_kg: parsed.weight,
      measured_at: ctx.today,
    });
  }

  await logActivity(ctx, "Creó un paciente", { entity: "patient", entityId: data.id, detail: String(parsed.row.name) });
  revalidatePath(`/dashboard/tutores/${tutorId}`);
  revalidatePath("/dashboard/pacientes");
  redirect(`/dashboard/pacientes/${data.id}`);
}

export async function updatePatient(patientId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("patients.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const parsed = await readPatient(formData, ctx.today);
  if ("error" in parsed) return fail(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.from("patients").update(parsed.row).eq("id", patientId).eq("organization_id", ctx.org.id);
  if (error) return fail(dbError(error, "No se pudo guardar"));

  await logActivity(ctx, "Editó un paciente", { entity: "patient", entityId: patientId });
  revalidatePath(`/dashboard/pacientes/${patientId}`);
  return ok("Paciente actualizado");
}

export async function markDeceased(patientId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("patients.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const date = str(formData, "deceased_at") || ctx.today;
  if (!isIsoDate(date) || date > ctx.today) return fail("La fecha no es válida");

  const supabase = await createClient();
  const { error } = await supabase
    .from("patients")
    .update({ status: "fallecido", deceased_at: date, deceased_reason: optStr(formData, "deceased_reason") })
    .eq("id", patientId)
    .eq("organization_id", ctx.org.id);
  if (error) return fail(dbError(error, "No se pudo guardar"));

  // Un paciente fallecido ya no necesita recordatorios. Es un efecto derivado
  // de la acción (ya validada), por eso no depende del permiso de recordatorios.
  await createAdminClient()
    .from("reminders")
    .update({ status: "descartado", handled_at: new Date().toISOString() })
    .eq("organization_id", ctx.org.id)
    .eq("patient_id", patientId)
    .in("status", ["pendiente", "enviado"]);

  await logActivity(ctx, "Registró el fallecimiento de un paciente", { entity: "patient", entityId: patientId });
  revalidatePath(`/dashboard/pacientes/${patientId}`);
  return ok("Registrado");
}

export async function reactivatePatient(patientId: string, _prev: ActionResult, _formData: FormData): Promise<ActionResult> {
  const g = await guard("patients.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const supabase = await createClient();
  const { error } = await supabase
    .from("patients")
    .update({ status: "activo", deceased_at: null, deceased_reason: null })
    .eq("id", patientId)
    .eq("organization_id", ctx.org.id);
  if (error) return fail(dbError(error, "No se pudo guardar"));

  await logActivity(ctx, "Reactivó un paciente", { entity: "patient", entityId: patientId });
  revalidatePath(`/dashboard/pacientes/${patientId}`);
  return ok("Paciente activo");
}

export async function addWeight(patientId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("patients.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const weight = optNum(formData, "weight_kg");
  if (!weight || weight <= 0 || weight > 250) return fail("Escribe un peso válido en kilogramos");
  const date = str(formData, "measured_at") || todayISO(ctx.tz);
  if (!isIsoDate(date) || date > ctx.today) return fail("La fecha no es válida");

  const supabase = await createClient();
  const { error } = await supabase.from("patient_weights").insert({
    organization_id: ctx.org.id,
    patient_id: patientId,
    weight_kg: weight,
    measured_at: date,
    notes: optStr(formData, "notes"),
  });
  if (error) return fail(dbError(error, "No se pudo guardar el peso"));

  revalidatePath(`/dashboard/pacientes/${patientId}`);
  return ok("Peso registrado");
}

export async function deleteWeight(patientId: string, weightId: string, _prev: ActionResult, _formData: FormData): Promise<ActionResult> {
  const g = await guard("patients.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const supabase = await createClient();
  const { error } = await supabase.from("patient_weights").delete().eq("id", weightId).eq("organization_id", ctx.org.id);
  if (error) return fail(dbError(error, "No se pudo eliminar"));

  await logActivity(ctx, "Eliminó un registro de peso", { entity: "patient", entityId: patientId });
  revalidatePath(`/dashboard/pacientes/${patientId}`);
  return ok("Eliminado");
}

export async function uploadPatientPhoto(patientId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("patients.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;
  if (!ctx.permissions.has("files.upload")) return fail("No tienes permiso para subir archivos.");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("Elige una foto");

  const supabase = await createClient();
  const { data: patient } = await supabase
    .from("patients")
    .select("id, photo_file_id")
    .eq("id", patientId)
    .maybeSingle();
  if (!patient) return fail("No se encontró el paciente");

  const stored = await storeUpload(file, {
    orgId: ctx.org.id,
    userId: ctx.userId,
    kind: "patient_photo",
    allowPdf: false,
    allowImage: true,
  });
  if (!stored.ok) return fail(stored.error);

  const { error } = await supabase
    .from("patients")
    .update({ photo_file_id: stored.fileId })
    .eq("id", patientId)
    .eq("organization_id", ctx.org.id);
  if (error) {
    await deleteStoredFile(stored.fileId, ctx.org.id, ctx.userId);
    return fail(dbError(error, "No se pudo guardar la foto"));
  }
  if (patient.photo_file_id) await deleteStoredFile(patient.photo_file_id as string, ctx.org.id, ctx.userId);

  revalidatePath(`/dashboard/pacientes/${patientId}`);
  return ok("Foto actualizada");
}
