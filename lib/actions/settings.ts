"use server";

import { revalidatePath } from "next/cache";

import { dbError, fail, ok, optStr, str, type ActionResult } from "@/lib/action-result";
import { logActivity } from "@/lib/activity";
import { guard } from "@/lib/auth";
import { CATALOGS, type CatalogDef, type CatalogField } from "@/lib/catalogs";
import { deleteStoredFile, storeUpload } from "@/lib/files";
import { isHexColor } from "@/lib/logic/colors";
import { normalizePhone } from "@/lib/logic/reminders";
import { createClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Marca y datos del consultorio
// ---------------------------------------------------------------------------
export async function updateBranding(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("settings.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const businessName = str(formData, "business_name");
  if (businessName.length < 2) return fail("Escribe el nombre comercial");
  const color = str(formData, "primary_color") || "#3B82F6";
  if (!isHexColor(color)) return fail("El color no es válido");
  const whatsapp = optStr(formData, "whatsapp");
  if (whatsapp && !normalizePhone(whatsapp)) return fail("El WhatsApp no es válido");
  const email = optStr(formData, "email");
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail("El correo no es válido");

  const supabase = await createClient();
  const { error } = await supabase
    .from("organization_settings")
    .update({
      business_name: businessName,
      professional_name: optStr(formData, "professional_name"),
      professional_card: optStr(formData, "professional_card"),
      phone: optStr(formData, "phone"),
      whatsapp: whatsapp ? normalizePhone(whatsapp) : null,
      email,
      address: optStr(formData, "address"),
      city: optStr(formData, "city"),
      primary_color: color,
      letterhead_text: optStr(formData, "letterhead_text"),
    })
    .eq("organization_id", ctx.org.id);
  if (error) return fail(dbError(error, "No se pudo guardar"));

  await logActivity(ctx, "Actualizó la marca y los datos del consultorio");
  revalidatePath("/dashboard", "layout");
  return ok("Datos guardados");
}

export async function updateDataPolicy(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("settings.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const supabase = await createClient();
  const { error } = await supabase
    .from("organization_settings")
    .update({ data_policy_text: optStr(formData, "data_policy_text") })
    .eq("organization_id", ctx.org.id);
  if (error) return fail(dbError(error, "No se pudo guardar"));

  await logActivity(ctx, "Actualizó la política de tratamiento de datos");
  revalidatePath("/dashboard/configuracion");
  return ok("Política guardada");
}

export async function uploadLogo(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("settings.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("Elige una imagen");

  const stored = await storeUpload(file, {
    orgId: ctx.org.id,
    userId: ctx.userId,
    kind: "logo",
    allowPdf: false,
    allowImage: true,
  });
  if (!stored.ok) return fail(stored.error);

  const previous = ctx.settings.logo_file_id;
  const supabase = await createClient();
  const { error } = await supabase
    .from("organization_settings")
    .update({ logo_file_id: stored.fileId })
    .eq("organization_id", ctx.org.id);
  if (error) {
    await deleteStoredFile(stored.fileId, ctx.org.id, ctx.userId);
    return fail(dbError(error, "No se pudo guardar el logo"));
  }
  if (previous) await deleteStoredFile(previous, ctx.org.id, ctx.userId);

  await logActivity(ctx, "Cambió el logo");
  revalidatePath("/dashboard", "layout");
  return ok("Logo actualizado");
}

export async function removeLogo(_prev: ActionResult, _formData: FormData): Promise<ActionResult> {
  const g = await guard("settings.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const previous = ctx.settings.logo_file_id;
  if (!previous) return ok("No hay logo");
  const supabase = await createClient();
  const { error } = await supabase
    .from("organization_settings")
    .update({ logo_file_id: null })
    .eq("organization_id", ctx.org.id);
  if (error) return fail(dbError(error, "No se pudo quitar el logo"));
  await deleteStoredFile(previous, ctx.org.id, ctx.userId);

  await logActivity(ctx, "Quitó el logo");
  revalidatePath("/dashboard", "layout");
  return ok("Logo eliminado");
}

// ---------------------------------------------------------------------------
// Reglas y textos de recordatorio
// ---------------------------------------------------------------------------
export async function saveReminderSettings(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("settings.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;
  const supabase = await createClient();

  for (const kind of ["vacuna", "desparasitante", "control"] as const) {
    const days = Number(str(formData, `days_${kind}`));
    if (!Number.isInteger(days) || days < 0 || days > 120) {
      return fail("Los días de anticipación deben ser un número entre 0 y 120");
    }
    const body = str(formData, `body_${kind}`);
    if (body.length < 5) return fail("Escribe el mensaje de cada recordatorio");

    const { error: ruleError } = await supabase.from("reminder_rules").upsert(
      {
        organization_id: ctx.org.id,
        kind,
        days_before: days,
        enabled: formData.get(`enabled_${kind}`) === "on",
      },
      { onConflict: "organization_id,kind" }
    );
    if (ruleError) return fail(dbError(ruleError, "No se pudo guardar"));

    const { error: msgError } = await supabase
      .from("message_templates")
      .upsert({ organization_id: ctx.org.id, kind, body }, { onConflict: "organization_id,kind" });
    if (msgError) return fail(dbError(msgError, "No se pudo guardar"));
  }

  await logActivity(ctx, "Actualizó las reglas y textos de recordatorio");
  revalidatePath("/dashboard/configuracion");
  return ok("Recordatorios guardados");
}

// ---------------------------------------------------------------------------
// Catálogos genéricos (lista blanca en lib/catalogs.ts)
// ---------------------------------------------------------------------------
function readCatalogValue(
  field: CatalogField,
  formData: FormData
): { value: unknown } | { error: string } {
  switch (field.type) {
    case "checkbox":
      return { value: formData.get(field.name) === "on" };
    case "number": {
      const raw = str(formData, field.name);
      if (raw === "") {
        return field.required ? { error: `${field.label} es obligatorio` } : { value: null };
      }
      const n = Number(raw.replace(",", "."));
      if (!Number.isFinite(n) || n <= 0) return { error: `${field.label} debe ser un número mayor que cero` };
      return { value: Math.round(n) };
    }
    case "lines": {
      const lines = str(formData, field.name)
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      return { value: lines };
    }
    case "select": {
      const raw = str(formData, field.name);
      if (raw === "") return field.required ? { error: `${field.label} es obligatorio` } : { value: null };
      if (field.options && !field.options.some((o) => o.value === raw)) {
        return { error: `${field.label}: opción no válida` };
      }
      return { value: raw };
    }
    default: {
      const raw = str(formData, field.name);
      if (raw === "") return field.required ? { error: `${field.label} es obligatorio` } : { value: null };
      return { value: raw.slice(0, 4000) };
    }
  }
}

function catalogOrFail(key: string): CatalogDef | null {
  return Object.prototype.hasOwnProperty.call(CATALOGS, key) ? CATALOGS[key] : null;
}

export async function saveCatalogItem(
  catalogKey: string,
  itemId: string | null,
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const def = catalogOrFail(catalogKey);
  if (!def) return fail("Catálogo no válido");

  // Los medicamentos y plantillas de texto los edita quien escribe historias.
  const permission = def.key === "medications" || def.key === "text_templates" ? "clinical.write" : "settings.write";
  const g = await guard(permission);
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const row: Record<string, unknown> = {};
  for (const field of def.fields) {
    if (itemId && field.immutable) continue;
    const parsed = readCatalogValue(field, formData);
    if ("error" in parsed) return fail(parsed.error);
    row[field.name] = parsed.value;
  }

  if (def.key === "custom_field_defs") {
    if (!/^[a-z][a-z0-9_]{1,40}$/.test(String(row.key ?? ""))) {
      if (!itemId) return fail("La clave interna debe empezar con una letra minúscula y usar solo minúsculas, números y guion bajo");
    }
    const type = String(row.field_type ?? "");
    if (!itemId && type === "select" && (row.options as string[]).length < 2) {
      return fail("Agrega al menos dos opciones para una lista");
    }
  }

  const supabase = await createClient();

  if (itemId) {
    if (def.bumpVersion) {
      const { data: current } = await supabase.from(def.table).select("version").eq("id", itemId).maybeSingle();
      row.version = ((current?.version as number | undefined) ?? 1) + 1;
    }
    const { error } = await supabase.from(def.table).update(row).eq("id", itemId).eq("organization_id", ctx.org.id);
    if (error) return fail(dbError(error, "No se pudo guardar"));
    await logActivity(ctx, `Editó ${def.title.toLowerCase()}`, { entity: def.table, entityId: itemId });
  } else {
    const { data, error } = await supabase
      .from(def.table)
      .insert({ ...row, organization_id: ctx.org.id })
      .select("id")
      .single();
    if (error) return fail(dbError(error, "No se pudo guardar"));
    await logActivity(ctx, `Agregó a ${def.title.toLowerCase()}`, { entity: def.table, entityId: data?.id });
  }

  revalidatePath("/dashboard/configuracion");
  return ok("Guardado");
}

export async function toggleCatalogItem(
  catalogKey: string,
  itemId: string,
  active: boolean,
  _prev: ActionResult,
  _formData: FormData
): Promise<ActionResult> {
  const def = catalogOrFail(catalogKey);
  if (!def || !def.hasActive) return fail("Catálogo no válido");

  const permission = def.key === "medications" || def.key === "text_templates" ? "clinical.write" : "settings.write";
  const g = await guard(permission);
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const supabase = await createClient();
  const { error } = await supabase
    .from(def.table)
    .update({ is_active: active })
    .eq("id", itemId)
    .eq("organization_id", ctx.org.id);
  if (error) return fail(dbError(error, "No se pudo actualizar"));

  await logActivity(ctx, `${active ? "Activó" : "Desactivó"} un elemento de ${def.title.toLowerCase()}`, {
    entity: def.table,
    entityId: itemId,
  });
  revalidatePath("/dashboard/configuracion");
  return ok(active ? "Activado" : "Desactivado");
}
