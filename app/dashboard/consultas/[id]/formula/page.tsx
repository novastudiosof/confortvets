import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PrintButton } from "@/components/print/print-button";
import { PrintSheet, ProfessionalSignature } from "@/components/print/print-sheet";
import { requireAccess } from "@/lib/auth";
import { calcAge, formatDate } from "@/lib/logic/dates";
import { createClient } from "@/lib/supabase/server";
import type { PrescriptionItem } from "@/lib/types";

export const metadata = { title: "Fórmula médica" };

export default async function FormulaPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAccess("clinical.read");
  const { id } = await params;
  const supabase = await createClient();

  const { data: prescription } = await supabase.from("prescriptions").select("*").eq("consultation_id", id).maybeSingle();
  if (!prescription) notFound();

  const [{ data: items }, { data: consultation }, { data: patient }] = await Promise.all([
    supabase.from("prescription_items").select("*").eq("prescription_id", prescription.id).order("sort_order"),
    supabase.from("consultations").select("id, status, weight_kg, consulted_at").eq("id", id).maybeSingle(),
    supabase.from("patients").select("id, name, tutor_id, species_id, breed_id, breed_text, sex, birth_date").eq("id", prescription.patient_id).maybeSingle(),
  ]);
  if (!patient || !consultation) notFound();

  const [{ data: tutor }, { data: species }] = await Promise.all([
    ctx.permissions.has("tutors.read")
      ? supabase.from("tutors").select("full_name, document_number").eq("id", patient.tutor_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("species").select("name").eq("id", patient.species_id).maybeSingle(),
  ]);

  let breed = (patient.breed_text as string | null) ?? null;
  if (patient.breed_id) {
    const { data: b } = await supabase.from("breeds").select("name").eq("id", patient.breed_id).maybeSingle();
    breed = (b?.name as string | undefined) ?? breed;
  }

  const rows = (items ?? []) as PrescriptionItem[];
  const age = calcAge(patient.birth_date as string | null, ctx.today);

  return (
    <>
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href={`/dashboard/consultas/${id}`} className="inline-flex items-center gap-1 text-sm text-brand-muted hover:text-brand-ink">
          <ArrowLeft className="h-4 w-4" /> Volver a la consulta
        </Link>
        <PrintButton />
      </div>

      <PrintSheet settings={ctx.settings} title="Fórmula médica veterinaria" subtitle={`N.° ${prescription.number} · ${formatDate(prescription.issued_at, ctx.tz)}`}>
        <div className="mb-5 grid gap-x-6 gap-y-1 sm:grid-cols-2">
          <p><strong>Paciente:</strong> {patient.name as string}</p>
          <p><strong>Especie:</strong> {(species?.name as string | undefined) ?? "—"}{breed ? ` · ${breed}` : ""}</p>
          <p><strong>Sexo:</strong> {patient.sex === "indeterminado" ? "—" : (patient.sex as string)}</p>
          <p><strong>Edad:</strong> {age ?? "—"}</p>
          {consultation.weight_kg != null && <p><strong>Peso:</strong> {consultation.weight_kg as number} kg</p>}
          {tutor && (
            <p>
              <strong>Tutor:</strong> {tutor.full_name as string}
              {tutor.document_number ? ` · CC ${tutor.document_number}` : ""}
            </p>
          )}
        </div>

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-brand-ink text-left">
              <th className="py-1.5 pr-2">Medicamento</th>
              <th className="py-1.5 pr-2">Dosis</th>
              <th className="py-1.5 pr-2">Frecuencia</th>
              <th className="py-1.5 pr-2">Duración</th>
              <th className="py-1.5">Vía</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((it) => (
              <tr key={it.id} className="border-b border-brand-border align-top">
                <td className="py-2 pr-2">
                  <strong>{it.medication_name}</strong>
                  {it.presentation && <span className="block text-xs text-brand-muted">{it.presentation}</span>}
                  {it.instructions && <span className="block text-xs">{it.instructions}</span>}
                </td>
                <td className="py-2 pr-2">{it.dose ?? ""}</td>
                <td className="py-2 pr-2">{it.frequency ?? ""}</td>
                <td className="py-2 pr-2">{it.duration ?? ""}</td>
                <td className="py-2">{it.route ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {prescription.notes && (
          <p className="mt-4 whitespace-pre-wrap">
            <strong>Observaciones:</strong> {prescription.notes as string}
          </p>
        )}

        <ProfessionalSignature settings={ctx.settings} name={prescription.professional_name as string} />
      </PrintSheet>
    </>
  );
}
