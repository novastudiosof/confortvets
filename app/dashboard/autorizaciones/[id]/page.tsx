import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldCheck, ShieldAlert } from "lucide-react";

import { DialogForm } from "@/components/dialog-form";
import { ActionForm } from "@/components/action-form";
import { PrintButton } from "@/components/print/print-button";
import { PrintSheet } from "@/components/print/print-sheet";
import { ConsentSigning } from "@/components/consent-signing";
import { Badge } from "@/components/ui/badge";
import { TextAreaField } from "@/components/ui/fields";
import { DefinitionList, Notice, PageHeader, Section } from "@/components/ui/misc";
import {
  declineConsent,
  updateConsentProcedure,
  voidConsent,
} from "@/lib/actions/consents";
import { can, requireAccess } from "@/lib/auth";
import { formatDateTime } from "@/lib/logic/dates";
import { createClient } from "@/lib/supabase/server";
import type { Consent } from "@/lib/types";

const STATUS = {
  pendiente: { label: "Pendiente de firma", variant: "warning" },
  firmada: { label: "Firmada", variant: "success" },
  rechazada: { label: "No autorizó", variant: "danger" },
  anulada: { label: "Anulada", variant: "muted" },
} as const;

export default async function ConsentPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAccess("consents.read");
  const { id } = await params;
  const supabase = await createClient();

  const { data } = await supabase.from("consents").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const consent = data as Consent;

  const [{ data: tutor }, patientRes, hashRes] = await Promise.all([
    supabase.from("tutors").select("id, full_name, document_number").eq("id", consent.tutor_id).maybeSingle(),
    consent.patient_id
      ? supabase.from("patients").select("id, name").eq("id", consent.patient_id).maybeSingle()
      : Promise.resolve({ data: null }),
    consent.status === "firmada" ? supabase.rpc("consent_hash_matches", { p_consent: id }) : Promise.resolve({ data: null }),
  ]);
  const patient = patientRes.data as { id: string; name: string } | null;
  const hashOk = hashRes.data as boolean | null;

  const writable = !ctx.readOnly;
  const pending = consent.status === "pendiente";
  const canSign = can(ctx, "consents.sign") && writable && pending;
  const canEdit = can(ctx, "consents.create") && writable;

  return (
    <>
      <div className="no-print">
        <PageHeader
          back={
            <Link
              href={patient ? `/dashboard/pacientes/${patient.id}?tab=autorizaciones` : tutor ? `/dashboard/tutores/${tutor.id}` : "/dashboard/autorizaciones"}
              className="mb-2 inline-flex items-center gap-1 text-sm text-brand-muted hover:text-brand-ink"
            >
              <ArrowLeft className="h-4 w-4" /> Volver
            </Link>
          }
          title={
            <span className="flex flex-wrap items-center gap-2">
              {consent.title}
              <Badge variant={STATUS[consent.status].variant}>{STATUS[consent.status].label}</Badge>
            </span>
          }
          description={[tutor?.full_name, patient?.name].filter(Boolean).join(" · ")}
          actions={
            <>
              <PrintButton label="Imprimir" />
              {canEdit && consent.status !== "anulada" && (
                <DialogForm
                  trigger="Anular"
                  triggerVariant="ghost"
                  title="Anular autorización"
                  description="Una autorización no se borra: se anula con un motivo y queda registrada."
                  action={voidConsent.bind(null, id)}
                  submitLabel="Anular"
                  submitVariant="destructive"
                >
                  <TextAreaField label="Motivo" name="reason" required rows={2} />
                </DialogForm>
              )}
            </>
          }
        />

        {consent.status === "anulada" && (
          <Notice tone="danger" className="mb-4">
            Autorización anulada. Motivo: {consent.void_reason}
          </Notice>
        )}
        {consent.status === "rechazada" && (
          <Notice tone="danger" className="mb-4">
            El tutor no autorizó{consent.decline_reason ? `: ${consent.decline_reason}` : "."}
          </Notice>
        )}
        {pending && (
          <Notice tone="info" className="mb-4">
            Este texto debe ser leído por el tutor antes de firmar. Los textos de las plantillas son de ejemplo: revísalos
            con tu abogado en Configuración → Textos de autorizaciones.
          </Notice>
        )}
      </div>

      {/* Documento: lo que se imprime */}
      <PrintSheet settings={ctx.settings} title={consent.title} subtitle={consent.signed_at ? `Firmada el ${formatDateTime(consent.signed_at, ctx.tz)}` : undefined}>
        {consent.procedure_description && (
          <p className="mb-3">
            <strong>Procedimiento:</strong> {consent.procedure_description}
          </p>
        )}
        <p className="whitespace-pre-wrap leading-relaxed">{consent.body}</p>

        {consent.status === "firmada" && (
          <div className="mt-8">
            {consent.signature_method === "pantalla" && consent.signature_file_id && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/files/${consent.signature_file_id}`} alt="Firma" className="h-24 w-auto border-b border-brand-ink" />
            )}
            {consent.signature_method === "archivo" && (
              <p className="border-b border-brand-ink pb-1 text-xs text-brand-muted">Firmada en papel (documento escaneado adjunto)</p>
            )}
            {consent.signature_method === "fisico" && (
              <p className="border-b border-brand-ink pb-1 text-xs text-brand-muted">Firmada en papel (registrada por el consultorio)</p>
            )}
            <p className="mt-1 text-sm font-medium">{consent.signer_name}</p>
            <p className="text-xs">CC {consent.signer_document}</p>
            <p className="mt-2 break-all text-[10px] text-brand-muted">Huella del contenido (SHA-256): {consent.content_hash}</p>
          </div>
        )}
      </PrintSheet>

      <div className="no-print mt-6 flex flex-col gap-6">
        {consent.status === "firmada" && (
          <Section title="Evidencia de la firma">
            <DefinitionList
              items={[
                { label: "Firmó", value: consent.signer_name },
                { label: "Cédula", value: consent.signer_document },
                { label: "Fecha y hora", value: formatDateTime(consent.signed_at, ctx.tz) },
                {
                  label: "Método",
                  value:
                    consent.signature_method === "pantalla"
                      ? "En pantalla"
                      : consent.signature_method === "archivo"
                        ? "En papel, con copia del documento"
                        : "En papel, sin copia adjunta (anotado por el consultorio)",
                },
                { label: "Dirección IP", value: consent.signer_ip },
                {
                  label: "Integridad",
                  value:
                    hashOk === true ? (
                      <span className="inline-flex items-center gap-1 text-brand-success">
                        <ShieldCheck className="h-4 w-4" /> El contenido no ha sido alterado
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-brand-danger">
                        <ShieldAlert className="h-4 w-4" /> No coincide con la huella
                      </span>
                    ),
                },
              ]}
            />
            {consent.upload_file_id && can(ctx, "consents.read") && (
              <p className="mt-4 text-sm">
                <a href={`/api/files/${consent.upload_file_id}`} target="_blank" rel="noopener noreferrer" className="text-brand-dark hover:underline">
                  Ver el documento firmado subido
                </a>
              </p>
            )}
          </Section>
        )}

        {pending && canEdit && (
          <Section title="Procedimiento">
            <ActionForm action={updateConsentProcedure.bind(null, id)} submitLabel="Actualizar texto">
              <TextAreaField label="Descripción del procedimiento" name="procedure_description" defaultValue={consent.procedure_description ?? ""} rows={2} />
            </ActionForm>
          </Section>
        )}

        {canSign && (
          <>
            <Notice tone="info">
              {consent.kind === "datos"
                ? "Esta autorización de datos se firma una sola vez por tutor y cubre todas sus mascotas."
                : `Esta firma queda guardada únicamente en esta autorización (${consent.title}${patient ? ` · ${patient.name}` : ""}${consent.procedure_description ? ` · ${consent.procedure_description}` : ""}). Para otro procedimiento o paciente se hace una autorización nueva.`}
            </Notice>
            <ConsentSigning
              consentId={id}
              signerName={tutor?.full_name ?? ""}
              signerDocument={tutor?.document_number ?? ""}
              canUpload={can(ctx, "files.upload")}
            />

            <Section title="El tutor no autoriza">
              <DialogForm
                trigger="Registrar que no autorizó"
                triggerVariant="outline"
                title="Registrar que el tutor no autorizó"
                action={declineConsent.bind(null, id)}
                submitLabel="Registrar"
              >
                <TextAreaField label="Motivo (opcional)" name="decline_reason" rows={2} />
              </DialogForm>
            </Section>
          </>
        )}
      </div>
    </>
  );
}
