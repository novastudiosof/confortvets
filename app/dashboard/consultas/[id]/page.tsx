import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText, Paperclip, PackageMinus, Pencil, Printer, Receipt, Trash2 } from "lucide-react";

import { ActionForm } from "@/components/action-form";
import { CONSULTATION_FORM_ID, ConsultationEditor } from "@/components/consultation-editor";
import { CustomFieldInputs, customFieldItems } from "@/components/custom-field-inputs";
import { DialogForm } from "@/components/dialog-form";
import { FilePicker } from "@/components/file-picker";
import { PrescriptionEditor } from "@/components/prescription-editor";
import { UseInventoryFields } from "@/components/use-inventory-fields";
import { TemplateInsert } from "@/components/template-insert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SelectField, TextAreaField, TextField } from "@/components/ui/fields";
import { DataTable, DefinitionList, EmptyState, Notice, PageHeader, Section, tdClass, thClass } from "@/components/ui/misc";
import { useInConsultation } from "@/lib/actions/inventory";
import { addAddendum, adminEditConsultation, deleteExam, saveConsultation, savePrescription, uploadExam, voidConsultation } from "@/lib/actions/consultations";
import { can, hasModule, requireAccess } from "@/lib/auth";
import { loadCustomFieldDefs } from "@/lib/custom-fields-server";
import { formatDate, formatDateTime } from "@/lib/logic/dates";
import { formatBytes } from "@/lib/logic/storage";
import { formatQty } from "@/lib/logic/inventory";
import { rowsById } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import type { Consultation, FileRow, Prescription, PrescriptionItem } from "@/lib/types";

const STATUS = {
  borrador: { label: "Borrador", variant: "warning" },
  cerrada: { label: "Cerrada", variant: "success" },
  anulada: { label: "Anulada", variant: "danger" },
} as const;

const SNAPSHOT_FIELDS: [string, string][] = [
  ["reason", "Motivo"],
  ["anamnesis", "Anamnesis"],
  ["weight_kg", "Peso (kg)"],
  ["temperature_c", "Temperatura (°C)"],
  ["heart_rate", "FC"],
  ["resp_rate", "FR"],
  ["mucous_membranes", "Mucosas"],
  ["capillary_refill_s", "Llenado capilar (s)"],
  ["hydration", "Turgencia cutánea"],
  ["body_condition", "Condición corporal"],
  ["differential_diagnoses", "Diagnósticos diferenciales"],
  ["exams_notes", "Exámenes solicitados"],
  ["definitive_diagnosis", "Diagnóstico definitivo"],
  ["treatment", "Tratamiento"],
  ["recommendations", "Recomendaciones"],
  ["next_control_date", "Próximo control"],
];

interface TemplateRow {
  id: string;
  kind: string;
  title: string;
  body: string;
}

export default async function ConsultationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ editar?: string }>;
}) {
  const ctx = await requireAccess("clinical.read");
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();

  const { data } = await supabase.from("consultations").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const c = data as Consultation;

  const draft = c.status === "borrador";
  const canWrite = can(ctx, "clinical.write") && !ctx.readOnly;
  const editable = draft && canWrite;
  // El administrador puede corregir una historia ya cerrada (queda la versión anterior y el motivo).
  const isOwner = ctx.profile.role === "owner";
  const canAdminEdit = c.status === "cerrada" && isOwner && canWrite;
  const adminEditing = canAdminEdit && sp.editar === "1";
  const formEditable = editable || adminEditing;

  const [
    { data: patient },
    { data: controlTypes },
    customDefs,
    { data: addenda },
    { data: examRows },
    { data: revisions },
    { data: prescriptionRow },
    templatesRes,
    medsRes,
  ] = await Promise.all([
    supabase.from("patients").select("id, name, tutor_id").eq("id", c.patient_id).maybeSingle(),
    supabase.from("control_types").select("id, name, is_active").order("sort_order"),
    loadCustomFieldDefs("consultation"),
    supabase.from("consultation_addenda").select("id, content, author_name, created_at").eq("consultation_id", id).order("created_at"),
    supabase.from("exam_files").select("id, exam_name, notes, file_id, created_at").eq("consultation_id", id).order("created_at"),
    c.edit_count > 0
      ? supabase.from("consultation_revisions").select("id, revision, snapshot, reason, edited_by_name, edited_at").eq("consultation_id", id).order("revision", { ascending: false })
      : Promise.resolve({ data: [] }),
    supabase.from("prescriptions").select("*").eq("consultation_id", id).maybeSingle(),
    formEditable ? supabase.from("text_templates").select("id, kind, title, body").eq("is_active", true).order("title") : Promise.resolve({ data: [] }),
    editable && can(ctx, "prescriptions.write")
      ? supabase.from("medications").select("name, presentation, default_dose, default_frequency, default_duration, route").eq("is_active", true).order("name")
      : Promise.resolve({ data: [] }),
  ]);

  const prescription = (prescriptionRow as Prescription | null) ?? null;
  const items: PrescriptionItem[] = prescription
    ? (((await supabase.from("prescription_items").select("*").eq("prescription_id", prescription.id).order("sort_order")).data ?? []) as PrescriptionItem[])
    : [];

  // Inventario: descontar lo usado y cobrar la consulta
  const invOn = hasModule(ctx, "inventory");
  const canUseInv = invOn && can(ctx, "inventory.write") && !ctx.readOnly && c.status !== "anulada";
  const canCharge = invOn && can(ctx, "sales.write") && !ctx.readOnly && c.status !== "anulada";
  let usableProducts: { id: string; name: string; unit: string; stock: number }[] = [];
  let suggestedIds: string[] = [];
  let usedLines: { name: string; quantity: number }[] = [];
  if (invOn && (can(ctx, "inventory.read") || can(ctx, "sales.write"))) {
    const { data: prodRows } = canUseInv
      ? await supabase.from("products").select("id, name, unit, stock").eq("is_active", true).eq("is_service", false).order("name").limit(3000)
      : { data: [] };
    usableProducts = (prodRows ?? []).map((p) => ({ id: p.id as string, name: p.name as string, unit: p.unit as string, stock: Number(p.stock) }));
    const names = items.map((it) => it.medication_name.trim().toLowerCase()).filter(Boolean);
    suggestedIds = usableProducts
      .filter((p) => names.some((n) => p.name.toLowerCase().includes(n) || n.includes(p.name.toLowerCase())))
      .map((p) => p.id);
  }
  if (invOn && can(ctx, "inventory.read")) {
    const { data: used } = await supabase
      .from("stock_movements")
      .select("product_id, quantity")
      .eq("ref_type", "consultation")
      .eq("ref_id", id)
      .eq("kind", "uso_consulta");
    const usedProducts = await rowsById<{ id: string; name: string }>("products", (used ?? []).map((u) => u.product_id as string), "id, name");
    usedLines = (used ?? []).map((u) => ({ name: usedProducts.get(u.product_id as string)?.name ?? "Producto", quantity: Math.abs(Number(u.quantity)) }));
  }

  // Archivos de los exámenes (no borrados)
  const fileIds = (examRows ?? []).map((e) => e.file_id as string);
  const files = new Map<string, FileRow>();
  if (fileIds.length) {
    const { data: fileRows } = await supabase.from("files").select("id, organization_id, kind, storage_path, original_name, mime_type, size_bytes, created_at, deleted_at").in("id", fileIds);
    for (const f of (fileRows ?? []) as FileRow[]) if (!f.deleted_at) files.set(f.id, f);
  }
  const exams = (examRows ?? []).filter((e) => files.has(e.file_id as string)) as { id: string; exam_name: string; notes: string | null; file_id: string; created_at: string }[];

  const templates = (templatesRes.data ?? []) as TemplateRow[];
  const forKind = (kind: string) => templates.filter((t) => t.kind === kind);
  const controlOptions = ((controlTypes ?? []) as { id: string; name: string; is_active: boolean }[])
    .filter((t) => t.is_active || t.id === c.control_type_id)
    .map((t) => ({ value: t.id, label: t.name }));
  const controlName = controlOptions.find((o) => o.value === c.control_type_id)?.label;
  const isControl = c.kind === "control";
  const patientName = (patient?.name as string | undefined) ?? "Paciente";
  const canClose = can(ctx, "clinical.close");

  const draftRow = (order: number) => (adminEditing ? null : <DraftSaveRow order={order} />);

  const vitals = [
    { label: "Peso", value: c.weight_kg != null ? `${c.weight_kg} kg` : null },
    { label: "Temperatura", value: c.temperature_c != null ? `${c.temperature_c} °C` : null },
    { label: "Frecuencia cardiaca", value: c.heart_rate != null ? `${c.heart_rate} lpm` : null },
    { label: "Frecuencia respiratoria", value: c.resp_rate != null ? `${c.resp_rate} rpm` : null },
    { label: "Mucosas", value: c.mucous_membranes },
    { label: "Llenado capilar", value: c.capillary_refill_s != null ? `${c.capillary_refill_s} s` : null },
    { label: "Turgencia cutánea", value: c.hydration },
    { label: "Condición corporal", value: c.body_condition != null ? `${c.body_condition}/9` : null },
  ];

  return (
    <>
      <PageHeader
        back={
          <Link href={`/dashboard/pacientes/${c.patient_id}?tab=historia`} className="mb-2 inline-flex items-center gap-1 text-sm text-brand-muted hover:text-brand-ink">
            <ArrowLeft className="h-4 w-4" /> {patientName}
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            {isControl ? "Control" : "Consulta"} · {patientName}
            <Badge variant={STATUS[c.status].variant}>{STATUS[c.status].label}</Badge>
            {c.edit_count > 0 && (
              <Badge variant="warning">
                Corregida {c.edit_count} {c.edit_count === 1 ? "vez" : "veces"}
              </Badge>
            )}
          </span>
        }
        description={`${formatDateTime(c.consulted_at, ctx.tz)} · ${c.professional_name}`}
        actions={
          <>
            {canUseInv && (
              <DialogForm
                trigger={
                  <>
                    <PackageMinus /> Descontar inventario
                  </>
                }
                triggerVariant="outline"
                title="Descontar del inventario"
                description="Elige lo que se usó en esta consulta. Se resta de las existencias (primero los lotes que vencen antes)."
                action={useInConsultation.bind(null, id)}
                submitLabel="Descontar"
                wide
              >
                <UseInventoryFields products={usableProducts} suggested={suggestedIds} />
              </DialogForm>
            )}
            {canCharge && (
              <Button asChild variant="outline">
                <Link href={`/dashboard/ventas/nueva?consulta=${id}`}>
                  <Receipt /> Cobrar
                </Link>
              </Button>
            )}
            {canAdminEdit && !adminEditing && (
              <Button asChild variant="outline">
                <Link href={`/dashboard/consultas/${id}?editar=1`}>
                  <Pencil /> Corregir (administrador)
                </Link>
              </Button>
            )}
            {prescription && (
              <Button asChild variant="outline">
                <Link href={`/dashboard/consultas/${id}/formula`}>
                  <Printer /> Imprimir fórmula
                </Link>
              </Button>
            )}
            {c.status !== "anulada" && can(ctx, "clinical.void") && !ctx.readOnly && (
              <DialogForm
                trigger={
                  <>
                    <Trash2 /> Anular
                  </>
                }
                triggerVariant="ghost"
                title="Anular consulta"
                description="Una consulta no se borra: se anula con un motivo y queda visible en la historia."
                action={voidConsultation.bind(null, id)}
                submitLabel="Anular consulta"
                submitVariant="destructive"
              >
                <TextAreaField label="Motivo de la anulación" name="reason" required rows={3} />
              </DialogForm>
            )}
          </>
        }
      />

      {c.status === "anulada" && (
        <Notice tone="danger" className="mb-6">
          <strong>Consulta anulada</strong> el {formatDateTime(c.voided_at, ctx.tz)}. Motivo: {c.void_reason}
        </Notice>
      )}
      {adminEditing && (
        <Notice tone="warning" className="mb-6">
          <strong>Estás corrigiendo una historia cerrada.</strong> Al guardar, la versión anterior y tu motivo quedan registrados en
          el historial de correcciones. No se puede cambiar el paciente, la fecha ni el estado.{" "}
          <Link href={`/dashboard/consultas/${id}`} className="font-medium text-brand-dark underline">
            Cancelar
          </Link>
        </Notice>
      )}
      {c.status === "cerrada" && !adminEditing && (
        <Notice tone="info" className="mb-6">
          Consulta cerrada el {formatDateTime(c.closed_at, ctx.tz)}. Ya no se puede editar: para corregir algo agrega una
          nota aclaratoria al final.
        </Notice>
      )}

      <div className="flex flex-col gap-6">
        {formEditable ? (
          <ConsultationEditor
            action={adminEditing ? adminEditConsultation.bind(null, id) : saveConsultation.bind(null, id)}
            canClose={canClose}
            mode={adminEditing ? "admin" : "draft"}
          >
            {!isControl && (
              <Section title="1. Motivo de consulta" style={{ order: 10 }}>
                <TextAreaField label="Motivo" name="reason" defaultValue={c.reason ?? ""} rows={2} />
              </Section>
            )}
            {!isControl && draftRow(11)}

            <Section
              title="2. Anamnesis y examen físico"
              style={{ order: 20 }}
              actions={<TemplateInsert target="anamnesis" templates={forKind("anamnesis")} />}
            >
              <div className="flex flex-col gap-4">
                <TextAreaField label="Anamnesis" name="anamnesis" defaultValue={c.anamnesis ?? ""} rows={5} />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <TextField label="Peso (kg)" name="weight_kg" inputMode="decimal" defaultValue={c.weight_kg ?? ""} />
                  <TextField label="Temperatura (°C)" name="temperature_c" inputMode="decimal" defaultValue={c.temperature_c ?? ""} />
                  <TextField label="FC (lpm)" name="heart_rate" inputMode="numeric" defaultValue={c.heart_rate ?? ""} />
                  <TextField label="FR (rpm)" name="resp_rate" inputMode="numeric" defaultValue={c.resp_rate ?? ""} />
                  <TextField label="Mucosas" name="mucous_membranes" defaultValue={c.mucous_membranes ?? ""} />
                  <TextField label="Llenado capilar (s)" name="capillary_refill_s" inputMode="decimal" defaultValue={c.capillary_refill_s ?? ""} />
                  <TextField label="Turgencia cutánea" name="hydration" defaultValue={c.hydration ?? ""} />
                  <TextField label="Condición corporal (1-9)" name="body_condition" inputMode="numeric" defaultValue={c.body_condition ?? ""} />
                </div>
              </div>
            </Section>
            {draftRow(21)}

            {!isControl && (
              <Section
                title="3. Diagnósticos diferenciales"
                style={{ order: 30 }}
                actions={<TemplateInsert target="differential_diagnoses" templates={forKind("diagnosis")} />}
              >
                <TextAreaField label="Diagnósticos diferenciales" name="differential_diagnoses" defaultValue={c.differential_diagnoses ?? ""} rows={3} />
              </Section>
            )}
            {!isControl && draftRow(31)}

            <Section title="4. Exámenes complementarios" style={{ order: 40 }} actions={<TemplateInsert target="exams_notes" templates={forKind("exam")} />}>
              <TextAreaField
                label="Exámenes solicitados u observaciones"
                name="exams_notes"
                defaultValue={c.exams_notes ?? ""}
                rows={2}
                hint="Los resultados en PDF o imagen se adjuntan justo debajo, en «Resultados de exámenes»."
              />
            </Section>
            {draftRow(41)}

            {!isControl && (
              <>
                <Section title="5. Diagnóstico definitivo" style={{ order: 50 }}>
                  <TextAreaField label="Diagnóstico definitivo" name="definitive_diagnosis" defaultValue={c.definitive_diagnosis ?? ""} rows={2} />
                </Section>
                {draftRow(51)}
                <Section title="6. Tratamiento" style={{ order: 60 }} actions={<TemplateInsert target="treatment" templates={forKind("treatment")} />}>
                  <TextAreaField
                    label="Tratamiento"
                    name="treatment"
                    defaultValue={c.treatment ?? ""}
                    rows={4}
                    hint="La fórmula con los medicamentos se arma en la sección «Fórmula médica» de abajo."
                  />
                </Section>
                {draftRow(61)}
              </>
            )}

            <Section
              title={isControl ? "8. Recomendaciones adicionales" : "8. Recomendaciones y próximo control"}
              style={{ order: 80 }}
              actions={<TemplateInsert target="recommendations" templates={forKind("recommendations")} />}
            >
              <div className="flex flex-col gap-4">
                <TextAreaField label="Recomendaciones adicionales" name="recommendations" defaultValue={c.recommendations ?? ""} rows={3} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <SelectField label="Tipo de próximo control" name="control_type_id" placeholder="Sin control programado" defaultValue={c.control_type_id ?? ""} options={controlOptions} />
                  <TextField
                    label="Fecha del próximo control"
                    name="next_control_date"
                    type="date"
                    min={adminEditing ? undefined : ctx.today}
                    defaultValue={c.next_control_date ?? ""}
                    hint="Al cerrar la consulta se crea el recordatorio para el tutor."
                  />
                </div>
              </div>
            </Section>
            {draftRow(81)}

            {customDefs.length > 0 && (
              <>
                <Section title="9. Campos adicionales" style={{ order: 90 }}>
                  <CustomFieldInputs defs={customDefs} values={c.custom_fields} />
                </Section>
                {draftRow(91)}
              </>
            )}
          </ConsultationEditor>
        ) : (
          <ReadOnlyConsultation c={c} isControl={isControl} vitals={vitals} controlName={controlName} customItems={customFieldItems(customDefs, c.custom_fields)} />
        )}

        {/* Exámenes: PDF o imágenes de resultados */}
        <Section title="Resultados de exámenes" style={editable ? { order: 45 } : undefined}>
          {exams.length === 0 ? (
            <EmptyState>
              <Paperclip className="mx-auto mb-2 h-5 w-5" />
              No hay resultados adjuntos.
            </EmptyState>
          ) : (
            <DataTable className="mb-4">
              <thead>
                <tr>
                  <th className={thClass}>Examen</th>
                  <th className={thClass}>Archivo</th>
                  <th className={thClass}>Fecha</th>
                  <th className={thClass} />
                </tr>
              </thead>
              <tbody>
                {exams.map((e) => {
                  const f = files.get(e.file_id)!;
                  return (
                    <tr key={e.id}>
                      <td className={tdClass}>
                        {e.exam_name}
                        {e.notes && <p className="text-xs text-brand-muted">{e.notes}</p>}
                      </td>
                      <td className={tdClass}>
                        <a href={`/api/files/${e.file_id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-dark hover:underline">
                          <FileText className="h-4 w-4" />
                          {f.mime_type === "application/pdf" ? "Ver PDF" : "Ver imagen"} ({formatBytes(f.size_bytes)})
                        </a>
                      </td>
                      <td className={tdClass}>{formatDate(e.created_at, ctx.tz)}</td>
                      <td className={`${tdClass} text-right`}>
                        {editable && (
                          <DialogForm
                            trigger="Quitar"
                            triggerVariant="ghost"
                            triggerSize="sm"
                            title="Quitar resultado"
                            description={e.exam_name}
                            action={deleteExam.bind(null, id, e.id)}
                            submitLabel="Quitar"
                            submitVariant="destructive"
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
          )}
          {canWrite && c.status !== "anulada" && can(ctx, "files.upload") && (
            <ActionForm action={uploadExam.bind(null, id)} submitLabel="Subir resultado" resetOnSuccess encType="multipart/form-data">
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label="Nombre del examen" name="exam_name" required placeholder="Ej.: Hemograma" />
                <TextField label="Nota" name="notes" />
              </div>
              <FilePicker
                accept="application/pdf,image/png,image/jpeg,image/webp"
                required
                label="Elegir el PDF o la imagen del resultado"
                hint="PDF de hasta 5 MB o imagen (se reduce automáticamente)."
              />
            </ActionForm>
          )}
        </Section>

        {editable && draftRow(46)}

        {/* Fórmula médica */}
        {(can(ctx, "prescriptions.write") || prescription) && (
          <Section title="7. Fórmula médica" style={editable ? { order: 70 } : undefined}>
            {editable && can(ctx, "prescriptions.write") ? (
              <PrescriptionEditor
                action={savePrescription.bind(null, id)}
                medications={(medsRes.data ?? []) as never[]}
                initialRows={items.map((it) => ({
                  name: it.medication_name,
                  presentation: it.presentation ?? "",
                  dose: it.dose ?? "",
                  frequency: it.frequency ?? "",
                  duration: it.duration ?? "",
                  route: it.route ?? "",
                  instructions: it.instructions ?? "",
                }))}
                initialNotes={prescription?.notes ?? ""}
              />
            ) : !prescription ? (
              <EmptyState>Esta consulta no tiene fórmula.</EmptyState>
            ) : (
              <>
                <p className="mb-3 text-sm text-brand-muted">Fórmula N.° {prescription.number}</p>
                <DataTable>
                  <thead>
                    <tr>
                      <th className={thClass}>Medicamento</th>
                      <th className={thClass}>Dosis</th>
                      <th className={thClass}>Frecuencia</th>
                      <th className={thClass}>Duración</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => (
                      <tr key={it.id}>
                        <td className={tdClass}>
                          {it.medication_name}
                          {it.presentation && <span className="text-brand-muted"> · {it.presentation}</span>}
                        </td>
                        <td className={tdClass}>{it.dose ?? "—"}</td>
                        <td className={tdClass}>{it.frequency ?? "—"}</td>
                        <td className={tdClass}>{it.duration ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              </>
            )}
          </Section>
        )}

        {editable && draftRow(71)}

        {usedLines.length > 0 && (
          <Section title="Inventario usado en esta consulta">
            <ul className="text-sm">
              {usedLines.map((u, i) => (
                <li key={i} className="flex justify-between border-b border-brand-border/60 py-1.5">
                  <span>{u.name}</span>
                  <span className="text-brand-muted">{formatQty(u.quantity)}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Historial de correcciones del administrador */}
        {(revisions ?? []).length > 0 && (
          <Section title="Historial de correcciones">
            <ul className="flex flex-col gap-3">
              {(revisions ?? []).map((r) => {
                const snap = r.snapshot as Record<string, unknown>;
                return (
                  <li key={r.id as string} className="rounded-[var(--radius-brand-sm)] border border-brand-border p-3 text-sm">
                    <p className="font-medium text-brand-ink">
                      Corrección {r.revision as number} · {r.edited_by_name as string} · {formatDateTime(r.edited_at as string, ctx.tz)}
                    </p>
                    <p className="text-brand-muted">Motivo: {r.reason as string}</p>
                    <details className="mt-1">
                      <summary className="cursor-pointer text-brand-dark">Ver la versión anterior</summary>
                      <dl className="mt-2 grid gap-1">
                        {SNAPSHOT_FIELDS.filter(([key]) => snap[key] != null && snap[key] !== "").map(([key, label]) => (
                          <div key={key}>
                            <dt className="text-xs font-semibold uppercase text-brand-muted">{label}</dt>
                            <dd className="whitespace-pre-wrap">{String(snap[key])}</dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  </li>
                );
              })}
            </ul>
          </Section>
        )}

        {/* Notas aclaratorias */}
        {c.status === "cerrada" && (
          <Section title="Notas aclaratorias">
            {(addenda ?? []).length === 0 ? (
              <p className="mb-4 text-sm text-brand-muted">No hay notas aclaratorias.</p>
            ) : (
              <ul className="mb-4 flex flex-col gap-3">
                {(addenda ?? []).map((a) => (
                  <li key={a.id as number} className="rounded-[var(--radius-brand-sm)] border border-brand-border p-3 text-sm">
                    <p className="whitespace-pre-wrap text-brand-ink">{a.content as string}</p>
                    <p className="mt-1 text-xs text-brand-muted">
                      {a.author_name as string} · {formatDateTime(a.created_at as string, ctx.tz)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {canWrite && (
              <ActionForm action={addAddendum.bind(null, id)} submitLabel="Agregar nota" resetOnSuccess>
                <TextAreaField label="Nueva nota aclaratoria" name="content" required rows={3} hint="Queda registrada con tu nombre y la fecha. No se puede editar ni borrar." />
              </ActionForm>
            )}
          </Section>
        )}
      </div>
    </>
  );
}

/** Guardar borrador a mitad de la consulta (el cierre solo está al final). */
function DraftSaveRow({ order }: { order: number }) {
  return (
    <div style={{ order }} className="flex justify-end">
      <Button type="submit" form={CONSULTATION_FORM_ID} name="intent" value="save" variant="outline" size="sm">
        Guardar borrador
      </Button>
    </div>
  );
}

function ReadOnlyConsultation({
  c,
  isControl,
  vitals,
  controlName,
  customItems,
}: {
  c: Consultation;
  isControl: boolean;
  vitals: { label: string; value: string | null }[];
  controlName: string | undefined;
  customItems: { label: string; value: React.ReactNode }[];
}) {
  const text = (title: string, value: string | null) =>
    value ? (
      <Section title={title}>
        <p className="whitespace-pre-wrap text-sm text-brand-ink">{value}</p>
      </Section>
    ) : null;

  return (
    <>
      {!isControl && text("Motivo de consulta", c.reason)}
      {text("Anamnesis", c.anamnesis)}
      {vitals.some((v) => v.value) && (
        <Section title="Signos vitales y examen físico">
          <DefinitionList items={vitals} />
        </Section>
      )}
      {!isControl && text("Diagnósticos diferenciales", c.differential_diagnoses)}
      {text("Exámenes solicitados", c.exams_notes)}
      {!isControl && text("Diagnóstico definitivo", c.definitive_diagnosis)}
      {!isControl && text("Tratamiento", c.treatment)}
      {text("Recomendaciones adicionales", c.recommendations)}
      {(c.next_control_date || controlName) && (
        <Section title="Próximo control">
          <p className="text-sm text-brand-ink">
            {controlName ?? "Control"} · {formatDate(c.next_control_date)}
          </p>
        </Section>
      )}
      {customItems.length > 0 && (
        <Section title="Campos adicionales">
          <DefinitionList items={customItems} />
        </Section>
      )}
    </>
  );
}
