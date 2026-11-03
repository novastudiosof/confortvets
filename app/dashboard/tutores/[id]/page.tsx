import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileSignature, MessageCircle, Pencil, Plus, ShieldOff } from "lucide-react";

import { customFieldItems } from "@/components/custom-field-inputs";
import { DialogForm } from "@/components/dialog-form";
import { PatientFields } from "@/components/patient-fields";
import { TutorFields } from "@/components/tutor-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/fields";
import { DataTable, DefinitionList, EmptyState, Notice, PageHeader, Section, tdClass, thClass } from "@/components/ui/misc";
import { createConsent } from "@/lib/actions/consents";
import { createPatient } from "@/lib/actions/patients";
import { anonymizeTutor, updateTutor } from "@/lib/actions/tutors";
import { can, hasModule, requireAccess } from "@/lib/auth";
import { loadCustomFieldDefs } from "@/lib/custom-fields-server";
import { calcAge, formatDate, formatDateTime } from "@/lib/logic/dates";
import { whatsappLink } from "@/lib/logic/reminders";
import { missingTutorMessage } from "@/lib/logic/tutor";
import { loadSpeciesAndBreeds } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import type { Patient, Tutor } from "@/lib/types";

const CONSENT_BADGE = {
  pendiente: { label: "Pendiente", variant: "warning" },
  firmada: { label: "Firmada", variant: "success" },
  rechazada: { label: "No autorizó", variant: "danger" },
  anulada: { label: "Anulada", variant: "muted" },
} as const;

export default async function TutorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAccess("tutors.read");
  const { id } = await params;
  const supabase = await createClient();

  const { data } = await supabase.from("tutors").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const tutor = data as Tutor;

  const canPatients = can(ctx, "patients.read");
  const canConsents = hasModule(ctx, "consents") && can(ctx, "consents.read");
  const writable = !ctx.readOnly;

  const [{ data: patientRows }, consentsRes, { species, breeds }, tutorDefs, patientDefs, templatesRes] = await Promise.all([
    canPatients
      ? supabase.from("patients").select("*").eq("tutor_id", id).order("name")
      : Promise.resolve({ data: [] as Patient[] }),
    canConsents
      ? supabase
          .from("consents")
          .select("id, status, title, signed_at, created_at")
          .eq("tutor_id", id)
          .eq("kind", "datos")
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    loadSpeciesAndBreeds(),
    loadCustomFieldDefs("tutor"),
    loadCustomFieldDefs("patient"),
    canConsents && can(ctx, "consents.create") && writable
      ? supabase.from("consent_templates").select("id, title").eq("kind", "datos").eq("is_active", true)
      : Promise.resolve({ data: [] }),
  ]);

  const patients = (patientRows ?? []) as Patient[];
  const speciesName = new Map(species.map((s) => [s.id, s.name]));
  const breedName = new Map(breeds.map((b) => [b.id, b.name]));
  const consents = (consentsRes.data ?? []) as { id: string; status: keyof typeof CONSENT_BADGE; title: string; signed_at: string | null; created_at: string }[];
  const templates = (templatesRes.data ?? []) as { id: string; title: string }[];

  const wa = whatsappLink(tutor.whatsapp, "");
  // Sin la autorización de datos no se registran pacientes (si el módulo está activo).
  const consentPending = hasModule(ctx, "consents") && !tutor.data_consent;
  const missingNote = missingTutorMessage(tutor);

  return (
    <>
      <PageHeader
        back={
          <Link href="/dashboard/tutores" className="mb-2 inline-flex items-center gap-1 text-sm text-brand-muted hover:text-brand-ink">
            <ArrowLeft className="h-4 w-4" /> Tutores
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            {tutor.full_name}
            {!tutor.is_active && <Badge variant="muted">Inactivo</Badge>}
          </span>
        }
        description={tutor.document_number ? `Cédula ${tutor.document_number}` : undefined}
        actions={
          <>
            {wa && (
              <Button asChild variant="whatsapp">
                <a href={wa} target="_blank" rel="noopener noreferrer">
                  <MessageCircle /> WhatsApp
                </a>
              </Button>
            )}
            {can(ctx, "tutors.write") && writable && (
              <DialogForm
                trigger={
                  <>
                    <Pencil /> Editar
                  </>
                }
                triggerVariant="outline"
                title="Editar tutor"
                action={updateTutor.bind(null, id)}
                wide
              >
                <TutorFields tutor={tutor} customDefs={tutorDefs} />
              </DialogForm>
            )}
          </>
        }
      />

      <div className="flex flex-col gap-6">
        {consentPending && (
          <Notice tone="warning">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>Falta la autorización de tratamiento de datos de este tutor. Hasta que se resuelva no se pueden registrar pacientes.</span>
              {can(ctx, "consents.create") && writable && (
                <Button asChild size="sm">
                  <Link href={`/dashboard/tutores/${id}/autorizacion`}>
                    <FileSignature /> Resolver ahora
                  </Link>
                </Button>
              )}
            </div>
          </Notice>
        )}
        {missingNote && <Notice tone="info">{missingNote}</Notice>}
        <Section title="Datos de contacto">
          <DefinitionList
            items={[
              { label: "Teléfono", value: tutor.phone },
              { label: "WhatsApp", value: tutor.whatsapp },
              { label: "Correo", value: tutor.email },
              { label: "Dirección", value: tutor.address },
              { label: "Barrio", value: tutor.neighborhood },
              { label: "Ciudad", value: tutor.city },
              {
                label: "Tratamiento de datos",
                value: tutor.data_consent ? (
                  <Badge variant="success">Autorizó el {formatDate(tutor.data_consent_at, ctx.tz)}</Badge>
                ) : (
                  <Badge variant="warning">Sin autorización registrada</Badge>
                ),
              },
              {
                label: "Contacto por WhatsApp",
                value: tutor.contact_consent ? (
                  <Badge variant="success">Autorizó</Badge>
                ) : (
                  <Badge variant="warning">Sin autorización registrada</Badge>
                ),
              },
              ...customFieldItems(tutorDefs, tutor.custom_fields),
            ]}
          />
          {tutor.notes && <p className="mt-4 whitespace-pre-wrap text-sm text-brand-ink">{tutor.notes}</p>}
        </Section>

        {canPatients && (
          <Section
            title="Pacientes"
            actions={
              can(ctx, "patients.write") &&
              writable &&
              !consentPending && (
                <DialogForm
                  trigger={
                    <>
                      <Plus /> Nuevo paciente
                    </>
                  }
                  title={`Nuevo paciente de ${tutor.full_name}`}
                  action={createPatient.bind(null, id)}
                  submitLabel="Crear paciente"
                  wide
                >
                  <PatientFields species={species} breeds={breeds} customDefs={patientDefs} askWeight />
                </DialogForm>
              )
            }
          >
            {patients.length === 0 ? (
              <EmptyState>Este tutor todavía no tiene pacientes.</EmptyState>
            ) : (
              <DataTable>
                <thead>
                  <tr>
                    <th className={thClass}>Nombre</th>
                    <th className={thClass}>Especie</th>
                    <th className={thClass}>Raza</th>
                    <th className={thClass}>Edad</th>
                    <th className={thClass}>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {patients.map((p) => (
                    <tr key={p.id} className="hover:bg-black/[0.02]">
                      <td className={tdClass}>
                        <Link href={`/dashboard/pacientes/${p.id}`} className="font-medium text-brand-dark hover:underline">
                          {p.name}
                        </Link>
                      </td>
                      <td className={tdClass}>{speciesName.get(p.species_id) ?? "—"}</td>
                      <td className={tdClass}>{(p.breed_id && breedName.get(p.breed_id)) || p.breed_text || "—"}</td>
                      <td className={tdClass}>{calcAge(p.birth_date, ctx.today) ?? "—"}</td>
                      <td className={tdClass}>
                        {p.status === "fallecido" ? <Badge variant="muted">Fallecido</Badge> : <Badge variant="success">Activo</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}
          </Section>
        )}

        {canConsents && (
          <Section
            title="Autorización de tratamiento de datos"
            actions={
              templates.length > 0 && (
                <DialogForm
                  trigger={
                    <>
                      <FileSignature /> Solicitar firma
                    </>
                  }
                  title="Autorización de tratamiento de datos"
                  description="Se prepara la autorización con los datos del tutor para que la firme."
                  action={createConsent.bind(null, id, null)}
                  submitLabel="Preparar autorización"
                >
                  <SelectField
                    label="Texto"
                    name="template_id"
                    required
                    options={templates.map((t) => ({ value: t.id, label: t.title }))}
                  />
                </DialogForm>
              )
            }
          >
            {consents.length === 0 ? (
              <EmptyState>No hay autorizaciones de datos firmadas en el sistema.</EmptyState>
            ) : (
              <ul className="divide-y divide-brand-border">
                {consents.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <Link href={`/dashboard/autorizaciones/${c.id}`} className="text-brand-dark hover:underline">
                      {c.title} · {formatDateTime(c.signed_at ?? c.created_at, ctx.tz)}
                    </Link>
                    <Badge variant={CONSENT_BADGE[c.status].variant}>{CONSENT_BADGE[c.status].label}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}

        {ctx.profile.role === "owner" && writable && tutor.is_active && (
          <Section title="Derechos del titular de los datos">
            <p className="mb-3 text-sm text-brand-muted">
              Si el tutor pide que se supriman sus datos personales, puedes anonimizarlos. Se borran su nombre, cédula y
              datos de contacto; las historias clínicas de sus pacientes se conservan asociadas a un tutor anonimizado.
              Esta acción no se puede deshacer.
            </p>
            <DialogForm
              trigger={
                <>
                  <ShieldOff /> Anonimizar datos personales
                </>
              }
              triggerVariant="destructive"
              title="Anonimizar datos personales"
              description="Escribe ANONIMIZAR para confirmar."
              action={anonymizeTutor.bind(null, id)}
              submitLabel="Anonimizar"
              submitVariant="destructive"
            >
              <TextField label="Confirmación" name="confirm" autoComplete="off" required />
            </DialogForm>
          </Section>
        )}
      </div>
    </>
  );
}
