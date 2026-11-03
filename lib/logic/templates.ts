/** Variables disponibles en los textos de recordatorio y autorización. */
export const TEMPLATE_VARIABLES = [
  "tutor",
  "documento",
  "paciente",
  "especie",
  "clinica",
  "profesional",
  "procedimiento",
  "fecha",
  "motivo",
  "hora",
  "telefono_clinica",
] as const;

export type TemplateVars = Partial<Record<(typeof TEMPLATE_VARIABLES)[number], string>>;

/**
 * Reemplaza {variable}. Las variables conocidas sin valor quedan vacías; las
 * desconocidas se dejan tal cual para que el error sea visible al revisar.
 */
export function renderTemplate(body: string, vars: TemplateVars): string {
  return body.replace(/\{([a-z_]+)\}/g, (match, key: string) => {
    if ((TEMPLATE_VARIABLES as readonly string[]).includes(key)) {
      return (vars as Record<string, string | undefined>)[key] ?? "";
    }
    return match;
  });
}
