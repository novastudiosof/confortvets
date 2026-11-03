// Borra del almacenamiento privado (bucket org-files) los archivos que ya no
// están registrados en la tabla `files` (por ejemplo, después de limpiar los
// datos de prueba). Sin --apply solo muestra lo que borraría.
//
//   node --env-file=.env.local scripts/clean-storage.mjs          (vista previa)
//   node --env-file=.env.local scripts/clean-storage.mjs --apply  (borra)

import { createClient } from "@supabase/supabase-js";

const BUCKET = "org-files";
const apply = process.argv.includes("--apply");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

// Rutas registradas (archivos vigentes)
const registered = new Set();
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase.from("files").select("storage_path, deleted_at").range(from, from + 999);
  if (error) {
    console.error("No se pudo leer la tabla files:", error.message);
    process.exit(1);
  }
  for (const f of data) if (!f.deleted_at) registered.add(f.storage_path);
  if (data.length < 1000) break;
}

// Todos los objetos del bucket (recorre las carpetas)
async function listAll(prefix = "") {
  const out = [];
  const { data, error } = await supabase.storage.from(BUCKET).list(prefix, { limit: 1000 });
  if (error) throw new Error(error.message);
  for (const item of data) {
    const path = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.id === null) out.push(...(await listAll(path)));
    else out.push(path);
  }
  return out;
}

const objects = await listAll();
const orphans = objects.filter((p) => !registered.has(p));
console.log(`Objetos en el almacenamiento: ${objects.length}. Registrados: ${registered.size}. Sin registro: ${orphans.length}.`);
for (const p of orphans) console.log(`  ${apply ? "borra" : "borraría"}: ${p}`);

if (apply && orphans.length > 0) {
  const { error } = await supabase.storage.from(BUCKET).remove(orphans);
  if (error) {
    console.error("No se pudieron borrar:", error.message);
    process.exit(1);
  }
  console.log("Listo.");
} else if (!apply && orphans.length > 0) {
  console.log("\nEs una vista previa. Para borrar: agrega --apply");
}
