import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { SaleEditor } from "@/components/sale-editor";
import { Notice, PageHeader } from "@/components/ui/misc";
import { createSale } from "@/lib/actions/inventory";
import { requireAccess } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Nueva venta" };

export default async function NewSalePage({
  searchParams,
}: {
  searchParams: Promise<{ consulta?: string; paciente?: string; tutor?: string }>;
}) {
  const ctx = await requireAccess("sales.write");
  const sp = await searchParams;
  const supabase = await createClient();

  const [{ data: products }, { data: tutors }, { data: cash }] = await Promise.all([
    supabase.from("products").select("id, name, unit, sale_price, tax_rate, is_service, stock").eq("is_active", true).order("name").limit(3000),
    supabase.from("tutors").select("id, full_name, document_number").eq("is_active", true).order("full_name").limit(3000),
    supabase.from("cash_sessions").select("id").eq("status", "abierta").maybeSingle(),
  ]);

  // Cliente y paciente sugeridos (desde una consulta o un paciente)
  let patientId = sp.paciente ?? "";
  let tutorId = sp.tutor ?? "";
  let consultationId = "";
  if (sp.consulta) {
    const { data: c } = await supabase.from("consultations").select("id, patient_id").eq("id", sp.consulta).maybeSingle();
    if (c) {
      consultationId = c.id as string;
      patientId = c.patient_id as string;
    }
  }
  let patientLabel = "";
  if (patientId) {
    const { data: p } = await supabase.from("patients").select("id, name, tutor_id").eq("id", patientId).maybeSingle();
    if (p) {
      patientLabel = p.name as string;
      tutorId = tutorId || (p.tutor_id as string);
    } else {
      patientId = "";
    }
  }

  return (
    <>
      <PageHeader
        back={
          <Link href="/dashboard/ventas" className="mb-2 inline-flex items-center gap-1 text-sm text-brand-muted hover:text-brand-ink">
            <ArrowLeft className="h-4 w-4" /> Ventas
          </Link>
        }
        title="Nueva venta"
        description="Documento interno de venta (no es factura electrónica)."
      />
      {ctx.readOnly ? (
        <Notice tone="warning">Tu membresía venció: no puedes registrar ventas.</Notice>
      ) : (
        <SaleEditor
          action={createSale}
          products={(products ?? []).map((p) => ({
            id: p.id as string,
            name: p.name as string,
            unit: p.unit as string,
            sale_price: Number(p.sale_price),
            tax_rate: Number(p.tax_rate),
            is_service: Boolean(p.is_service),
            stock: Number(p.stock),
          }))}
          tutors={(tutors ?? []).map((t) => ({ id: t.id as string, label: t.full_name as string, document: (t.document_number as string | null) ?? null }))}
          currency={ctx.settings.currency}
          cashOpen={Boolean(cash)}
          prefill={{ tutorId, patientId, consultationId, patientLabel }}
        />
      )}
    </>
  );
}
