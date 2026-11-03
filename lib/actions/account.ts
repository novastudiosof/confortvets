"use server";

import { redirect } from "next/navigation";
import { createClient as createAnonClient } from "@supabase/supabase-js";

import { fail, ok, str, type ActionResult } from "@/lib/action-result";
import { logActivity } from "@/lib/activity";
import { getContext } from "@/lib/auth";
import { validatePassword } from "@/lib/logic/password";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Cambia la contraseña del propio usuario. Pide la actual: así una sesión
 * abierta y olvidada no basta para quedarse con la cuenta.
 */
export async function changeOwnPassword(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await getContext();
  if (!ctx) return fail("Tu sesión no es válida. Vuelve a iniciar sesión.");

  const current = str(formData, "current");
  const password = str(formData, "password");
  const confirm = str(formData, "confirm");

  if (!current) return fail("Escribe tu contraseña actual");
  const problem = validatePassword(password);
  if (problem) return fail(problem);
  if (password !== confirm) return fail("Las contraseñas nuevas no coinciden");
  if (password === current) return fail("La contraseña nueva debe ser distinta de la actual");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("auth_email").eq("id", ctx.userId).maybeSingle();
  if (!profile) return fail("No se encontró tu usuario");

  // Verifica la contraseña actual sin tocar las cookies de la sesión.
  const verifier = createAnonClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: verifyError } = await verifier.auth.signInWithPassword({ email: profile.auth_email, password: current });
  if (verifyError) return fail("La contraseña actual no es correcta");

  const { error } = await admin.auth.admin.updateUserById(ctx.userId, { password });
  if (error) return fail("No se pudo actualizar la contraseña");

  await admin.from("profiles").update({ must_change_password: false }).eq("id", ctx.userId);
  await logActivity(ctx, "Cambió su contraseña", { entity: "profile", entityId: ctx.userId });

  if (formData.get("forced") === "1") {
    redirect(ctx.profile.role === "super_admin" ? "/superadmin" : "/dashboard");
  }
  return ok("Contraseña actualizada correctamente");
}
