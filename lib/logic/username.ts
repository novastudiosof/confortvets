export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

/** Mismo patrón que la restricción de la base de datos (profiles_username_check). */
export function validateUsername(username: string): string | null {
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) {
    return "El usuario debe tener entre 3 y 30 caracteres: letras minúsculas, números, punto, guion o guion bajo";
  }
  return null;
}

/** "Veterinaria El Parque" -> "veterinaria-el-parque" */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "organizacion";
}
