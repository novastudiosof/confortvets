import "server-only";

import type { Context } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Registra una acción en la bitácora. Nunca interrumpe la acción principal:
 * si falla, lo ignora. La bitácora solo se inserta; no se edita ni se borra.
 */
export async function logActivity(
  ctx: Pick<Context, "userId" | "profile" | "org">,
  action: string,
  options: { entity?: string; entityId?: string; detail?: string; organizationId?: string } = {}
): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase.from("activity_log").insert({
      organization_id: options.organizationId ?? ctx.org?.id ?? ctx.profile.organization_id,
      user_id: ctx.userId,
      user_name: ctx.profile.full_name,
      action,
      entity: options.entity ?? null,
      entity_id: options.entityId ?? null,
      detail: options.detail ?? null,
    });
  } catch {
    // la bitácora no debe romper la operación
  }
}
