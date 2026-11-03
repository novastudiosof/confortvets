export type ReminderKind = "vacuna" | "desparasitante" | "control";
export type ReminderBucket = "vencido" | "hoy" | "proximo";

export const REMINDER_KIND_LABEL: Record<ReminderKind, string> = {
  vacuna: "Vacuna",
  desparasitante: "Desparasitación",
  control: "Control",
};

/**
 * Normaliza un teléfono para WhatsApp (solo dígitos con indicativo de país).
 * Un celular colombiano de 10 dígitos que empieza por 3 recibe el 57.
 */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("3")) return `57${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

export function whatsappLink(phone: string | null | undefined, message: string): string | null {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

/** Clasifica un recordatorio pendiente frente a hoy; null si todavía no toca avisar. */
export function reminderBucket(
  dueDate: string,
  remindFrom: string,
  today: string
): ReminderBucket | null {
  if (dueDate < today) return "vencido";
  if (dueDate === today) return "hoy";
  if (remindFrom <= today) return "proximo";
  return null;
}
