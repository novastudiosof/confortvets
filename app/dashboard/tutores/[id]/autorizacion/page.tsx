import { notFound, redirect } from "next/navigation";
import { FileSignature } from "lucide-react";

import { ActionForm } from "@/components/action-form";
import { ConsentSigning } from "@/components/consent-signing";
import { PrintSheet } from "@/components/print/print-sheet";
import { Notice, PageHeader, Section } from "@/components/ui/misc";
import { startDataConsent } from "@/lib/actions/consents";
import { can, requireAccess } from "@/lib/auth";
import { missingTutorMessage } from "@/lib/logic/tutor";
import { createClient } from "@/lib/supabase/server";
import type { Tutor } from "@/lib/types";

export const metadata = { title: "Autorización de datos" };

/**
 * Paso obligatorio después de crear un tutor: la autorización de tratamiento
 * de datos, firmada en pantalla o registrada como ya firmada en físico. No hay
 * botón para saltarla: al resolverla se vuelve a la ficha del tutor.
 */
export default async function TutorConsentStepPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAccess("consents.create");
  const { id } = await params;
  const supabase = await createClient();

  const { data } = await supabase.from("tutors").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const tutor = data as Tutor;
  if (tutor.data_consent) redirect(`/dashboard/tutores/${id}`);

  const { data: pending } = await supabase
    .from("consents")
    .select("id, title, body")
    .eq("tutor_id", id)
    .eq("kind", "datos")
    .eq("status", "pendiente")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const missing = missingTutorMessage(tutor);
  const canSign = can(ctx, "consents.sign") && !ctx.readOnly;

  return (
    <>
      <PageHeader
        title="Autorización de tratamiento de datos"
        description={`Tutor: ${tutor.full_name}. Debe quedar resuelta antes de seguir.`}
      />

      <div className="flex flex-col gap-6">
        {missing && <Notice tone="info">{missing}</Notice>}

        {!pending ? (
          <Section title="Preparar la autorización">
            <p className="mb-4 text-sm text-brand-muted">
              Se prepara el texto con los datos del tutor para que lo lea y lo firme, o para registrar que ya lo firmó en físico.
            </p>
            <ActionForm action={startDataConsent.bind(null, id)} submitLabel="Preparar autorización" submitSize="lg">
              <span className="inline-flex items-center gap-2 text-sm text-brand-muted">
                <FileSignature className="h-4 w-4" /> El tutor debe leer el texto completo antes de firmar.
              </span>
            </ActionForm>
          </Section>
        ) : (
          <>
            <PrintSheet settings={ctx.settings} title={pending.title as string}>
              <p className="whitespace-pre-wrap leading-relaxed">{pending.body as string}</p>
            </PrintSheet>

            {canSign ? (
              <>
                <Notice tone="info">
                  Elige una de las dos opciones para continuar. Esta firma cubre el tratamiento de datos del tutor y de todas
                  sus mascotas; las autorizaciones de procedimientos se firman aparte, una por cada procedimiento.
                </Notice>
                <ConsentSigning
                  consentId={pending.id as string}
                  signerName={tutor.full_name}
                  signerDocument={tutor.document_number ?? ""}
                  canUpload={can(ctx, "files.upload")}
                  next={`/dashboard/tutores/${id}`}
                />
              </>
            ) : (
              <Notice tone="danger">No tienes permiso para registrar firmas o la membresía está vencida.</Notice>
            )}
          </>
        )}
      </div>
    </>
  );
}
