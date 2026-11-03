"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { checked, dbError, fail, ok, optStr, str, type ActionResult } from "@/lib/action-result";
import { logActivity } from "@/lib/activity";
import { can, guard, hasModule } from "@/lib/auth";
import { loadCustomFieldDefs } from "@/lib/custom-fields-server";
import { readCustomFieldInputs, validateCustomFields } from "@/lib/logic/custom-fields";
import { normalizePhone } from "@/lib/logic/reminders";
import { missingTutorMessage } from "@/lib/logic/tutor";
import { createClient } from "@/lib/supabase/server";

interface TutorInput {
  row: Record<string, unknown>;
}

async function readTutor(formData: FormData, existing?: { contact_consent: boolean }): Promise<TutorInput | { error: string }> {
  const fullName = str(formData, "full_name");
  if (fullName.length < 2) return { error: "Escribe el nombre del tutor" };

  // Los demás datos son opcionales: si faltan, se avisa pero no se bloquea.
  const document = optStr(formData, "document_number");
  if (document && (document.length < 4 || document.length > 20)) {
    return { error: "La cédula debe tener entre 4 y 20 caracteres (o déjala vacía)" };
  }

  const whatsapp = optStr(formData, "whatsapp");
  if (whatsapp && !normalizePhone(whatsapp)) {
    return { error: "El WhatsApp no es válido. Usa el número con 10 dígitos, por ejemplo 3001234567" };
  }
  const email = optStr(formData, "email");
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "El correo no es válido" };

  const defs = await loadCustomFieldDefs("tutor");
  const custom = validateCustomFields(defs, readCustomFieldInputs(formData, defs));
  if (custom.errors.length) return { error: custom.errors[0] };

  // El consentimiento de datos NO se marca aquí: se registra con la firma de
  // la autorización (en pantalla o en físico) para que quede evidencia.
  const contactConsent = checked(formData, "contact_consent");
  const now = new Date().toISOString();

  return {
    row: {
      full_name: fullName,
      document_number: document,
      phone: optStr(formData, "phone"),
      whatsapp: whatsapp ? normalizePhone(whatsapp) : null,
      email,
      address: optStr(formData, "address"),
      neighborhood: optStr(formData, "neighborhood"),
      city: optStr(formData, "city"),
      notes: optStr(formData, "notes"),
      custom_fields: custom.values,
      contact_consent: contactConsent,
      ...(contactConsent && !existing?.contact_consent ? { contact_consent_at: now } : {}),
      ...(!contactConsent && existing?.contact_consent ? { contact_consent_at: null } : {}),
    },
  };
}

export async function createTutor(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("tutors.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const parsed = await readTutor(formData);
  if ("error" in parsed) return fail(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tutors")
    .insert({ ...parsed.row, organization_id: ctx.org.id })
    .select("id")
    .single();
  if (error || !data) {
    if (error?.code === "23505") return fail("Ya existe un tutor con esa cédula");
    return fail(dbError(error, "No se pudo crear el tutor"));
  }

  await logActivity(ctx, "Creó un tutor", { entity: "tutor", entityId: data.id, detail: String(parsed.row.full_name) });
  revalidatePath("/dashboard/tutores");
  // Siguiente paso obligatorio: la autorización de tratamiento de datos (si el
  // consultorio tiene ese módulo y el usuario puede gestionarla).
  const needsConsent = hasModule(ctx, "consents") && can(ctx, "consents.create");
  redirect(needsConsent ? `/dashboard/tutores/${data.id}/autorizacion` : `/dashboard/tutores/${data.id}`);
}

export async function updateTutor(tutorId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("tutors.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("tutors")
    .select("contact_consent, is_active")
    .eq("id", tutorId)
    .maybeSingle();
  if (!existing) return fail("No se encontró el tutor");

  const parsed = await readTutor(formData, existing);
  if ("error" in parsed) return fail(parsed.error);

  const { error } = await supabase.from("tutors").update(parsed.row).eq("id", tutorId).eq("organization_id", ctx.org.id);
  if (error) {
    if (error.code === "23505") return fail("Ya existe otro tutor con esa cédula");
    return fail(dbError(error, "No se pudo guardar"));
  }

  await logActivity(ctx, "Editó un tutor", { entity: "tutor", entityId: tutorId });
  revalidatePath(`/dashboard/tutores/${tutorId}`);
  revalidatePath("/dashboard/tutores");
  const note = missingTutorMessage({
    document_number: parsed.row.document_number as string | null,
    phone: parsed.row.phone as string | null,
    whatsapp: parsed.row.whatsapp as string | null,
    address: parsed.row.address as string | null,
    neighborhood: parsed.row.neighborhood as string | null,
  });
  return ok(note ? `Tutor actualizado. ${note}` : "Tutor actualizado");
}

/**
 * Supresión de datos personales (habeas data): borra los datos de contacto y
 * la cédula del tutor. Las historias clínicas de sus pacientes se conservan,
 * asociadas a un tutor anonimizado. Solo el administrador.
 */
export async function anonymizeTutor(tutorId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("tutors.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;
  if (ctx.profile.role !== "owner") return fail("Solo el administrador puede anonimizar datos personales.");
  if (str(formData, "confirm").toUpperCase() !== "ANONIMIZAR") return fail("Escribe ANONIMIZAR para confirmar");

  const supabase = await createClient();
  const { error } = await supabase
    .from("tutors")
    .update({
      full_name: "Tutor anonimizado",
      document_number: null,
      phone: null,
      whatsapp: null,
      email: null,
      address: null,
      neighborhood: null,
      city: null,
      notes: null,
      custom_fields: {},
      contact_consent: false,
      contact_consent_at: null,
      is_active: false,
    })
    .eq("id", tutorId)
    .eq("organization_id", ctx.org.id);
  if (error) return fail(dbError(error, "No se pudo anonimizar"));

  await logActivity(ctx, "Anonimizó los datos personales de un tutor", { entity: "tutor", entityId: tutorId });
  revalidatePath(`/dashboard/tutores/${tutorId}`);
  revalidatePath("/dashboard/tutores");
  return ok("Datos anonimizados");
}
