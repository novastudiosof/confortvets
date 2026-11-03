import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Breed, Species } from "@/lib/types";

/** Mapa id -> fila para un conjunto de ids (evita depender de joins). */
export async function rowsById<T extends { id: string }>(
  table: string,
  ids: string[],
  columns: string
): Promise<Map<string, T>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, T>();
  if (unique.length === 0) return map;
  const supabase = await createClient();
  const { data } = await supabase.from(table).select(columns).in("id", unique);
  for (const row of (data ?? []) as unknown as T[]) map.set(row.id, row);
  return map;
}

export async function loadSpeciesAndBreeds(): Promise<{ species: Species[]; breeds: Breed[] }> {
  const supabase = await createClient();
  const [{ data: species }, { data: breeds }] = await Promise.all([
    supabase.from("species").select("id, name, is_active").order("sort_order").order("name"),
    supabase.from("breeds").select("id, species_id, name, is_active").order("name"),
  ]);
  return { species: (species ?? []) as Species[], breeds: (breeds ?? []) as Breed[] };
}

/** Bytes que ocupa la organización (archivos no borrados). */
export async function storageUsedBytes(): Promise<number> {
  const supabase = await createClient();
  let total = 0;
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase
      .from("files")
      .select("size_bytes")
      .is("deleted_at", null)
      .range(from, from + 999);
    for (const row of data ?? []) total += Number(row.size_bytes);
    if (!data || data.length < 1000) break;
  }
  return total;
}

/** Texto de búsqueda seguro para usar dentro de un filtro ilike/or de PostgREST. */
export function safeSearch(term: string | undefined): string {
  return (term ?? "").replace(/[%,()*\\]/g, " ").trim().slice(0, 60);
}
