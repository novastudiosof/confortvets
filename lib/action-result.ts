/** Resultado de una server action usada con useActionState. */
export type ActionResult = { error?: string; success?: string } | undefined;

export function fail(error: string): ActionResult {
  return { error };
}

export function ok(success = "Guardado"): ActionResult {
  return { success };
}

/** Texto de un campo de formulario, recortado; cadena vacía si falta. */
export function str(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v.trim() : "";
}

/** Texto opcional: null si está vacío. */
export function optStr(formData: FormData, name: string): string | null {
  const v = str(formData, name);
  return v === "" ? null : v;
}

/** Número opcional: null si está vacío, undefined si no es un número. */
export function optNum(formData: FormData, name: string): number | null | undefined {
  const v = str(formData, name);
  if (v === "") return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

export function checked(formData: FormData, name: string): boolean {
  return formData.get(name) === "on";
}

/** Traduce los errores de la base de datos a mensajes comprensibles. */
export function dbError(error: { message?: string; code?: string } | null | undefined, fallback: string): string {
  if (!error) return fallback;
  const message = error.message ?? "";
  if (message.includes("storage_quota_exceeded")) {
    return "No hay espacio suficiente en tu plan. Libera archivos o contacta a tu proveedor para ampliarlo.";
  }
  if (message.includes("max_auxiliares_exceeded")) {
    return "Alcanzaste el límite de auxiliares de tu plan. Contacta a tu proveedor para ampliarlo.";
  }
  if (error.code === "23505") return "Ya existe un registro con esos datos.";
  if (error.code === "23503") return "El registro está relacionado con otros datos y no se puede completar la acción.";
  if (error.code === "42501" || message.includes("row-level security")) {
    return "No tienes permiso para hacer esto o tu membresía está vencida.";
  }
  // Mensajes escritos a propósito en los disparadores (P0001).
  if (error.code === "P0001" && message) return message;
  return fallback;
}
