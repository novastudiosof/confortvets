import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { normalizeUsername } from "@/lib/logic/username";

const loginSchema = z.object({
  username: z.string().trim().min(1, "El usuario es obligatorio").max(60),
  password: z.string().min(1, "La contraseña es obligatoria").max(200),
});

const WINDOW_MINUTES = 15;
const MAX_FAILURES_PER_USER = 5;
const MAX_FAILURES_PER_IP = 20;

const GENERIC_ERROR = "Usuario o contraseña incorrectos";

function clientIp(request: Request): string | null {
  return (
    request.headers.get("x-nf-client-connection-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null
  );
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  const username = normalizeUsername(parsed.data.username);
  const { password } = parsed.data;
  const ip = clientIp(request);
  const admin = createAdminClient();
  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();

  // Bloqueo temporal tras varios intentos fallidos (por usuario y por IP).
  const [byUser, byIp] = await Promise.all([
    admin
      .from("login_attempts")
      .select("id", { count: "exact", head: true })
      .eq("username", username)
      .eq("success", false)
      .gte("created_at", since),
    ip
      ? admin
          .from("login_attempts")
          .select("id", { count: "exact", head: true })
          .eq("ip", ip)
          .eq("success", false)
          .gte("created_at", since)
      : Promise.resolve({ count: 0 }),
  ]);
  if ((byUser.count ?? 0) >= MAX_FAILURES_PER_USER || (byIp.count ?? 0) >= MAX_FAILURES_PER_IP) {
    return NextResponse.json(
      { error: `Demasiados intentos. Espera ${WINDOW_MINUTES} minutos e inténtalo de nuevo.` },
      { status: 429 }
    );
  }

  async function recordFailure() {
    await admin.from("login_attempts").insert({ username: username.slice(0, 60), ip, success: false });
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("id, auth_email, organization_id, role, is_active, must_change_password")
    .eq("username", username)
    .maybeSingle();

  if (!profile) {
    await recordFailure();
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: profile.auth_email, password });
  if (error) {
    await recordFailure();
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
  }

  // La contraseña es correcta: ahora sí se informa si la cuenta está bloqueada.
  let blocked: string | null = null;
  if (!profile.is_active) {
    blocked = "Tu usuario está desactivado. Contacta al administrador de tu consultorio.";
  } else if (profile.organization_id) {
    const { data: org } = await admin
      .from("organizations")
      .select("is_active")
      .eq("id", profile.organization_id)
      .maybeSingle();
    if (!org || !org.is_active) {
      blocked = "Este consultorio no tiene acceso activo. Contacta a tu proveedor.";
    }
  }
  if (blocked) {
    await supabase.auth.signOut();
    return NextResponse.json({ error: blocked }, { status: 403 });
  }

  await Promise.all([
    admin.from("login_attempts").delete().eq("username", username).eq("success", false),
    admin.from("profiles").update({ last_login_at: new Date().toISOString() }).eq("id", profile.id),
  ]);

  return NextResponse.json({
    ok: true,
    mustChangePassword: profile.must_change_password,
    role: profile.role,
  });
}
