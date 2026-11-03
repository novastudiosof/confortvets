import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarPlus, Camera, FileText, Pencil, Plus, Printer, Stethoscope, Syringe } from "lucide-react";

import { ActionForm } from "@/components/action-form";
import { customFieldItems } from "@/components/custom-field-inputs";
import { DialogForm } from "@/components/dialog-form";
import { PatientFields } from "@/components/patient-fields";
import { DewormingFields, VaccinationFields } from "@/components/preventive-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SelectField, TextAreaField, TextField } from "@/components/ui/fields";
import { DataTable, DefinitionList, EmptyState, Notice, PageHeader, Section, tdClass, thClass } from "@/components/ui/misc";
import { WeightChart } from "@/components/weight-chart";
import { createConsent } from "@/lib/actions/consents";
import { startConsultation } from "@/lib/actions/consultations";
import { addWeight, deleteWeight, markDeceased, reactivatePatient, updatePatient, uploadPatientPhoto } from "@/lib/actions/patients";
import { addDeworming, addVaccination, voidDeworming, voidVaccination } from "@/lib/actions/preventive";
import { can, hasModule, requireAccess } from "@/lib/auth";
import { loadCustomFieldDefs } from "@/lib/custom-fields-server";
import { localParts, formatTime12 } from "@/lib/logic/agenda";
import { calcAge, formatDate, formatDateTime } from "@/lib/logic/dates";
import { REMINDER_KIND_LABEL } from "@/lib/logic/reminders";
import { loadSpeciesAndBreeds } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import type { Consent, Consultation, Deworming, Patient, Reminder, Tutor, Vaccination } from "@/lib/types";

const CONSULT_BADGE = {
  borrador: { label: "Borrador", variant: "warning" },
  cerrada: { label: "Cerrada", variant: "success" },
  anulada: { label: "Anulada", variant: "danger" },
} as const;

const CONSENT_BADGE = {
  pendiente: { label: "Pendiente", variant: "warning" },
  firmada: { label: "Firmada", variant: "success" },
  rechazada: { label: "No autorizó", variant: "danger" },
  anulada: { label: "Anulada", variant: "muted" },
} as const;

export default async function PatientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const ctx = await requireAccess("patients.read");
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const supabase = await createClient();

  const { data } = await supabase.from("patients").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const patient = data as Patient;

  const writable = !ctx.readOnly;
  const canClinical = hasModule(ctx, "clinical") && can(ctx, "clinical.read");
  const canPreventive = hasModule(ctx, "preventive") && can(ctx, "preventive.read");
  const canConsents = hasModule(ctx, "consents") && can(ctx, "consents.read");

  const tabs = [
    { key: "resumen", label: "Resumen", show: true },
    { key: "historia", label: "Historia clínica", show: canClinical },
    { key: "preventivo", label: "Vacunas y desparasitación", show: canPreventive },
    { key: "autorizaciones", label: "Autorizaciones", show: canConsents },
  ].filter((t) => t.show);
  const tab = tabs.some((t) => t.key === tabParam) ? (tabParam as string) : "resumen";

  const [{ data: tutorRow }, { species, breeds }] = await Promise.all([
    can(ctx, "tutors.read")
      ? supabase.from("tutors").select("id, full_name, phone, whatsapp").eq("id", patient.tutor_id).maybeSingle()
      : Promise.resolve({ data: null }),
    loadSpeciesAndBreeds(),
  ]);
  const tutor = tutorRow as Pick<Tutor, "id" | "full_name" | "phone" | "whatsapp"> | null;
  const speciesName = species.find((s) => s.id === patient.species_id)?.name ?? "—";
  const breedName = (patient.breed_id && breeds.find((b) => b.id === patient.breed_id)?.name) || patient.breed_text || "—";
  const age = calcAge(patient.birth_date, ctx.today);
  const deceased = patient.status === "fallecido";

  // Próxima cita del paciente (si la agenda está activa)
  const canAgenda = hasModule(ctx, "agenda") && can(ctx, "agenda.read");
  const { data: nextAppt } = canAgenda
    ? await supabase
        .from("appointments")
        .select("id, starts_at, reason")
        .eq("patient_id", id)
        .in("status", ["programada", "confirmada", "en_sala"])
        .gte("starts_at", new Date().toISOString())
        .order("starts_at")
        .limit(1)
        .maybeSingle()
    : { data: null };
  const nextLocal = nextAppt ? localParts(nextAppt.starts_at as string, ctx.tz) : null;

  return (
    <>
      <PageHeader
        actions={
          canAgenda && can(ctx, "agenda.write") && writable && !deceased ? (
            <Button asChild variant="outline">
              <Link href={`/dashboard/agenda?nueva=1&paciente=${id}`}>
                <CalendarPlus /> Agendar cita
              </Link>
            </Button>
          ) : undefined
        }
        back={
          <Link href="/dashboard/pacientes" className="mb-2 inline-flex items-center gap-1 text-sm text-brand-muted hover:text-brand-ink">
            <ArrowLeft className="h-4 w-4" /> Pacientes
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {patient.photo_file_id && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/files/${patient.photo_file_id}`} alt={patient.name} className="h-14 w-14 rounded-full object-cover" />
            )}
            {patient.name}
            {deceased && <Badge variant="muted">Fallecido</Badge>}
          </span>
        }
        description={
          <>
            {speciesName} · {breedName} · {patient.sex === "indeterminado" ? "sexo no definido" : patient.sex}
            {age ? ` · ${age}` : ""}
            {tutor && (
              <>
                {" · Tutor: "}
                <Link href={`/dashboard/tutores/${tutor.id}`} className="text-brand-dark hover:underline">
                  {tutor.full_name}
                </Link>
              </>
            )}
          </>
        }
      />

      {nextLocal && (
        <Notice tone="info" className="mb-4">
          <strong>Próxima cita:</strong>{" "}
          <Link href={`/dashboard/agenda?vista=dia&fecha=${nextLocal.date}`} className="text-brand-dark hover:underline">
            {formatDate(nextLocal.date)} a las {formatTime12(nextLocal.time)}
          </Link>
          {nextAppt?.reason ? ` · ${nextAppt.reason}` : ""}
        </Notice>
      )}

      {patient.allergies && (
        <Notice tone="warning" className="mb-4">
          <strong>Alergias:</strong> {patient.allergies}
        </Notice>
      )}

      <nav className="no-print mb-6 flex flex-wrap gap-1 border-b border-brand-border" aria-label="Secciones del paciente">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/dashboard/pacientes/${id}?tab=${t.key}`}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              tab === t.key ? "border-brand text-brand-dark" : "border-transparent text-brand-muted hover:text-brand-ink"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "resumen" && (
        <SummaryTab
          ctx={ctx}
          patient={patient}
          species={species}
          breeds={breeds}
          writable={writable}
          deceased={deceased}
          canPreventive={canPreventive}
        />
      )}
      {tab === "historia" && <HistoryTab ctx={ctx} patient={patient} writable={writable} />}
      {tab === "preventivo" && <PreventiveTab ctx={ctx} patient={patient} writable={writable} deceased={deceased} tutorWhatsapp={tutor?.whatsapp ?? null} />}
      {tab === "autorizaciones" && <ConsentsTab ctx={ctx} patient={patient} writable={writable} />}
    </>
  );
}

type PageCtx = Awaited<ReturnType<typeof requireAccess>>;

// ---------------------------------------------------------------------------
async function SummaryTab({
  ctx,
  patient,
  species,
  breeds,
  writable,
  deceased,
  canPreventive,
}: {
  ctx: PageCtx;
  patient: Patient;
  species: Awaited<ReturnType<typeof loadSpeciesAndBreeds>>["species"];
  breeds: Awaited<ReturnType<typeof loadSpeciesAndBreeds>>["breeds"];
  writable: boolean;
  deceased: boolean;
  canPreventive: boolean;
}) {
  const supabase = await createClient();
  const [{ data: weights }, customDefs] = await Promise.all([
    supabase
      .from("patient_weights")
      .select("id, weight_kg, measured_at, notes")
      .eq("patient_id", patient.id)
      .order("measured_at", { ascending: true })
      .limit(200),
    loadCustomFieldDefs("patient"),
  ]);
  const points = (weights ?? []) as { id: string; weight_kg: number; measured_at: string; notes: string | null }[];
  const canWrite = can(ctx, "patients.write") && writable;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2 no-print">
        {canWrite && (
          <DialogForm
            trigger={
              <>
                <Pencil /> Editar datos
              </>
            }
            triggerVariant="outline"
            title={`Editar a ${patient.name}`}
            action={updatePatient.bind(null, patient.id)}
            wide
          >
            <PatientFields patient={patient} species={species} breeds={breeds} customDefs={customDefs} />
          </DialogForm>
        )}
        {canWrite && can(ctx, "files.upload") && (
          <DialogForm
            trigger={
              <>
                <Camera /> {patient.photo_file_id ? "Cambiar foto" : "Subir foto"}
              </>
            }
            triggerVariant="outline"
            title="Foto del paciente"
            description="La imagen se reduce automáticamente para ahorrar espacio."
            action={uploadPatientPhoto.bind(null, patient.id)}
            encType="multipart/form-data"
          >
            <input type="file" name="file" accept="image/png,image/jpeg,image/webp" required className="text-sm" />
          </DialogForm>
        )}
        {canPreventive && (
          <>
            <Button asChild variant="outline">
              <Link href={`/dashboard/pacientes/${patient.id}/carne`}>
                <Printer /> Carné de vacunación
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/dashboard/pacientes/${patient.id}/certificado`}>
                <FileText /> Certificado de salud
              </Link>
            </Button>
          </>
        )}
        {canWrite && !deceased && (
          <DialogForm
            trigger="Registrar fallecimiento"
            triggerVariant="ghost"
            title={`Registrar el fallecimiento de ${patient.name}`}
            description="Se descartarán sus recordatorios pendientes. La historia clínica se conserva."
            action={markDeceased.bind(null, patient.id)}
          >
            <TextField label="Fecha" name="deceased_at" type="date" defaultValue={ctx.today} max={ctx.today} required />
            <TextAreaField label="Motivo o causa" name="deceased_reason" rows={2} />
          </DialogForm>
        )}
        {canWrite && deceased && (
          <ActionForm action={reactivatePatient.bind(null, patient.id)} submitLabel="Marcar como activo" submitVariant="outline" className="!gap-0" />
        )}
      </div>

      <Section title="Datos del paciente">
        <DefinitionList
          items={[
            { label: "Color", value: patient.color },
            { label: "Fecha de nacimiento", value: patient.birth_date ? `${formatDate(patient.birth_date)}${patient.birth_date_approx ? " (aprox.)" : ""}` : null },
            { label: "Microchip", value: patient.microchip },
            { label: "Esterilizado", value: patient.sterilized === null ? "No se sabe" : patient.sterilized ? "Sí" : "No" },
            ...(deceased ? [{ label: "Fallecimiento", value: `${formatDate(patient.deceased_at)}${patient.deceased_reason ? ` · ${patient.deceased_reason}` : ""}` }] : []),
            ...customFieldItems(customDefs, patient.custom_fields),
          ]}
        />
        {patient.background && (
          <div className="mt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-brand-muted">Antecedentes</p>
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-brand-ink">{patient.background}</p>
          </div>
        )}
      </Section>

      <Section
        title="Peso"
        actions={
          canWrite && (
            <DialogForm
              trigger={
                <>
                  <Plus /> Registrar peso
                </>
              }
              triggerVariant="outline"
              triggerSize="sm"
              title="Registrar peso"
              action={addWeight.bind(null, patient.id)}
            >
              <TextField label="Peso (kg)" name="weight_kg" inputMode="decimal" required />
              <TextField label="Fecha" name="measured_at" type="date" defaultValue={ctx.today} max={ctx.today} />
              <TextField label="Nota" name="notes" />
            </DialogForm>
          )
        }
      >
        {points.length === 0 ? (
          <EmptyState>Todavía no hay pesos registrados.</EmptyState>
        ) : (
          <div className="flex flex-col gap-4">
            <WeightChart points={points} />
            <DataTable>
              <thead>
                <tr>
                  <th className={thClass}>Fecha</th>
                  <th className={thClass}>Peso</th>
                  <th className={thClass}>Nota</th>
                  <th className={thClass} />
                </tr>
              </thead>
              <tbody>
                {[...points].reverse().slice(0, 10).map((w) => (
                  <tr key={w.id}>
                    <td className={tdClass}>{formatDate(w.measured_at)}</td>
                    <td className={tdClass}>{w.weight_kg} kg</td>
                    <td className={tdClass}>{w.notes ?? ""}</td>
                    <td className={`${tdClass} text-right`}>
                      {canWrite && (
                        <DialogForm
                          trigger="Quitar"
                          triggerVariant="ghost"
                          triggerSize="sm"
                          title="Quitar registro de peso"
                          description={`${formatDate(w.measured_at)} · ${w.weight_kg} kg`}
                          action={deleteWeight.bind(null, patient.id, w.id)}
                          submitLabel="Quitar"
                          submitVariant="destructive"
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </div>
        )}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
async function HistoryTab({ ctx, patient, writable }: { ctx: PageCtx; patient: Patient; writable: boolean }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("consultations")
    .select("id, kind, status, consulted_at, reason, professional_name, definitive_diagnosis")
    .eq("patient_id", patient.id)
    .order("consulted_at", { ascending: false })
    .limit(100);
  const rows = (data ?? []) as Pick<Consultation, "id" | "kind" | "status" | "consulted_at" | "reason" | "professional_name" | "definitive_diagnosis">[];
  const canWrite = can(ctx, "clinical.write") && writable;

  return (
    <Section
      title="Consultas y controles"
      actions={
        canWrite && (
          <div className="flex flex-wrap gap-2">
            <ActionForm action={startConsultation.bind(null, patient.id, "consulta")} submitLabel="Nueva consulta" submitSize="sm" className="!gap-0" />
            <ActionForm action={startConsultation.bind(null, patient.id, "control")} submitLabel="Nuevo control" submitSize="sm" submitVariant="outline" className="!gap-0" />
          </div>
        )
      }
    >
      {rows.length === 0 ? (
        <EmptyState>
          <Stethoscope className="mx-auto mb-2 h-6 w-6" />
          Todavía no hay consultas para este paciente.
        </EmptyState>
      ) : (
        <DataTable>
          <thead>
            <tr>
              <th className={thClass}>Fecha</th>
              <th className={thClass}>Tipo</th>
              <th className={thClass}>Motivo</th>
              <th className={thClass}>Diagnóstico</th>
              <th className={thClass}>Profesional</th>
              <th className={thClass}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="hover:bg-black/[0.02]">
                <td className={tdClass}>
                  <Link href={`/dashboard/consultas/${c.id}`} className="font-medium text-brand-dark hover:underline">
                    {formatDateTime(c.consulted_at, ctx.tz)}
                  </Link>
                </td>
                <td className={tdClass}>{c.kind === "control" ? "Control" : "Consulta"}</td>
                <td className={tdClass}>{c.reason ?? "—"}</td>
                <td className={tdClass}>{c.definitive_diagnosis ?? "—"}</td>
                <td className={tdClass}>{c.professional_name}</td>
                <td className={tdClass}>
                  <Badge variant={CONSULT_BADGE[c.status].variant}>{CONSULT_BADGE[c.status].label}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
async function PreventiveTab({
  ctx,
  patient,
  writable,
  deceased,
  tutorWhatsapp,
}: {
  ctx: PageCtx;
  patient: Patient;
  writable: boolean;
  deceased: boolean;
  tutorWhatsapp: string | null;
}) {
  const supabase = await createClient();
  const canWrite = can(ctx, "preventive.write") && writable && !deceased;

  const [{ data: vacc }, { data: deworm }, { data: vaccineCat }, { data: productCat }, { data: reminders }] = await Promise.all([
    supabase.from("vaccinations").select("*").eq("patient_id", patient.id).order("applied_at", { ascending: false }),
    supabase.from("dewormings").select("*").eq("patient_id", patient.id).order("applied_at", { ascending: false }),
    canWrite
      ? supabase.from("vaccine_catalog").select("id, name, default_booster_days, species_id").eq("is_active", true).order("name")
      : Promise.resolve({ data: [] }),
    canWrite
      ? supabase.from("deworming_products").select("id, name, kind, default_booster_days").eq("is_active", true).order("name")
      : Promise.resolve({ data: [] }),
    supabase
      .from("reminders")
      .select("id, kind, title, due_date, remind_from, status")
      .eq("patient_id", patient.id)
      .in("status", ["pendiente", "enviado"])
      .order("due_date"),
  ]);

  const vaccinations = (vacc ?? []) as Vaccination[];
  const dewormings = (deworm ?? []) as Deworming[];
  const upcoming = (reminders ?? []) as Pick<Reminder, "id" | "kind" | "title" | "due_date" | "status">[];
  const vaccines = ((vaccineCat ?? []) as { id: string; name: string; default_booster_days: number | null; species_id: string | null }[]).filter(
    (v) => !v.species_id || v.species_id === patient.species_id
  );
  const products = (productCat ?? []) as { id: string; name: string; kind: string; default_booster_days: number | null }[];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2 no-print">
        <Button asChild variant="outline">
          <Link href={`/dashboard/pacientes/${patient.id}/carne`}>
            <Printer /> Imprimir carné
          </Link>
        </Button>
        {!tutorWhatsapp && <Badge variant="warning">El tutor no tiene WhatsApp: no se podrán enviar recordatorios</Badge>}
      </div>

      {upcoming.length > 0 && (
        <Section title="Próximos recordatorios">
          <ul className="divide-y divide-brand-border">
            {upcoming.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>
                  {REMINDER_KIND_LABEL[r.kind]} · {r.title}
                </span>
                <Badge variant={r.due_date < ctx.today ? "danger" : "default"}>{formatDate(r.due_date)}</Badge>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section
        title="Vacunas"
        actions={
          canWrite && (
            <DialogForm
              trigger={
                <>
                  <Syringe /> Registrar vacuna
                </>
              }
              title="Registrar vacuna"
              action={addVaccination.bind(null, patient.id)}
              submitLabel="Registrar"
              wide
            >
              <VaccinationFields vaccines={vaccines} today={ctx.today} />
            </DialogForm>
          )
        }
      >
        {vaccinations.length === 0 ? (
          <EmptyState>No hay vacunas registradas.</EmptyState>
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th className={thClass}>Fecha</th>
                <th className={thClass}>Vacuna</th>
                <th className={thClass}>Lote</th>
                <th className={thClass}>Vence</th>
                <th className={thClass}>Próxima</th>
                <th className={thClass}>Aplicó</th>
                <th className={thClass} />
              </tr>
            </thead>
            <tbody>
              {vaccinations.map((v) => (
                <tr key={v.id} className={v.status === "anulada" ? "text-brand-muted line-through" : ""}>
                  <td className={tdClass}>{formatDate(v.applied_at)}</td>
                  <td className={tdClass}>{v.vaccine_name}</td>
                  <td className={tdClass}>{v.lot ?? "—"}</td>
                  <td className={tdClass}>{formatDate(v.expires_at)}</td>
                  <td className={tdClass}>{formatDate(v.next_due_at)}</td>
                  <td className={tdClass}>{v.applied_by_name ?? "—"}</td>
                  <td className={`${tdClass} text-right no-underline`}>
                    {v.status === "anulada" ? (
                      <Badge variant="muted" title={v.void_reason ?? ""}>Anulada</Badge>
                    ) : (
                      canWrite && (
                        <DialogForm
                          trigger="Anular"
                          triggerVariant="ghost"
                          triggerSize="sm"
                          title="Anular registro"
                          description="Un registro no se edita ni se borra: se anula con un motivo y puedes volver a registrarlo correctamente."
                          action={voidVaccination.bind(null, patient.id, v.id)}
                          submitLabel="Anular"
                          submitVariant="destructive"
                        >
                          <TextAreaField label="Motivo" name="reason" required rows={2} />
                        </DialogForm>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Section>

      <Section
        title="Desparasitación"
        actions={
          canWrite && (
            <DialogForm
              trigger={
                <>
                  <Plus /> Registrar desparasitación
                </>
              }
              title="Registrar desparasitación"
              action={addDeworming.bind(null, patient.id)}
              submitLabel="Registrar"
              wide
            >
              <DewormingFields products={products} today={ctx.today} />
            </DialogForm>
          )
        }
      >
        {dewormings.length === 0 ? (
          <EmptyState>No hay desparasitaciones registradas.</EmptyState>
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th className={thClass}>Fecha</th>
                <th className={thClass}>Tipo</th>
                <th className={thClass}>Producto</th>
                <th className={thClass}>Lote</th>
                <th className={thClass}>Vence</th>
                <th className={thClass}>Refuerzo</th>
                <th className={thClass} />
              </tr>
            </thead>
            <tbody>
              {dewormings.map((d) => (
                <tr key={d.id} className={d.status === "anulada" ? "text-brand-muted line-through" : ""}>
                  <td className={tdClass}>{formatDate(d.applied_at)}</td>
                  <td className={tdClass}>{d.kind === "interna" ? "Interna" : "Externa"}</td>
                  <td className={tdClass}>{d.product_name}</td>
                  <td className={tdClass}>{d.lot ?? "—"}</td>
                  <td className={tdClass}>{formatDate(d.expires_at)}</td>
                  <td className={tdClass}>{formatDate(d.next_due_at)}</td>
                  <td className={`${tdClass} text-right no-underline`}>
                    {d.status === "anulada" ? (
                      <Badge variant="muted" title={d.void_reason ?? ""}>Anulada</Badge>
                    ) : (
                      canWrite && (
                        <DialogForm
                          trigger="Anular"
                          triggerVariant="ghost"
                          triggerSize="sm"
                          title="Anular registro"
                          description="Un registro no se edita ni se borra: se anula con un motivo y puedes volver a registrarlo correctamente."
                          action={voidDeworming.bind(null, patient.id, d.id)}
                          submitLabel="Anular"
                          submitVariant="destructive"
                        >
                          <TextAreaField label="Motivo" name="reason" required rows={2} />
                        </DialogForm>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
async function ConsentsTab({ ctx, patient, writable }: { ctx: PageCtx; patient: Patient; writable: boolean }) {
  const supabase = await createClient();
  const canCreate = can(ctx, "consents.create") && writable;

  const [{ data }, templatesRes] = await Promise.all([
    supabase
      .from("consents")
      .select("id, kind, status, title, signed_at, signer_name, created_at, procedure_description")
      .eq("patient_id", patient.id)
      .order("created_at", { ascending: false }),
    canCreate
      ? supabase.from("consent_templates").select("id, title, kind").eq("is_active", true).neq("kind", "datos").order("kind")
      : Promise.resolve({ data: [] }),
  ]);
  const rows = (data ?? []) as Pick<Consent, "id" | "kind" | "status" | "title" | "signed_at" | "signer_name" | "created_at" | "procedure_description">[];
  const templates = (templatesRes.data ?? []) as { id: string; title: string; kind: string }[];

  return (
    <Section
      title="Autorizaciones del paciente"
      actions={
        canCreate &&
        templates.length > 0 && (
          <DialogForm
            trigger={
              <>
                <Plus /> Nueva autorización
              </>
            }
            title="Nueva autorización"
            description="Se prepara con los datos del tutor y del paciente para que el tutor la firme."
            action={createConsent.bind(null, patient.tutor_id, patient.id)}
            submitLabel="Preparar autorización"
          >
            <SelectField label="Tipo" name="template_id" required options={templates.map((t) => ({ value: t.id, label: t.title }))} />
            <TextAreaField
              label="Procedimiento"
              name="procedure_description"
              rows={2}
              hint="Obligatorio para anestesia y procedimientos. Ej.: Esterilización (ovariohisterectomía)."
            />
          </DialogForm>
        )
      }
    >
      {rows.length === 0 ? (
        <EmptyState>Este paciente no tiene autorizaciones.</EmptyState>
      ) : (
        <DataTable>
          <thead>
            <tr>
              <th className={thClass}>Fecha</th>
              <th className={thClass}>Autorización</th>
              <th className={thClass}>Firmó</th>
              <th className={thClass}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="hover:bg-black/[0.02]">
                <td className={tdClass}>{formatDateTime(c.signed_at ?? c.created_at, ctx.tz)}</td>
                <td className={tdClass}>
                  <Link href={`/dashboard/autorizaciones/${c.id}`} className="font-medium text-brand-dark hover:underline">
                    {c.title}
                  </Link>
                  {c.procedure_description && <p className="text-xs text-brand-muted">{c.procedure_description}</p>}
                </td>
                <td className={tdClass}>{c.signer_name ?? "—"}</td>
                <td className={tdClass}>
                  <Badge variant={CONSENT_BADGE[c.status].variant}>{CONSENT_BADGE[c.status].label}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </Section>
  );
}
