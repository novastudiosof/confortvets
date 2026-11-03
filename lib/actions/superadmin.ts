"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { dbError, fail, ok, optStr, str, type ActionResult } from "@/lib/action-result";
import { logActivity } from "@/lib/activity";
import { guardSuperAdmin } from "@/lib/auth";
import { addMonths, isIsoDate } from "@/lib/logic/dates";
import { validatePassword } from "@/lib/logic/password";
import { PERMISSIONS } from "@/lib/logic/permissions";
import { normalizeUsername, slugify, validateUsername } from "@/lib/logic/username";
import { createAdminClient } from "@/lib/supabase/admin";

function intInRange(formData: FormData, name: string, label: string, min: number, max: number): { value: number } | { error: string } {
  const n = Number(str(formData, name));
  if (!Number.isInteger(n) || n < min || n > max) return { error: `${label} debe ser un número entre ${min} y ${max}` };
  return { value: n };
}

async function uniqueSlug(base: string): Promise<string> {
  const admin = createAdminClient();
  for (let i = 0; i < 30; i++) {
    const candidate = i === 0 ? base : `${base.slice(0, 36)}-${i + 1}`;
    const { data } = await admin.from("organizations").select("id").eq("slug", candidate).maybeSingle();
    if (!data) return candidate;
  }
  return `${base.slice(0, 30)}-${crypto.randomUUID().slice(0, 6)}`;
}

export async function createOrganization(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guardSuperAdmin();
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const name = str(formData, "name");
  if (name.length < 3) return fail("Escribe el nombre del consultorio");
  const ownerName = str(formData, "owner_full_name");
  if (ownerName.length < 3) return fail("Escribe el nombre del veterinario");
  const username = normalizeUsername(str(formData, "owner_username"));
  const usernameProblem = validateUsername(username);
  if (usernameProblem) return fail(usernameProblem);
  const password = str(formData, "owner_password");
  const passwordProblem = validatePassword(password);
  if (passwordProblem) return fail(passwordProblem);

  const aux = intInRange(formData, "max_auxiliares", "El límite de auxiliares", 0, 50);
  if ("error" in aux) return fail(aux.error);
  const quota = intInRange(formData, "storage_quota_mb", "El espacio", 10, 5000);
  if ("error" in quota) return fail(quota.error);
  const validUntil = optStr(formData, "valid_until");
  if (validUntil && !isIsoDate(validUntil)) return fail("La fecha de vencimiento no es válida");

  const admin = createAdminClient();
  const { data: taken } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
  if (taken) return fail("Ese nombre de usuario ya está en uso");

  const { data: modules } = await admin.from("modules").select("key, available");
  const requested = formData.getAll("modules").map(String);
  const enabled = (modules ?? [])
    .filter((m) => m.available && requested.includes(m.key as string))
    .map((m) => m.key as string);

  const slug = await uniqueSlug(slugify(name));
  const authEmail = `${crypto.randomUUID()}@confortvets.internal`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: authEmail,
    password,
    email_confirm: true,
  });
  if (createError || !created.user) return fail("No se pudo crear el usuario administrador");

  const { data: orgId, error: rpcError } = await admin.rpc("create_organization", {
    p_name: name,
    p_slug: slug,
    p_owner_id: created.user.id,
    p_owner_username: username,
    p_owner_full_name: ownerName,
    p_owner_auth_email: authEmail,
    p_modules: enabled,
    p_valid_until: validUntil,
    p_max_auxiliares: aux.value,
    p_storage_quota_mb: quota.value,
  });
  if (rpcError || !orgId) {
    await admin.auth.admin.deleteUser(created.user.id);
    return fail(dbError(rpcError, "No se pudo crear la organización"));
  }

  await logActivity(ctx, "Creó una organización", { organizationId: orgId as string, entity: "organization", entityId: orgId as string, detail: name });
  revalidatePath("/superadmin");
  redirect(`/superadmin/organizaciones/${orgId}`);
}

export async function updateOrganization(orgId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guardSuperAdmin();
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const name = str(formData, "name");
  if (name.length < 3) return fail("Escribe el nombre del consultorio");
  const aux = intInRange(formData, "max_auxiliares", "El límite de auxiliares", 0, 50);
  if ("error" in aux) return fail(aux.error);
  const quota = intInRange(formData, "storage_quota_mb", "El espacio", 10, 5000);
  if ("error" in quota) return fail(quota.error);
  const validUntil = optStr(formData, "valid_until");
  if (validUntil && !isIsoDate(validUntil)) return fail("La fecha de vencimiento no es válida");

  const admin = createAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({
      name,
      is_active: formData.get("is_active") === "on",
      valid_until: validUntil,
      max_auxiliares: aux.value,
      storage_quota_mb: quota.value,
    })
    .eq("id", orgId);
  if (error) return fail(dbError(error, "No se pudo guardar"));

  await logActivity(ctx, "Editó una organización", { organizationId: orgId, entity: "organization", entityId: orgId, detail: name });
  revalidatePath(`/superadmin/organizaciones/${orgId}`);
  revalidatePath("/superadmin");
  return ok("Organización actualizada");
}

/** Suma meses a la membresía a partir de hoy o de su vencimiento, lo que sea posterior. */
export async function extendMembership(orgId: string, months: number, _prev: ActionResult, _formData: FormData): Promise<ActionResult> {
  const g = await guardSuperAdmin();
  if (!g.ok) return fail(g.error);
  const { ctx } = g;
  if (!Number.isInteger(months) || months < 1 || months > 36) return fail("Cantidad de meses no válida");

  const admin = createAdminClient();
  const { data: org } = await admin.from("organizations").select("valid_until").eq("id", orgId).maybeSingle();
  if (!org) return fail("No se encontró la organización");

  const today = ctx.today;
  const current = org.valid_until as string | null;
  const base = current && current > today ? current : today;
  const next = addMonths(base, months);

  const { error } = await admin.from("organizations").update({ valid_until: next }).eq("id", orgId);
  if (error) return fail(dbError(error, "No se pudo extender"));

  await logActivity(ctx, "Extendió la membresía", { organizationId: orgId, entity: "organization", entityId: orgId, detail: `+${months} meses → ${next}` });
  revalidatePath(`/superadmin/organizaciones/${orgId}`);
  revalidatePath("/superadmin");
  return ok(`Membresía extendida hasta ${next}`);
}

export async function toggleModule(orgId: string, moduleKey: string, enabled: boolean, _prev: ActionResult, _formData: FormData): Promise<ActionResult> {
  const g = await guardSuperAdmin();
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const admin = createAdminClient();
  const { data: module } = await admin.from("modules").select("key, is_core, available, name").eq("key", moduleKey).maybeSingle();
  if (!module) return fail("Módulo no válido");
  if (module.is_core) return fail("El módulo base siempre está activo");
  if (!module.available) return fail("Ese módulo todavía no está disponible");

  const { error } = await admin.from("organization_modules").upsert(
    {
      organization_id: orgId,
      module_key: moduleKey,
      enabled,
      enabled_at: enabled ? new Date().toISOString() : null,
    },
    { onConflict: "organization_id,module_key" }
  );
  if (error) return fail(dbError(error, "No se pudo actualizar el módulo"));

  await logActivity(ctx, `${enabled ? "Activó" : "Desactivó"} el módulo ${module.name}`, { organizationId: orgId, entity: "organization", entityId: orgId });
  revalidatePath(`/superadmin/organizaciones/${orgId}`);
  return ok(enabled ? "Módulo activado" : "Módulo desactivado");
}

/** Permite o restringe un permiso concreto para toda la organización. */
export async function setPermissionAllowed(orgId: string, permissionKey: string, allowed: boolean, _prev: ActionResult, _formData: FormData): Promise<ActionResult> {
  const g = await guardSuperAdmin();
  if (!g.ok) return fail(g.error);
  const { ctx } = g;
  if (!PERMISSIONS.some((p) => p.key === permissionKey)) return fail("Permiso no válido");

  const admin = createAdminClient();
  const { error } = allowed
    ? await admin.from("organization_permissions").delete().eq("organization_id", orgId).eq("permission_key", permissionKey)
    : await admin
        .from("organization_permissions")
        .upsert({ organization_id: orgId, permission_key: permissionKey, enabled: false }, { onConflict: "organization_id,permission_key" });
  if (error) return fail(dbError(error, "No se pudo actualizar el permiso"));

  await logActivity(ctx, `${allowed ? "Permitió" : "Restringió"} el permiso ${permissionKey}`, { organizationId: orgId, entity: "organization", entityId: orgId });
  revalidatePath(`/superadmin/organizaciones/${orgId}`);
  return ok(allowed ? "Permiso permitido" : "Permiso restringido");
}

/** Restablece la contraseña del administrador (owner) de una organización. */
export async function resetOwnerPassword(orgId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guardSuperAdmin();
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const password = str(formData, "password");
  const problem = validatePassword(password);
  if (problem) return fail(problem);

  const admin = createAdminClient();
  const { data: owner } = await admin
    .from("profiles")
    .select("id, username")
    .eq("organization_id", orgId)
    .eq("role", "owner")
    .maybeSingle();
  if (!owner) return fail("No se encontró el administrador de esta organización");

  const { error } = await admin.auth.admin.updateUserById(owner.id as string, { password });
  if (error) return fail("No se pudo cambiar la contraseña");
  await admin.from("profiles").update({ must_change_password: true }).eq("id", owner.id);

  await logActivity(ctx, "Restableció la contraseña del administrador", { organizationId: orgId, entity: "profile", entityId: owner.id as string, detail: owner.username as string });
  revalidatePath(`/superadmin/organizaciones/${orgId}`);
  return ok("Contraseña cambiada. Entrégasela al veterinario: deberá crear una nueva al ingresar.");
}

export async function setUserActive(orgId: string, profileId: string, active: boolean, _prev: ActionResult, _formData: FormData): Promise<ActionResult> {
  const g = await guardSuperAdmin();
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const admin = createAdminClient();
  const { data: target } = await admin.from("profiles").select("id, username, organization_id, role").eq("id", profileId).maybeSingle();
  if (!target || target.organization_id !== orgId || target.role === "super_admin") return fail("No se encontró ese usuario");

  const { error } = await admin.from("profiles").update({ is_active: active }).eq("id", profileId);
  if (error) return fail(dbError(error, "No se pudo actualizar"));

  await logActivity(ctx, active ? "Activó un usuario" : "Desactivó un usuario", { organizationId: orgId, entity: "profile", entityId: profileId, detail: target.username as string });
  revalidatePath(`/superadmin/organizaciones/${orgId}`);
  return ok(active ? "Usuario activado" : "Usuario desactivado");
}
