import "server-only";

import type { CustomFieldDef } from "@/lib/logic/custom-fields";
import { createClient } from "@/lib/supabase/server";

/** Campos personalizados activos de una entidad, en el orden configurado. */
export async function loadCustomFieldDefs(
  entity: "tutor" | "patient" | "consultation"
): Promise<CustomFieldDef[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("custom_field_defs")
    .select("key, label, field_type, options, required, is_active, section")
    .eq("entity", entity)
    .eq("is_active", true)
    .order("sort_order")
    .order("label");

  return (data ?? []).map((d) => ({
    key: d.key as string,
    label: d.label as string,
    field_type: d.field_type as CustomFieldDef["field_type"],
    options: Array.isArray(d.options) ? (d.options as string[]) : [],
    required: Boolean(d.required),
    is_active: true,
    section: (d.section as string | null) ?? null,
  }));
}
