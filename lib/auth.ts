import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { DEFAULT_TZ, todayISO } from "@/lib/logic/dates";
import { membershipStatus, type MembershipStatus } from "@/lib/logic/membership";
import { effectivePermissions } from "@/lib/logic/permissions";
import type { Organization, OrgSettings, Profile } from "@/lib/types";

export interface Context {
  userId: string;
  profile: Profile;
  org: Organization | null;
  settings: OrgSettings | null;
  enabledModules: Set<string>;
  restricted: Set<string>;
  permissions: Set<string>;
  membership: MembershipStatus;
  /** Membresía vencida: se puede consultar pero no escribir. */
  readOnly: boolean;
  today: string;
  tz: string;
}

/**
 * Sesión actual con la organización, los módulos y los permisos efectivos.
 * Es solo para decidir qué mostrar: la autoridad es RLS en la base de datos.
 */
export const getContext = cache(async (): Promise<Context | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (!profile || !profile.is_active) return null;

  if (profile.role === "super_admin" || !profile.organization_id) {
    return {
      userId: user.id,
      profile: profile as Profile,
      org: null,
      settings: null,
      enabledModules: new Set(),
      restricted: new Set(),
      permissions: new Set(),
      membership: { state: "active", daysLeft: null },
      readOnly: false,
      today: todayISO(),
      tz: DEFAULT_TZ,
    };
  }

  const orgId = profile.organization_id as string;
  const [orgRes, settingsRes, modulesRes, restrictedRes, grantsRes] = await Promise.all([
    supabase.from("organizations").select("*").eq("id", orgId).maybeSingle(),
    supabase.from("organization_settings").select("*").eq("organization_id", orgId).maybeSingle(),
    supabase.from("organization_modules").select("module_key, enabled").eq("organization_id", orgId),
    supabase.from("organization_permissions").select("permission_key").eq("organization_id", orgId).eq("enabled", false),
    profile.role === "auxiliar"
      ? supabase.from("auxiliary_permissions").select("permission_key").eq("profile_id", user.id)
      : Promise.resolve({ data: [] as { permission_key: string }[] }),
  ]);

  const org = (orgRes.data as Organization | null) ?? null;
  if (!org) return null;

  const settings = (settingsRes.data as OrgSettings | null) ?? null;
  const tz = settings?.timezone ?? DEFAULT_TZ;
  const today = todayISO(tz);

  const modulesList = (modulesRes.data ?? []) as { module_key: string; enabled: boolean }[];
  const enabledModules = new Set<string>(["core"]);
  for (const m of modulesList) if (m.enabled) enabledModules.add(m.module_key);

  const restricted = new Set<string>(
    ((restrictedRes.data ?? []) as { permission_key: string }[]).map((r) => r.permission_key)
  );
  const grants = new Set<string>(
    ((grantsRes.data ?? []) as { permission_key: string }[]).map((r) => r.permission_key)
  );

  const membership = membershipStatus(org.valid_until, today);

  return {
    userId: user.id,
    profile: profile as Profile,
    org,
    settings,
    enabledModules,
    restricted,
    permissions: org.is_active
      ? effectivePermissions({ role: profile.role, enabledModules, grants, restricted })
      : new Set(),
    membership,
    readOnly: membership.state === "expired",
    today,
    tz,
  };
});

export function can(ctx: Context, permission: string): boolean {
  return ctx.permissions.has(permission);
}

export function hasModule(ctx: Context, module: string): boolean {
  return ctx.enabledModules.has(module);
}

/** Páginas: exige sesión. Redirige al inicio de sesión si no hay. */
export async function requireContext(): Promise<Context> {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  return ctx;
}

/** Páginas: exige un usuario de una organización activa. */
export async function requireOrgContext(): Promise<Context & { org: Organization; settings: OrgSettings }> {
  const ctx = await requireContext();
  if (ctx.profile.role === "super_admin") redirect("/superadmin");
  if (!ctx.org || !ctx.settings) redirect("/login");
  if (!ctx.org.is_active) redirect("/login?inactiva=1");
  return ctx as Context & { org: Organization; settings: OrgSettings };
}

/** Páginas: exige un permiso; si falta, vuelve al inicio con un aviso. */
export async function requireAccess(permission: string): Promise<Context & { org: Organization; settings: OrgSettings }> {
  const ctx = await requireOrgContext();
  if (!can(ctx, permission)) redirect("/dashboard?sin_acceso=1");
  return ctx;
}

export async function requireSuperAdmin(): Promise<Context> {
  const ctx = await requireContext();
  if (ctx.profile.role !== "super_admin") redirect("/dashboard");
  return ctx;
}

export type Guard =
  | { ok: true; ctx: Context & { org: Organization; settings: OrgSettings } }
  | { ok: false; error: string };

/**
 * Acciones: verifica sesión, organización activa, permiso y, si la acción
 * escribe, que la membresía esté vigente. RLS vuelve a verificarlo en la base.
 */
export async function guard(permission: string, options: { write?: boolean } = {}): Promise<Guard> {
  const write = options.write ?? true;
  const ctx = await getContext();
  if (!ctx || ctx.profile.role === "super_admin" || !ctx.org || !ctx.settings) {
    return { ok: false, error: "Tu sesión no es válida. Vuelve a iniciar sesión." };
  }
  if (!ctx.org.is_active) return { ok: false, error: "Tu organización no tiene acceso activo." };
  if (!can(ctx, permission)) return { ok: false, error: "No tienes permiso para hacer esto." };
  if (write && ctx.readOnly) {
    return { ok: false, error: "Tu membresía venció: solo puedes consultar. Actualízala para seguir registrando información." };
  }
  return { ok: true, ctx: ctx as Context & { org: Organization; settings: OrgSettings } };
}

export type OwnerGuard = Guard;

/** Acciones solo del owner (equipo, contraseñas). */
export async function guardOwner(): Promise<Guard> {
  const ctx = await getContext();
  if (!ctx || ctx.profile.role !== "owner" || !ctx.org || !ctx.settings) {
    return { ok: false, error: "Solo el administrador puede hacer esto." };
  }
  if (!ctx.org.is_active) return { ok: false, error: "Tu organización no tiene acceso activo." };
  if (ctx.readOnly) {
    return { ok: false, error: "Tu membresía venció: solo puedes consultar. Actualízala para seguir." };
  }
  return { ok: true, ctx: ctx as Context & { org: Organization; settings: OrgSettings } };
}

export type SuperGuard = { ok: true; ctx: Context } | { ok: false; error: string };

export async function guardSuperAdmin(): Promise<SuperGuard> {
  const ctx = await getContext();
  if (!ctx || ctx.profile.role !== "super_admin") {
    return { ok: false, error: "Solo el super administrador puede hacer esto." };
  }
  return { ok: true, ctx };
}
