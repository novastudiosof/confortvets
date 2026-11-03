/** Datos del tutor que conviene tener, aunque ninguno sea obligatorio. */
const RECOMMENDED: { key: string; label: string }[] = [
  { key: "document_number", label: "cédula" },
  { key: "phone_any", label: "teléfono o WhatsApp" },
  { key: "address", label: "dirección" },
  { key: "neighborhood", label: "barrio" },
];

interface TutorContact {
  document_number?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  address?: string | null;
  neighborhood?: string | null;
}

/** Etiquetas de los datos recomendados que están vacíos. */
export function missingTutorFields(tutor: TutorContact): string[] {
  const filled = (v: string | null | undefined) => Boolean(v && v.trim());
  return RECOMMENDED.filter(({ key }) => {
    if (key === "phone_any") return !filled(tutor.phone) && !filled(tutor.whatsapp);
    return !filled(tutor[key as keyof TutorContact]);
  }).map((f) => f.label);
}

/** Mensaje informativo (no bloquea): qué datos faltan por completar. */
export function missingTutorMessage(tutor: TutorContact): string | null {
  const missing = missingTutorFields(tutor);
  if (missing.length === 0) return null;
  return `Faltan datos por completar: ${missing.join(", ")}. Puedes agregarlos cuando los tengas.`;
}
