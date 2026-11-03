import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Cliente con la llave de servicio: se salta RLS por completo. Solo se usa en
 * server actions y route handlers que ANTES verifican quién es el usuario y
 * qué puede hacer (crear usuarios, restablecer contraseñas, subir archivos
 * con cuota, login). Nunca importar desde código de cliente.
 */
export function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
