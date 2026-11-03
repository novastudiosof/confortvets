import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PrintButton } from "@/components/print/print-button";
import { PrintSheet, ProfessionalSignature } from "@/components/print/print-sheet";
import { Button } from "@/components/ui/button";
import { TextAreaField, TextField } from "@/components/ui/fields";
import { requireAccess } from "@/lib/auth";
import { calcAge, formatDate } from "@/lib/logic/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Certificado de salud" };

export default async function HealthCertificatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ finalidad?: string; obs?: string }>;
}) {
  const ctx = await requireAccess("preventive.read");
  const { id } = await params;
  const { finalidad = "", obs = "" } = await searchParams;
  const supabase = await createClient();

  const { data: patient } = await supabase.from("patients").select("*").eq("id", id).maybeSingle();
  if (!patient) notFound();

  const [{ data: vacc }, { data: deworm }, { data: species }, tutorRes] = await Promise.all([
    supabase.from("vaccinations").select("vaccine_name, applied_at, next_due_at").eq("patient_id", id).eq("status", "aplicada").order("applied_at", { ascending: false }).limit(10),
    supabase.from("dewormings").select("kind, product_name, applied_at, next_due_at").eq("patient_id", id).eq("status", "aplicada").order("applied_at", { ascending: false }).limit(4),
    supabase.from("species").select("name").eq("id", patient.species_id).maybeSingle(),
    ctx.permissions.has("tutors.read")
      ? supabase.from("tutors").select("full_name, document_number").eq("id", patient.tutor_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  let breed = (patient.breed_text as string | null) ?? null;
  if (patient.breed_id) {
    const { data: b } = await supabase.from("breeds").select("name").eq("id", patient.breed_id).maybeSingle();
    breed = (b?.name as string | undefined) ?? breed;
  }
  const tutor = tutorRes.data as { full_name: string; document_number: string | null } | null;
  const age = calcAge(patient.birth_date as string | null, ctx.today);
  const finalidadText = finalidad.slice(0, 200);
  const obsText = obs.slice(0, 1500);

  return (
    <>
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href={`/dashboard/pacientes/${id}`} className="inline-flex items-center gap-1 text-sm text-brand-muted hover:text-brand-ink">
          <ArrowLeft className="h-4 w-4" /> Volver al paciente
        </Link>
        <PrintButton />
      </div>

      <form method="get" className="no-print mx-auto mb-6 flex max-w-3xl flex-col gap-3 rounded-[var(--radius-brand-md)] border border-brand-border bg-white p-4">
        <p className="text-sm text-brand-muted">Personaliza el certificado y luego imprímelo.</p>
        <TextField label="Finalidad" name="finalidad" defaultValue={finalidadText} placeholder="Ej.: Presentar ante una guardería canina" />
        <TextAreaField label="Observaciones del examen" name="obs" defaultValue={obsText} rows={3} />
        <div>
          <Button type="submit" variant="outline" size="sm">
            Actualizar vista previa
          </Button>
        </div>
      </form>

      <PrintSheet settings={ctx.settings} title="Certificado de salud veterinario">
        <p className="mb-4 leading-relaxed">
          Yo, <strong>{ctx.settings.professional_name ?? ctx.profile.full_name}</strong>
          {ctx.settings.professional_card ? `, con tarjeta profesional ${ctx.settings.professional_card}` : ""}, médico
          veterinario, certifico que el paciente <strong>{patient.name as string}</strong>,{" "}
          {(species?.name as string | undefined)?.toLowerCase() ?? "animal de compañía"}
          {breed ? ` de raza ${breed}` : ""}
          {patient.sex !== "indeterminado" ? `, ${patient.sex as string}` : ""}
          {age ? `, de ${age} de edad` : ""}
          {patient.microchip ? `, microchip ${patient.microchip as string}` : ""}
          {tutor ? `, propiedad de ${tutor.full_name}${tutor.document_number ? ` (CC ${tutor.document_number})` : ""}` : ""}, fue
          examinado(a) el {formatDate(ctx.today)}.
        </p>

        {obsText && (
          <p className="mb-4 whitespace-pre-wrap">
            <strong>Observaciones:</strong> {obsText}
          </p>
        )}
        {finalidadText && (
          <p className="mb-4">
            <strong>Se expide para:</strong> {finalidadText}
          </p>
        )}

        <h3 className="mb-1 font-semibold">Vacunación registrada</h3>
        <ul className="mb-4 list-disc pl-5">
          {(vacc ?? []).length === 0 && <li>Sin vacunas registradas.</li>}
          {(vacc ?? []).map((v, i) => (
            <li key={i}>
              {v.vaccine_name as string} — aplicada el {formatDate(v.applied_at as string)}
              {v.next_due_at ? `; próxima ${formatDate(v.next_due_at as string)}` : ""}
            </li>
          ))}
        </ul>

        <h3 className="mb-1 font-semibold">Desparasitación registrada</h3>
        <ul className="mb-4 list-disc pl-5">
          {(deworm ?? []).length === 0 && <li>Sin desparasitaciones registradas.</li>}
          {(deworm ?? []).map((d, i) => (
            <li key={i}>
              {(d.kind as string) === "interna" ? "Interna" : "Externa"}: {d.product_name as string} — {formatDate(d.applied_at as string)}
              {d.next_due_at ? `; refuerzo ${formatDate(d.next_due_at as string)}` : ""}
            </li>
          ))}
        </ul>

        <p className="mt-6 rounded border border-brand-border bg-black/[0.03] p-2 text-xs text-brand-muted">
          Este es un certificado simple expedido por el médico veterinario con base en el examen y los registros del
          paciente. No reemplaza los documentos oficiales de movilización o viaje que exijan las autoridades.
        </p>

        <ProfessionalSignature settings={ctx.settings} />
      </PrintSheet>
    </>
  );
}
