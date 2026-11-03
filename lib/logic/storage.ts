export const MAX_PDF_BYTES = 5 * 1024 * 1024;
/** Tamaño máximo de una imagen ANTES de comprimirla. */
export const MAX_IMAGE_INPUT_BYTES = 10 * 1024 * 1024;
export const MAX_SIGNATURE_BYTES = 200 * 1024;

export type FileKind = "logo" | "patient_photo" | "exam" | "signature" | "consent_upload" | "other";

export type UploadClass =
  | { ok: true; type: "image" | "pdf" }
  | { ok: false; error: string };

export function classifyUpload(
  mime: string,
  size: number,
  allowPdf: boolean,
  allowImage: boolean
): UploadClass {
  if (size <= 0) return { ok: false, error: "El archivo está vacío" };
  if (mime === "application/pdf") {
    if (!allowPdf) return { ok: false, error: "Aquí solo se aceptan imágenes" };
    if (size > MAX_PDF_BYTES) {
      return { ok: false, error: `El PDF no puede superar ${formatBytes(MAX_PDF_BYTES)}` };
    }
    return { ok: true, type: "pdf" };
  }
  if (["image/png", "image/jpeg", "image/webp"].includes(mime)) {
    if (!allowImage) return { ok: false, error: "Aquí solo se aceptan archivos PDF" };
    if (size > MAX_IMAGE_INPUT_BYTES) {
      return { ok: false, error: `La imagen no puede superar ${formatBytes(MAX_IMAGE_INPUT_BYTES)}` };
    }
    return { ok: true, type: "image" };
  }
  return { ok: false, error: "Formato no permitido (usa PDF, JPG, PNG o WebP)" };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export interface QuotaCheck {
  ok: boolean;
  remainingBytes: number;
  message?: string;
}

export function checkQuota(usedBytes: number, quotaMb: number, newBytes: number): QuotaCheck {
  const quotaBytes = quotaMb * 1024 * 1024;
  const remainingBytes = Math.max(quotaBytes - usedBytes, 0);
  if (usedBytes + newBytes > quotaBytes) {
    return {
      ok: false,
      remainingBytes,
      message: `No hay espacio suficiente: quedan ${formatBytes(remainingBytes)} de ${formatBytes(quotaBytes)}. Libera archivos o contacta a tu proveedor para ampliar el espacio.`,
    };
  }
  return { ok: true, remainingBytes: quotaBytes - usedBytes - newBytes };
}

export function extensionFor(mime: string): string {
  switch (mime) {
    case "application/pdf":
      return "pdf";
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    default:
      return "webp";
  }
}

/** Ruta en el bucket: <organization_id>/<tipo>/<uuid>.<ext> */
export function buildStoragePath(
  orgId: string,
  kind: FileKind,
  ext: string,
  id: string = crypto.randomUUID()
): string {
  return `${orgId}/${kind}/${id}.${ext}`;
}

/** Comprueba la firma real del archivo (no solo lo que dice el navegador). */
export function sniffMime(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 5 &&
    bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d
  ) {
    return "application/pdf";
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}
