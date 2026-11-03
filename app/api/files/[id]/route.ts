import { NextResponse } from "next/server";

import { can, getContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/** Permiso que hace falta para ver cada tipo de archivo. */
const READ_PERMISSION: Record<string, string | null> = {
  logo: null, // cualquier miembro de la organización
  other: null,
  patient_photo: "patients.read",
  exam: "clinical.read",
  signature: "consents.read",
  consent_upload: "consents.read",
};

const SIGNED_URL_SECONDS = 120;

/**
 * Entrega un archivo privado: verifica sesión, organización y permiso, y
 * redirige a una URL firmada de muy corta duración.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  if (!ctx || !ctx.org || !ctx.org.is_active) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  // La consulta va con la sesión del usuario: RLS limita a su organización.
  const supabase = await createClient();
  const { data: file } = await supabase
    .from("files")
    .select("id, organization_id, kind, storage_path, deleted_at")
    .eq("id", id)
    .maybeSingle();

  if (!file || file.deleted_at || file.organization_id !== ctx.org.id) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }

  const needed = READ_PERMISSION[file.kind] ?? null;
  if (needed && !can(ctx, needed)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.storage.from("org-files").createSignedUrl(file.storage_path, SIGNED_URL_SECONDS);
  if (error || !data) {
    return NextResponse.json({ error: "No se pudo abrir el archivo" }, { status: 500 });
  }

  const response = NextResponse.redirect(data.signedUrl, 302);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
