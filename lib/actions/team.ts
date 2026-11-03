"use server";

import { revalidatePath } from "next/cache";

import { dbError, fail, ok, str, type ActionResult } from "@/lib/action-result";
import { logActivity } from "@/lib/activity";
import { guardOwner, type Context } from "@/lib/auth";
import { validatePassword } from "@/lib/logic/password";
import { PERMISSIONS } from "@/lib/logic/permissions";
import { normalizeUsername, validateUsername } from "@/lib/logic/username";
import { createAdminClient } from "@/lib/supabase/admin";

/** Permisos que este owner puede repartir: de módulos activos y no restringidos. */
function assignablePermissions(ctx: Context): Set<string> {
  return new Set(
    PERMISSIONS.filter((p) => ctx.enabledModules.has(p.module) && !ctx.restricted.has(p.key)).map((p) => p.key)
  );
}

function readGrantedPermissions(formData: FormData, allowed: Set<string>): string[] {
  const keys = formData.getAll("permissions").map(String);
  return [...new Set(keys.filter((k) => allowed.has(k)))];
}

/** El auxiliar debe existir y ser de la MISMA organización del administrador. */
async function loadOwnAuxiliar(ctx: Context & { org: { id: string } }, profileId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("id, username, organization_id, role, is_active")
    .eq("id", profileId)
    .maybeSingle();
  if (!data || data.organization_id !== ctx.org.id || data.role !== "auxiliar") return null;
  return data;
}

export async function createAuxiliar(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guardOwner();
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const username = normalizeUsername(str(formData, "username"));
  const usernameProblem = validateUsername(username);
  if (usernameProblem) return fail(usernameProblem);
  const fullName = str(formData, "full_name");
  if (fullName.length < 3) return fail("Escribe el nombre completo");
  const password = str(formData, "password");
  const passwordProblem = validatePassword(password);
  if (passwordProblem) return fail(passwordProblem);

  const admin = createAdminClient();
  const { count } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", ctx.org.id)
    .eq("role", "auxiliar");
  if ((count ?? 0) >= ctx.org.max_auxiliares) {
    return fail(`Alcanzaste el límite de ${ctx.org.max_auxiliares} auxiliar(es). Contacta a tu proveedor para ampliarlo.`);
  }

  const { data: taken } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
  if (taken) return fail("Ese nombre de usuario ya está en uso");

  const authEmail = `${crypto.randomUUID()}@confortvets.internal`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: authEmail,
    password,
    email_confirm: true,
  });
  if (createError || !created.user) return fail("No se pudo crear el usuario");

  const { error: profileError } = await admin.from("profiles").insert({
    id: created.user.id,
    organization_id: ctx.org.id,
    username,
    full_name: fullName,
    auth_email: authEmail,
    role: "auxiliar",
    must_change_password: true,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return fail(dbError(profileError, "No se pudo crear el usuario"));
  }

  const granted = readGrantedPermissions(formData, assignablePermissions(ctx));
  if (granted.length) {
    const { error } = await admin.from("auxiliary_permissions").insert(
      granted.map((permission_key) => ({
        profile_id: created.user.id,
        organization_id: ctx.org.id,
        permission_key,
      }))
    );
    if (error) return fail(dbError(error, "El usuario se creó, pero no se pudieron guardar sus permisos"));
  }

  await logActivity(ctx, "Creó un usuario auxiliar", { entity: "profile", entityId: created.user.id, detail: username });
  revalidatePath("/dashboard/equipo");
  return ok("Auxiliar creado. Entrégale su usuario y la contraseña temporal; deberá cambiarla al ingresar.");
}

export async function updateAuxiliarPermissions(profileId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guardOwner();
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const target = await loadOwnAuxiliar(ctx, profileId);
  if (!target) return fail("No se encontró ese auxiliar");

  const granted = readGrantedPermissions(formData, assignablePermissions(ctx));
  const admin = createAdminClient();

  // Reemplaza el conjunto completo: primero inserta los nuevos (por si falla,
  // el auxiliar no se queda sin permisos) y luego quita los que sobran.
  if (granted.length) {
    const { error } = await admin.from("auxiliary_permissions").upsert(
      granted.map((permission_key) => ({ profile_id: profileId, organization_id: ctx.org.id, permission_key })),
      { onConflict: "profile_id,permission_key" }
    );
    if (error) return fail(dbError(error, "No se pudieron guardar los permisos"));
  }
  const { data: current } = await admin.from("auxiliary_permissions").select("permission_key").eq("profile_id", profileId);
  const toRemove = (current ?? []).map((r) => r.permission_key as string).filter((k) => !granted.includes(k));
  if (toRemove.length) {
    await admin.from("auxiliary_permissions").delete().eq("profile_id", profileId).in("permission_key", toRemove);
  }

  await logActivity(ctx, "Cambió los permisos de un auxiliar", { entity: "profile", entityId: profileId, detail: target.username as string });
  revalidatePath("/dashboard/equipo");
  return ok("Permisos guardados");
}

/** Restablece la contraseña de un auxiliar SIN pedir la anterior. */
export async function resetAuxiliarPassword(profileId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guardOwner();
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const target = await loadOwnAuxiliar(ctx, profileId);
  if (!target) return fail("No se encontró ese auxiliar");

  const password = str(formData, "password");
  const problem = validatePassword(password);
  if (problem) return fail(problem);

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(profileId, { password });
  if (error) return fail("No se pudo cambiar la contraseña");
  await admin.from("profiles").update({ must_change_password: true }).eq("id", profileId);

  await logActivity(ctx, "Restableció la contraseña de un auxiliar", { entity: "profile", entityId: profileId, detail: target.username as string });
  revalidatePath("/dashboard/equipo");
  return ok("Contraseña cambiada. Entrégasela al auxiliar: deberá crear una nueva al ingresar.");
}

export async function setAuxiliarActive(profileId: string, active: boolean, _prev: ActionResult, _formData: FormData): Promise<ActionResult> {
  const g = await guardOwner();
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const target = await loadOwnAuxiliar(ctx, profileId);
  if (!target) return fail("No se encontró ese auxiliar");

  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update({ is_active: active }).eq("id", profileId);
  if (error) return fail(dbError(error, "No se pudo actualizar"));

  await logActivity(ctx, active ? "Activó un usuario auxiliar" : "Desactivó un usuario auxiliar", {
    entity: "profile",
    entityId: profileId,
    detail: target.username as string,
  });
  revalidatePath("/dashboard/equipo");
  return ok(active ? "Usuario activado" : "Usuario desactivado");
}
