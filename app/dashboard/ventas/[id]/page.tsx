import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { DialogForm } from "@/components/dialog-form";
import { PrintButton } from "@/components/print/print-button";
import { PrintSheet } from "@/components/print/print-sheet";
import { Badge } from "@/components/ui/badge";
import { SelectField, TextAreaField, TextField } from "@/components/ui/fields";
import { Notice, PageHeader, Section } from "@/components/ui/misc";
import { addSalePayment, voidSale } from "@/lib/actions/inventory";
import { can, requireOrgContext } from "@/lib/auth";
import { formatDateTime } from "@/lib/logic/dates";
import { PAYMENT_METHODS, SALE_STATUS, formatMoney, formatQty, paymentLabel } from "@/lib/logic/inventory";
import { createClient } from "@/lib/supabase/server";

export default async function SalePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireOrgContext();
  if (!can(ctx, "sales.read") && !can(ctx, "sales.write")) redirect("/dashboard?sin_acceso=1");
  const { id } = await params;
  const supabase = await createClient();
  const currency = ctx.settings.currency;

  const { data: sale } = await supabase.from("sales").select("*").eq("id", id).maybeSingle();
  if (!sale) notFound();
  const [{ data: items }, { data: payments }] = await Promise.all([
    supabase.from("sale_items").select("*").eq("sale_id", id).order("sort_order"),
    supabase.from("payments").select("id, method, amount, reference, paid_at").eq("sale_id", id).order("paid_at"),
  ]);
  let patientName: string | null = null;
  if (sale.patient_id) {
    const { data: p } = await supabase.from("patients").select("name").eq("id", sale.patient_id as string).maybeSingle();
    patientName = (p?.name as string | undefined) ?? null;
  }

  const st = SALE_STATUS[sale.status as keyof typeof SALE_STATUS];
  const writable = !ctx.readOnly;
  const canPay = can(ctx, "sales.write") && writable && sale.status === "pendiente";
  const canVoid = can(ctx, "cash.manage") && writable && sale.status !== "anulada";

  return (
    <>
      <div className="no-print">
        <PageHeader
          back={
            <Link href="/dashboard/ventas" className="mb-2 inline-flex items-center gap-1 text-sm text-brand-muted hover:text-brand-ink">
              <ArrowLeft className="h-4 w-4" /> Ventas
            </Link>
          }
          title={
            <span className="flex flex-wrap items-center gap-2">
              Venta {sale.full_number as string}
              <Badge variant={st.variant}>{st.label}</Badge>
            </span>
          }
          description={formatDateTime(sale.sold_at as string, ctx.tz)}
          actions={
            <>
              <PrintButton label="Imprimir recibo" />
              {canPay && (
                <DialogForm
                  trigger="Registrar abono"
                  title="Registrar abono"
                  description={`Saldo pendiente: ${formatMoney(sale.balance as number, currency)}`}
                  action={addSalePayment.bind(null, id)}
                  submitLabel="Registrar abono"
                >
                  <SelectField label="Medio de pago" name="method" defaultValue="efectivo" options={[...PAYMENT_METHODS]} />
                  <TextField label="Valor" name="amount" inputMode="decimal" required defaultValue={String(sale.balance)} />
                  <TextField label="Referencia" name="reference" />
                </DialogForm>
              )}
              {canVoid && (
                <DialogForm
                  trigger="Anular venta"
                  triggerVariant="ghost"
                  title="Anular venta"
                  description="Se devuelven las existencias y, si había pagos, se registra su devolución en la caja abierta. La venta no se borra."
                  action={voidSale.bind(null, id)}
                  submitLabel="Anular"
                  submitVariant="destructive"
                >
                  <TextAreaField label="Motivo" name="reason" required rows={2} />
                </DialogForm>
              )}
            </>
          }
        />
        {sale.status === "anulada" && (
          <Notice tone="danger" className="mb-4">
            Venta anulada el {formatDateTime(sale.voided_at as string, ctx.tz)}. Motivo: {sale.void_reason as string}
          </Notice>
        )}
        {sale.status === "pendiente" && (
          <Notice tone="warning" className="mb-4">
            Saldo por cobrar: <strong>{formatMoney(sale.balance as number, currency)}</strong>
            {sale.customer_name ? ` · ${sale.customer_name as string}` : ""}
          </Notice>
        )}
      </div>

      <PrintSheet settings={ctx.settings} title={`Recibo ${sale.full_number as string}`} subtitle={formatDateTime(sale.sold_at as string, ctx.tz)}>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-muted">Documento interno · No es factura electrónica</p>
        <div className="mb-4 grid gap-1 text-sm sm:grid-cols-2">
          <p>
            <strong>Cliente:</strong> {(sale.customer_name as string | null) ?? "Mostrador"}
          </p>
          {sale.customer_doc_number && (
            <p>
              <strong>{(sale.customer_doc_type as string | null) ?? "Documento"}:</strong> {sale.customer_doc_number as string}
            </p>
          )}
          {patientName && (
            <p>
              <strong>Paciente:</strong> {patientName}
            </p>
          )}
        </div>

        <table className="mb-4 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-brand-border text-xs uppercase text-brand-muted">
              <th className="py-1.5">Descripción</th>
              <th className="py-1.5 text-right">Cant.</th>
              <th className="py-1.5 text-right">Precio</th>
              <th className="py-1.5 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {(items ?? []).map((it) => (
              <tr key={it.id as string} className="border-b border-brand-border/60">
                <td className="py-1.5">
                  {it.description as string}
                  {Number(it.discount) > 0 && <span className="block text-xs text-brand-muted">Descuento: {formatMoney(it.discount as number, currency)}</span>}
                </td>
                <td className="py-1.5 text-right">{formatQty(it.quantity as number)}</td>
                <td className="py-1.5 text-right">{formatMoney(it.unit_price as number, currency)}</td>
                <td className="py-1.5 text-right">{formatMoney(it.line_total as number, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="ml-auto grid max-w-xs gap-1 text-sm">
          <div className="flex justify-between">
            <dt>Subtotal (sin IVA)</dt>
            <dd>{formatMoney(sale.subtotal as number, currency)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>IVA</dt>
            <dd>{formatMoney(sale.tax_total as number, currency)}</dd>
          </div>
          <div className="flex justify-between border-t border-brand-border pt-1 text-base font-bold">
            <dt>Total</dt>
            <dd>{formatMoney(sale.total as number, currency)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Pagado</dt>
            <dd>{formatMoney(sale.paid_total as number, currency)}</dd>
          </div>
          {Number(sale.balance) > 0 && (
            <div className="flex justify-between font-semibold">
              <dt>Saldo pendiente</dt>
              <dd>{formatMoney(sale.balance as number, currency)}</dd>
            </div>
          )}
        </dl>

        {(payments ?? []).length > 0 && (
          <div className="mt-4 text-sm">
            <p className="mb-1 font-semibold">Pagos</p>
            <ul>
              {(payments ?? []).map((p) => (
                <li key={p.id as string} className="flex justify-between">
                  <span>
                    {paymentLabel(p.method as string)}
                    {p.reference ? ` · ${p.reference as string}` : ""} · {formatDateTime(p.paid_at as string, ctx.tz)}
                  </span>
                  <span>{formatMoney(p.amount as number, currency)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {sale.notes && <p className="mt-4 text-sm">Notas: {sale.notes as string}</p>}
      </PrintSheet>

      <div className="no-print mt-6">
        <Section title="Para la facturación electrónica">
          <p className="text-sm text-brand-muted">
            Esta venta ya guarda los datos que pide la DIAN (base, IVA por línea, documento del cliente y numeración por serie). Cuando
            conectes un proveedor de facturación electrónica, no será necesario volver a registrar nada.
          </p>
        </Section>
      </div>
    </>
  );
}
