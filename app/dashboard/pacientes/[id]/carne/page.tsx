import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PrintButton } from "@/components/print/print-button";
import { PrintSheet, ProfessionalSignature } from "@/components/print/print-sheet";
import { requireAccess } from "@/lib/auth";
import { calcAge, formatDate } from "@/lib/logic/dates";
import { createClient } from "@/lib/supabase/server";
import type { Deworming, Vaccination } from "@/lib/types";

export const metadata = { title: "Carné de vacunación" };

export default async function VaccinationCardPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAccess("preventive.read");
  const { id } = await params;
  const supabase = await createClient();

  const { data: patient } = await supabase.from("patients").select("*").eq("id", id).maybeSingle();
  if (!patient) notFound();

  const [{ data: vacc }, { data: deworm }, { data: species }, tutorRes] = await Promise.all([
    supabase.from("vaccinations").select("*").eq("patient_id", id).eq("status", "aplicada").order("applied_at"),
    supabase.from("dewormings").select("*").eq("patient_id", id).eq("status", "aplicada").order("applied_at"),
    supabase.from("species").select("name").eq("id", patient.species_id).maybeSingle(),
    ctx.permissions.has("tutors.read")
      ? supabase.from("tutors").select("full_name, document_number, phone").eq("id", patient.tutor_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  let breed = (patient.breed_text as string | null) ?? null;
  if (patient.breed_id) {
    const { data: b } = await supabase.from("breeds").select("name").eq("id", patient.breed_id).maybeSingle();
    breed = (b?.name as string | undefined) ?? breed;
  }

  const vaccinations = (vacc ?? []) as Vaccination[];
  const dewormings = (deworm ?? []) as Deworming[];
  const tutor = tutorRes.data as { full_name: string; document_number: string | null; phone: string | null } | null;
  const th = "border border-brand-border bg-black/[0.04] px-2 py-1 text-left text-xs";
  const td = "border border-brand-border px-2 py-1 text-xs";

  return (
    <>
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href={`/dashboard/pacientes/${id}?tab=preventivo`} className="inline-flex items-center gap-1 text-sm text-brand-muted hover:text-brand-ink">
          <ArrowLeft className="h-4 w-4" /> Volver al paciente
        </Link>
        <PrintButton />
      </div>

      <PrintSheet settings={ctx.settings} title="Carné de vacunación y desparasitación">
        <div className="mb-5 grid gap-x-6 gap-y-1 sm:grid-cols-2">
          <p><strong>Paciente:</strong> {patient.name as string}</p>
          <p><strong>Especie:</strong> {(species?.name as string | undefined) ?? "—"}{breed ? ` · ${breed}` : ""}</p>
          <p><strong>Sexo:</strong> {patient.sex === "indeterminado" ? "—" : (patient.sex as string)}</p>
          <p><strong>Nacimiento:</strong> {formatDate(patient.birth_date as string | null)}{calcAge(patient.birth_date as string | null, ctx.today) ? ` (${calcAge(patient.birth_date as string | null, ctx.today)})` : ""}</p>
          {patient.microchip && <p><strong>Microchip:</strong> {patient.microchip as string}</p>}
          {tutor && (
            <p>
              <strong>Tutor:</strong> {tutor.full_name}
              {tutor.document_number ? ` · CC ${tutor.document_number}` : ""}
            </p>
          )}
        </div>

        <h3 className="mb-1 font-semibold">Vacunas</h3>
        <table className="mb-5 w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>Fecha</th>
              <th className={th}>Vacuna</th>
              <th className={th}>Lote</th>
              <th className={th}>Vence</th>
              <th className={th}>Próxima</th>
              <th className={th}>Aplicó</th>
            </tr>
          </thead>
          <tbody>
            {vaccinations.length === 0 && (
              <tr>
                <td className={td} colSpan={6}>Sin vacunas registradas.</td>
              </tr>
            )}
            {vaccinations.map((v) => (
              <tr key={v.id}>
                <td className={td}>{formatDate(v.applied_at)}</td>
                <td className={td}>{v.vaccine_name}</td>
                <td className={td}>{v.lot ?? ""}</td>
                <td className={td}>{formatDate(v.expires_at)}</td>
                <td className={td}>{formatDate(v.next_due_at)}</td>
                <td className={td}>{v.applied_by_name ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 className="mb-1 font-semibold">Desparasitación</h3>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>Fecha</th>
              <th className={th}>Tipo</th>
              <th className={th}>Producto</th>
              <th className={th}>Lote</th>
              <th className={th}>Vence</th>
              <th className={th}>Refuerzo</th>
            </tr>
          </thead>
          <tbody>
            {dewormings.length === 0 && (
              <tr>
                <td className={td} colSpan={6}>Sin desparasitaciones registradas.</td>
              </tr>
            )}
            {dewormings.map((d) => (
              <tr key={d.id}>
                <td className={td}>{formatDate(d.applied_at)}</td>
                <td className={td}>{d.kind === "interna" ? "Interna" : "Externa"}</td>
                <td className={td}>{d.product_name}</td>
                <td className={td}>{d.lot ?? ""}</td>
                <td className={td}>{formatDate(d.expires_at)}</td>
                <td className={td}>{formatDate(d.next_due_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="mt-4 text-xs text-brand-muted">Expedido el {formatDate(ctx.today)}.</p>
        <ProfessionalSignature settings={ctx.settings} />
      </PrintSheet>
    </>
  );
}
