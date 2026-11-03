import "server-only";
import sharp from "sharp";

import { dbError } from "@/lib/action-result";
import {
  buildStoragePath,
  classifyUpload,
  extensionFor,
  sniffMime,
  type FileKind,
} from "@/lib/logic/storage";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "org-files";

/** Lado máximo (px) al que se reducen las imágenes de cada tipo. */
const MAX_DIMENSION: Record<FileKind, number> = {
  logo: 512,
  patient_photo: 1024,
  exam: 1600,
  signature: 600,
  consent_upload: 1600,
  other: 1600,
};

export type StoreResult =
  | { ok: true; fileId: string; sizeBytes: number }
  | { ok: false; error: string };

interface StoreOptions {
  orgId: string;
  userId: string;
  kind: FileKind;
  allowPdf: boolean;
  allowImage: boolean;
}

/**
 * Valida, comprime y guarda un archivo en el almacenamiento privado de la
 * organización. El registro en `files` se crea ANTES de subir: el disparador
 * de la base de datos rechaza lo que exceda la cuota, así nunca queda un
 * archivo huérfano ocupando espacio.
 *
 * El llamador debe haber verificado antes el permiso del usuario.
 */
export async function storeUpload(upload: File | { bytes: Uint8Array; name: string; type: string }, options: StoreOptions): Promise<StoreResult> {
  const bytes =
    upload instanceof File ? new Uint8Array(await upload.arrayBuffer()) : upload.bytes;
  const declaredType = upload instanceof File ? upload.type : upload.type;
  const name = upload instanceof File ? upload.name : upload.name;

  const classification = classifyUpload(declaredType, bytes.length, options.allowPdf, options.allowImage);
  if (!classification.ok) return { ok: false, error: classification.error };

  // El tipo real (por la firma del archivo) debe coincidir con el declarado.
  const real = sniffMime(bytes);
  const declaredIsPdf = declaredType === "application/pdf";
  const realIsPdf = real === "application/pdf";
  if (!real || declaredIsPdf !== realIsPdf) {
    return { ok: false, error: "El archivo no es un PDF o una imagen válida" };
  }

  let output: Uint8Array = bytes;
  let mime = real;

  if (classification.type === "image") {
    try {
      const pipeline = sharp(Buffer.from(bytes), { failOn: "error" })
        .rotate()
        .resize({
          width: MAX_DIMENSION[options.kind],
          height: MAX_DIMENSION[options.kind],
          fit: "inside",
          withoutEnlargement: true,
        });
      if (options.kind === "signature") {
        output = await pipeline.png({ compressionLevel: 9 }).toBuffer();
        mime = "image/png";
      } else {
        output = await pipeline.webp({ quality: 80 }).toBuffer();
        mime = "image/webp";
      }
    } catch {
      return { ok: false, error: "No se pudo procesar la imagen" };
    }
  }

  const path = buildStoragePath(options.orgId, options.kind, extensionFor(mime));
  const admin = createAdminClient();

  const { data: row, error: insertError } = await admin
    .from("files")
    .insert({
      organization_id: options.orgId,
      kind: options.kind,
      storage_path: path,
      original_name: name.slice(0, 200),
      mime_type: mime,
      size_bytes: output.length,
      created_by: options.userId,
    })
    .select("id")
    .single();
  if (insertError || !row) {
    return { ok: false, error: dbError(insertError, "No se pudo guardar el archivo") };
  }

  const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, output, {
    contentType: mime,
    upsert: false,
  });
  if (uploadError) {
    await admin.from("files").delete().eq("id", row.id);
    return { ok: false, error: "No se pudo subir el archivo. Inténtalo de nuevo." };
  }

  return { ok: true, fileId: row.id as string, sizeBytes: output.length };
}

/** Borrado lógico: libera la cuota y elimina el objeto del almacenamiento. */
export async function deleteStoredFile(fileId: string, orgId: string, userId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: file } = await admin
    .from("files")
    .select("id, storage_path, deleted_at")
    .eq("id", fileId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!file || file.deleted_at) return;

  await admin
    .from("files")
    .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
    .eq("id", fileId);
  await admin.storage.from(BUCKET).remove([file.storage_path]);
}

/** Decodifica una firma enviada como data URL PNG; null si no es válida. */
export function decodeSignatureDataUrl(dataUrl: string, maxBytes: number): Uint8Array | null {
  const prefix = "data:image/png;base64,";
  if (!dataUrl.startsWith(prefix)) return null;
  const base64 = dataUrl.slice(prefix.length);
  if (base64.length > Math.ceil((maxBytes * 4) / 3) + 8) return null;
  try {
    const bytes = new Uint8Array(Buffer.from(base64, "base64"));
    if (bytes.length === 0 || bytes.length > maxBytes) return null;
    return sniffMime(bytes) === "image/png" ? bytes : null;
  } catch {
    return null;
  }
}
