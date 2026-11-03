"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { dbError, fail, ok, optStr, str, type ActionResult } from "@/lib/action-result";
import { logActivity } from "@/lib/activity";
import { guard } from "@/lib/auth";
import { decodeSignatureDataUrl, deleteStoredFile, storeUpload } from "@/lib/files";
import { formatDate } from "@/lib/logic/dates";
import { MAX_SIGNATURE_BYTES } from "@/lib/logic/storage";
import { renderTemplate, type TemplateVars } from "@/lib/logic/templates";
import { createClient } from "@/lib/supabase/server";

interface ConsentContext {
  tutor: { full_name: string; document_number: string | null };
  patient: { name: string; species: string } | null;
}

function buildVars(
  ctx: { settings: { business_name: string; professional_name: string | null; phone: string | null }; profile: { full_name: string }; today: string; tz: string },
  data: ConsentContext,
  procedure: string | null
): TemplateVars {
  return {
    tutor: data.tutor.full_name,
    documento: data.tutor.document_number ?? "",
    paciente: data.patient?.name ?? "",
    especie: data.patient?.species ?? "",
    clinica: ctx.settings.business_name,
    profesional: ctx.settings.professional_name?.trim() || ctx.profile.full_name,
    procedimiento: procedure ?? "",
    fecha: formatDate(ctx.today, ctx.tz),
    telefono_clinica: ctx.settings.phone ?? "",
  };
}

async function loadConsentContext(tutorId: string, patientId: string | null): Promise<ConsentContext | null> {
  const supabase = await createClient();
  const { data: tutor } = await supabase.from("tutors").select("full_name, document_number").eq("id", tutorId).maybeSingle();
  if (!tutor) return null;

  let patient: ConsentContext["patient"] = null;
  if (patientId) {
    const { data: p } = await supabase.from("patients").select("name, species_id, tutor_id").eq("id", patientId).maybeSingle();
    if (!p || p.tutor_id !== tutorId) return null;
    const { data: species } = await supabase.from("species").select("name").eq("id", p.species_id).maybeSingle();
    patient = { name: p.name as string, species: (species?.name as string | undefined) ?? "" };
  }
  return { tutor: tutor as ConsentContext["tutor"], patient };
}

/** Crea una autorización pendiente con el texto de la plantilla ya completado. */
export async function createConsent(
  tutorId: string,
  patientId: string | null,
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const g = await guard("consents.create");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const templateId = str(formData, "template_id");
  if (!templateId) return fail("Elige el tipo de autorización");

  const supabase = await createClient();
  const { data: template } = await supabase
    .from("consent_templates")
    .select("id, kind, title, body, version, is_active")
    .eq("id", templateId)
    .maybeSingle();
  if (!template || !template.is_active) return fail("La plantilla no está disponible");

  if (template.kind !== "datos" && !patientId) return fail("Esta autorización necesita un paciente");

  const data = await loadConsentContext(tutorId, template.kind === "datos" ? null : patientId);
  if (!data) return fail("No se encontró el tutor o el paciente");

  const procedure = optStr(formData, "procedure_description");
  if ((template.kind === "anestesia" || template.kind === "procedimiento") && !procedure) {
    return fail("Describe el procedimiento");
  }

  const { data: created, error } = await supabase
    .from("consents")
    .insert({
      organization_id: ctx.org.id,
      kind: template.kind,
      template_id: template.id,
      template_version: template.version,
      patient_id: template.kind === "datos" ? null : patientId,
      tutor_id: tutorId,
      title: template.title,
      body: renderTemplate(template.body as string, buildVars(ctx, data, procedure)),
      procedure_description: procedure,
    })
    .select("id")
    .single();
  if (error || !created) return fail(dbError(error, "No se pudo crear la autorización"));

  await logActivity(ctx, "Creó una autorización", { entity: "consent", entityId: created.id, detail: template.title as string });
  revalidatePath("/dashboard/autorizaciones");
  redirect(`/dashboard/autorizaciones/${created.id}`);
}

/** Cambia la descripción del procedimiento mientras la autorización siga pendiente. */
export async function updateConsentProcedure(consentId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("consents.create");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const procedure = optStr(formData, "procedure_description");
  const supabase = await createClient();
  const { data: consent } = await supabase
    .from("consents")
    .select("id, status, template_id, tutor_id, patient_id")
    .eq("id", consentId)
    .maybeSingle();
  if (!consent) return fail("No se encontró la autorización");
  if (consent.status !== "pendiente") return fail("La autorización ya fue resuelta");
  if (!consent.template_id) return fail("La autorización no tiene plantilla");

  const { data: template } = await supabase.from("consent_templates").select("body").eq("id", consent.template_id).maybeSingle();
  const data = await loadConsentContext(consent.tutor_id as string, (consent.patient_id as string | null) ?? null);
  if (!template || !data) return fail("No se pudo actualizar el texto");

  const { error } = await supabase
    .from("consents")
    .update({
      procedure_description: procedure,
      body: renderTemplate(template.body as string, buildVars(ctx, data, procedure)),
    })
    .eq("id", consentId)
    .eq("organization_id", ctx.org.id)
    .eq("status", "pendiente");
  if (error) return fail(dbError(error, "No se pudo guardar"));

  revalidatePath(`/dashboard/autorizaciones/${consentId}`);
  return ok("Procedimiento actualizado");
}

async function clientEvidence(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  return {
    ip: h.get("x-nf-client-connection-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
  };
}

function readSigner(formData: FormData): { name: string; document: string } | { error: string } {
  const name = str(formData, "signer_name");
  const document = str(formData, "signer_document");
  if (name.length < 3) return { error: "Escribe el nombre completo de quien firma" };
  if (document.length < 4) return { error: "Escribe la cédula de quien firma" };
  if (formData.get("accepted") !== "on") {
    return { error: "Marca la casilla de confirmación para poder continuar" };
  }
  return { name, document };
}

/** Si el formulario trae un destino interno ("next"), se va allí al firmar. */
function redirectAfterSign(formData: FormData): void {
  const next = str(formData, "next");
  if (next.startsWith("/dashboard/") && !next.startsWith("//")) redirect(next);
}

/**
 * Deja lista la autorización de datos de un tutor: reutiliza la pendiente o
 * crea una nueva con la plantilla activa, y lleva a la pantalla de firma.
 */
export async function startDataConsent(tutorId: string, _prev: ActionResult, _formData: FormData): Promise<ActionResult> {
  const g = await guard("consents.create");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;
  const supabase = await createClient();

  const { data: pending } = await supabase
    .from("consents")
    .select("id")
    .eq("tutor_id", tutorId)
    .eq("kind", "datos")
    .eq("status", "pendiente")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pending) redirect(`/dashboard/tutores/${tutorId}/autorizacion`);

  const { data: template } = await supabase
    .from("consent_templates")
    .select("id, kind, title, body, version")
    .eq("kind", "datos")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!template) return fail("No hay un texto activo para la autorización de datos. Actívalo en Configuración → Textos de autorizaciones.");

  const data = await loadConsentContext(tutorId, null);
  if (!data) return fail("No se encontró el tutor");

  const { data: created, error } = await supabase
    .from("consents")
    .insert({
      organization_id: ctx.org.id,
      kind: "datos",
      template_id: template.id,
      template_version: template.version,
      patient_id: null,
      tutor_id: tutorId,
      title: template.title,
      body: renderTemplate(template.body as string, buildVars(ctx, data, null)),
    })
    .select("id")
    .single();
  if (error || !created) return fail(dbError(error, "No se pudo preparar la autorización"));

  await logActivity(ctx, "Creó una autorización", { entity: "consent", entityId: created.id, detail: template.title as string });
  revalidatePath(`/dashboard/tutores/${tutorId}`);
  redirect(`/dashboard/tutores/${tutorId}/autorizacion`);
}

/** Firma dibujada en pantalla (tablet o celular). */
export async function signConsentOnScreen(consentId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("consents.sign");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const signer = readSigner(formData);
  if ("error" in signer) return fail(signer.error);

  const bytes = decodeSignatureDataUrl(str(formData, "signature"), MAX_SIGNATURE_BYTES * 4);
  if (!bytes) return fail("Falta la firma. Dibújala en el recuadro.");

  const supabase = await createClient();
  const { data: consent } = await supabase.from("consents").select("id, status").eq("id", consentId).maybeSingle();
  if (!consent) return fail("No se encontró la autorización");
  if (consent.status !== "pendiente") return fail("La autorización ya fue resuelta");

  const stored = await storeUpload(
    { bytes, name: `firma-${consentId}.png`, type: "image/png" },
    { orgId: ctx.org.id, userId: ctx.userId, kind: "signature", allowPdf: false, allowImage: true }
  );
  if (!stored.ok) {
    console.error("[firma en pantalla] no se pudo guardar la imagen:", stored.error);
    return fail(stored.error);
  }

  const evidence = await clientEvidence();
  const { data: updated, error } = await supabase
    .from("consents")
    .update({
      status: "firmada",
      signature_method: "pantalla",
      signature_file_id: stored.fileId,
      signer_name: signer.name,
      signer_document: signer.document,
      signer_ip: evidence.ip,
      signer_user_agent: evidence.userAgent,
    })
    .eq("id", consentId)
    .eq("organization_id", ctx.org.id)
    .eq("status", "pendiente")
    .select("id");
  if (error || !updated || updated.length === 0) {
    console.error("[firma en pantalla] no se pudo actualizar la autorización:", error?.code, error?.message);
    await deleteStoredFile(stored.fileId, ctx.org.id, ctx.userId);
    return fail(dbError(error, "No se pudo registrar la firma"));
  }

  await logActivity(ctx, "Registró una firma en pantalla", { entity: "consent", entityId: consentId });
  revalidatePath(`/dashboard/autorizaciones/${consentId}`);
  revalidatePath("/dashboard/autorizaciones");
  revalidatePath("/dashboard/tutores");
  redirectAfterSign(formData);
  return ok("Autorización firmada");
}

/**
 * Autorización firmada en papel. La copia (foto o PDF) es opcional: con ella
 * queda como "archivo", sin ella como "fisico" (evidencia más débil).
 */
export async function signConsentOnPaper(consentId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("consents.sign");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const signer = readSigner(formData);
  if ("error" in signer) return fail(signer.error);
  const file = formData.get("file");
  const hasFile = file instanceof File && file.size > 0;
  if (hasFile && !ctx.permissions.has("files.upload")) return fail("No tienes permiso para subir archivos.");

  const supabase = await createClient();
  const { data: consent } = await supabase.from("consents").select("id, status").eq("id", consentId).maybeSingle();
  if (!consent) return fail("No se encontró la autorización");
  if (consent.status !== "pendiente") return fail("La autorización ya fue resuelta");

  let uploadFileId: string | null = null;
  if (hasFile) {
    const stored = await storeUpload(file, {
      orgId: ctx.org.id,
      userId: ctx.userId,
      kind: "consent_upload",
      allowPdf: true,
      allowImage: true,
    });
    if (!stored.ok) {
      console.error("[firma en papel] no se pudo guardar el archivo:", stored.error);
      return fail(stored.error);
    }
    uploadFileId = stored.fileId;
  }

  const evidence = await clientEvidence();
  const { data: updated, error } = await supabase
    .from("consents")
    .update({
      status: "firmada",
      signature_method: uploadFileId ? "archivo" : "fisico",
      upload_file_id: uploadFileId,
      signer_name: signer.name,
      signer_document: signer.document,
      signer_ip: evidence.ip,
      signer_user_agent: evidence.userAgent,
    })
    .eq("id", consentId)
    .eq("organization_id", ctx.org.id)
    .eq("status", "pendiente")
    .select("id");
  if (error || !updated || updated.length === 0) {
    console.error("[firma en papel] no se pudo actualizar la autorización:", error?.code, error?.message);
    if (uploadFileId) await deleteStoredFile(uploadFileId, ctx.org.id, ctx.userId);
    return fail(dbError(error, "No se pudo registrar la firma"));
  }

  await logActivity(ctx, "Registró una autorización firmada en papel", { entity: "consent", entityId: consentId });
  revalidatePath(`/dashboard/autorizaciones/${consentId}`);
  revalidatePath("/dashboard/autorizaciones");
  revalidatePath("/dashboard/tutores");
  redirectAfterSign(formData);
  return ok("Autorización registrada");
}

export async function declineConsent(consentId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("consents.sign");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const reason = optStr(formData, "decline_reason");
  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("consents")
    .update({ status: "rechazada", decline_reason: reason })
    .eq("id", consentId)
    .eq("organization_id", ctx.org.id)
    .eq("status", "pendiente")
    .select("id");
  if (error) return fail(dbError(error, "No se pudo registrar"));
  if (!updated || updated.length === 0) return fail("La autorización ya fue resuelta");

  await logActivity(ctx, "Registró que el tutor no autorizó", { entity: "consent", entityId: consentId, detail: reason ?? undefined });
  revalidatePath(`/dashboard/autorizaciones/${consentId}`);
  revalidatePath("/dashboard/autorizaciones");
  return ok("Registrado");
}

export async function voidConsent(consentId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("consents.create");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const reason = str(formData, "reason");
  if (reason.length < 5) return fail("Escribe el motivo de la anulación (mínimo 5 caracteres)");

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("consents")
    .update({ status: "anulada", void_reason: reason })
    .eq("id", consentId)
    .eq("organization_id", ctx.org.id)
    .neq("status", "anulada")
    .select("id");
  if (error) return fail(dbError(error, "No se pudo anular"));
  if (!updated || updated.length === 0) return fail("La autorización ya estaba anulada");

  await logActivity(ctx, "Anuló una autorización", { entity: "consent", entityId: consentId, detail: reason });
  revalidatePath(`/dashboard/autorizaciones/${consentId}`);
  revalidatePath("/dashboard/autorizaciones");
  return ok("Autorización anulada");
}
