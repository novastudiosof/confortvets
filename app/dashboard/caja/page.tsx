import Link from "next/link";
import { ArrowDownCircle, ArrowUpCircle, Lock, Unlock } from "lucide-react";
import { redirect } from "next/navigation";

import { DialogForm } from "@/components/dialog-form";
import { Badge } from "@/components/ui/badge";
import { SelectField, TextAreaField, TextField } from "@/components/ui/fields";
import { DataTable, EmptyState, Notice, PageHeader, Section, Stat, tdClass, thClass } from "@/components/ui/misc";
import { addCashMovement, closeCash, openCash } from "@/lib/actions/inventory";
import { can, requireOrgContext } from "@/lib/auth";
import { formatDateTime } from "@/lib/logic/dates";
import { PAYMENT_METHODS, formatMoney, paymentLabel } from "@/lib/logic/inventory";
import { rowsById } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Caja" };

interface Totals {
  opening: number;
  payments_by_method: Record<string, number>;
  refunds_by_method: Record<string, number>;
  cash_sales: number;
  cash_in: number;
  cash_out: number;
  cash_refunds: number;
  expected_cash: number;
}

export default async function CashPage() {
  const ctx = await requireOrgContext();
  const canSee = can(ctx, "sales.read") || can(ctx, "sales.write") || can(ctx, "cash.manage");
  if (!canSee) redirect("/dashboard?sin_acceso=1");
  const canManage = can(ctx, "cash.manage") && !ctx.readOnly;
  const supabase = await createClient();
  const currency = ctx.settings.currency;

  const [{ data: open }, { data: history }] = await Promise.all([
    supabase.from("cash_sessions").select("*").eq("status", "abierta").maybeSingle(),
    supabase.from("cash_sessions").select("*").eq("status", "cerrada").order("closed_at", { ascending: false }).limit(15),
  ]);

  let totals: Totals | null = null;
  let payments: { id: string; sale_id: string; method: string; amount: number; paid_at: string }[] = [];
  let movements: { id: string; kind: string; method: string; amount: number; concept: string; created_at: string }[] = [];
  let sales = new Map<string, { id: string; full_number: string }>();
  if (open) {
    const [t, p, m] = await Promise.all([
      supabase.rpc("cash_session_totals", { p_session: open.id as string }),
      supabase.from("payments").select("id, sale_id, method, amount, paid_at").eq("session_id", open.id as string).order("paid_at", { ascending: false }),
      supabase.from("cash_movements").select("id, kind, method, amount, concept, created_at").eq("session_id", open.id as string).order("created_at", { ascending: false }),
    ]);
    totals = (t.data as Totals | null) ?? null;
    payments = (p.data ?? []) as typeof payments;
    movements = (m.data ?? []) as typeof movements;
    sales = await rowsById<{ id: string; full_number: string }>("sales", payments.map((x) => x.sale_id), "id, full_number");
  }

  const methodRows = (rec: Record<string, number> | undefined) => Object.entries(rec ?? {}).filter(([, v]) => Number(v) > 0);

  return (
    <>
      <PageHeader
        title="Caja"
        description="Abre la caja al empezar el turno y ciérrala al terminar: el sistema calcula cuánto efectivo debería haber."
        actions={
          <>
            <Link href="/dashboard/ventas?estado=pendiente" className="text-sm text-brand-dark hover:underline">
              Ver ventas por cobrar
            </Link>
            {canManage && !open && (
              <DialogForm
                trigger={
                  <>
                    <Unlock /> Abrir caja
                  </>
                }
                title="Abrir caja"
                description="Escribe el efectivo con el que empiezas el turno."
                action={openCash}
                submitLabel="Abrir caja"
              >
                <TextField label="Efectivo inicial" name="opening_amount" inputMode="decimal" defaultValue="0" required />
                <TextField label="Notas (opcional)" name="notes" />
              </DialogForm>
            )}
          </>
        }
      />
      {ctx.readOnly && (
        <Notice tone="warning" className="mb-4">
          Tu membresía venció: puedes consultar la caja pero no abrirla ni cerrarla.
        </Notice>
      )}

      {!open ? (
        <Notice tone="info" className="mb-6">
          <span className="inline-flex items-center gap-2">
            <Lock className="h-4 w-4" /> La caja está cerrada. Ábrela para poder cobrar ventas y abonos.
          </span>
        </Notice>
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Efectivo inicial" value={formatMoney(totals?.opening ?? open.opening_amount, currency)} hint={`Abierta ${formatDateTime(open.opened_at as string, ctx.tz)}`} />
            <Stat label="Ventas en efectivo" value={formatMoney(totals?.cash_sales ?? 0, currency)} />
            <Stat label="Ingresos − egresos − devoluciones" value={formatMoney((totals?.cash_in ?? 0) - (totals?.cash_out ?? 0) - (totals?.cash_refunds ?? 0), currency)} />
            <Stat label="Efectivo esperado" value={formatMoney(totals?.expected_cash ?? 0, currency)} hint="Lo que debería haber en la caja" />
          </div>

          <div className="mb-6 flex flex-wrap gap-2">
            {canManage && (
              <>
                <DialogForm
                  trigger={
                    <>
                      <ArrowUpCircle /> Ingreso
                    </>
                  }
                  triggerVariant="outline"
                  title="Registrar ingreso a la caja"
                  action={addCashMovement}
                  submitLabel="Registrar"
                >
                  <input type="hidden" name="kind" value="ingreso" />
                  <TextField label="Concepto" name="concept" required placeholder="Ej.: cambio para el turno" />
                  <TextField label="Valor" name="amount" inputMode="decimal" required />
                  <SelectField label="Medio" name="method" defaultValue="efectivo" options={[...PAYMENT_METHODS]} />
                </DialogForm>
                <DialogForm
                  trigger={
                    <>
                      <ArrowDownCircle /> Egreso
                    </>
                  }
                  triggerVariant="outline"
                  title="Registrar egreso de la caja"
                  action={addCashMovement}
                  submitLabel="Registrar"
                >
                  <input type="hidden" name="kind" value="egreso" />
                  <TextField label="Concepto" name="concept" required placeholder="Ej.: pago de domicilio, compra de insumos" />
                  <TextField label="Valor" name="amount" inputMode="decimal" required />
                  <SelectField label="Medio" name="method" defaultValue="efectivo" options={[...PAYMENT_METHODS]} />
                </DialogForm>
                <DialogForm
                  trigger={
                    <>
                      <Lock /> Cerrar caja
                    </>
                  }
                  triggerVariant="destructive"
                  title="Cerrar caja"
                  description={`Cuenta el efectivo que hay. El sistema esperaba ${formatMoney(totals?.expected_cash ?? 0, currency)}.`}
                  action={closeCash.bind(null, open.id as string)}
                  submitLabel="Cerrar caja"
                  submitVariant="destructive"
                >
                  <TextField label="Efectivo contado" name="counted_cash" inputMode="decimal" required />
                  <TextAreaField label="Notas (opcional)" name="notes" rows={2} />
                </DialogForm>
              </>
            )}
          </div>

          <div className="mb-6 grid gap-6 lg:grid-cols-2">
            <Section title="Cobrado por medio de pago">
              {methodRows(totals?.payments_by_method).length === 0 ? (
                <EmptyState>Todavía no hay cobros en este turno.</EmptyState>
              ) : (
                <ul className="divide-y divide-brand-border">
                  {methodRows(totals?.payments_by_method).map(([method, amount]) => (
                    <li key={method} className="flex justify-between py-2 text-sm">
                      <span>{paymentLabel(method)}</span>
                      <strong>{formatMoney(amount, currency)}</strong>
                    </li>
                  ))}
                  {methodRows(totals?.refunds_by_method).map(([method, amount]) => (
                    <li key={`r-${method}`} className="flex justify-between py-2 text-sm text-brand-danger">
                      <span>Devoluciones · {paymentLabel(method)}</span>
                      <strong>−{formatMoney(amount, currency)}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Movimientos del turno">
              {payments.length === 0 && movements.length === 0 ? (
                <EmptyState>Sin movimientos todavía.</EmptyState>
              ) : (
                <ul className="divide-y divide-brand-border text-sm">
                  {payments.map((p) => (
                    <li key={p.id} className="flex justify-between gap-2 py-2">
                      <span>
                        Cobro{" "}
                        <Link href={`/dashboard/ventas/${p.sale_id}`} className="text-brand-dark hover:underline">
                          {sales.get(p.sale_id)?.full_number ?? "venta"}
                        </Link>{" "}
                        · {paymentLabel(p.method)}
                      </span>
                      <span className="text-brand-success">+{formatMoney(p.amount, currency)}</span>
                    </li>
                  ))}
                  {movements.map((m) => (
                    <li key={m.id} className="flex justify-between gap-2 py-2">
                      <span>
                        <Badge variant={m.kind === "ingreso" ? "success" : "danger"}>{m.kind}</Badge> {m.concept} · {paymentLabel(m.method)}
                      </span>
                      <span className={m.kind === "ingreso" ? "text-brand-success" : "text-brand-danger"}>
                        {m.kind === "ingreso" ? "+" : "−"}
                        {formatMoney(m.amount, currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </>
      )}

      <Section title="Cierres anteriores">
        {(history ?? []).length === 0 ? (
          <EmptyState>Todavía no hay cajas cerradas.</EmptyState>
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th className={thClass}>Cierre</th>
                <th className={thClass}>Esperado</th>
                <th className={thClass}>Contado</th>
                <th className={thClass}>Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {(history ?? []).map((h) => {
                const diff = Number(h.difference ?? 0);
                return (
                  <tr key={h.id as string}>
                    <td className={tdClass}>{formatDateTime(h.closed_at as string, ctx.tz)}</td>
                    <td className={tdClass}>{formatMoney(h.expected_cash as number, currency)}</td>
                    <td className={tdClass}>{formatMoney(h.counted_cash as number, currency)}</td>
                    <td className={`${tdClass} font-medium ${diff === 0 ? "" : diff > 0 ? "text-brand-success" : "text-brand-danger"}`}>
                      {diff === 0 ? "Cuadró" : `${diff > 0 ? "+" : ""}${formatMoney(diff, currency)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        )}
      </Section>
    </>
  );
}
