// Crea el primer super administrador (NovaStudio). Se ejecuta UNA vez, a mano,
// desde tu computador. No hay pantalla para esto a propósito: solo tú debes
// poder crearlo.
//
//   node --env-file=.env.local scripts/bootstrap-super-admin.mjs <usuario> "<contraseña>" "<Nombre completo>"

import { createClient } from "@supabase/supabase-js";

const [, , rawUsername, password, fullName] = process.argv;

if (!rawUsername || !password || !fullName) {
  console.error('Uso: node --env-file=.env.local scripts/bootstrap-super-admin.mjs <usuario> "<contraseña>" "<Nombre completo>"');
  process.exit(1);
}

const username = rawUsername.trim().toLowerCase();
if (!/^[a-z0-9._-]{3,30}$/.test(username)) {
  console.error("El usuario debe tener 3 a 30 caracteres: minúsculas, números, punto, guion o guion bajo.");
  process.exit(1);
}
if (password.length < 10 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
  console.error("La contraseña debe tener al menos 10 caracteres, con letras y números.");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el entorno.");
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: existing } = await supabase.from("profiles").select("id").eq("role", "super_admin").limit(1);
if (existing && existing.length > 0) {
  console.error("Ya existe un super administrador. Este script solo crea el primero.");
  process.exit(1);
}

const authEmail = `${crypto.randomUUID()}@confortvets.internal`;
const { data: created, error: createError } = await supabase.auth.admin.createUser({
  email: authEmail,
  password,
  email_confirm: true,
});
if (createError || !created.user) {
  console.error("Error creando el usuario en Supabase Auth:", createError?.message);
  process.exit(1);
}

const { error: profileError } = await supabase.from("profiles").insert({
  id: created.user.id,
  organization_id: null,
  username,
  full_name: fullName,
  auth_email: authEmail,
  role: "super_admin",
});
if (profileError) {
  console.error("Error creando el perfil:", profileError.message);
  await supabase.auth.admin.deleteUser(created.user.id); // no dejar estado a medias
  process.exit(1);
}

console.log(`Super administrador "${username}" creado. Ya puedes iniciar sesión.`);
