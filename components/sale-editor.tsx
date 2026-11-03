"use client";

import * as React from "react";
import Link from "next/link";
import { useActionState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { SearchPicker } from "@/components/search-picker";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/fields";
import type { ActionResult } from "@/lib/action-result";
import { PAYMENT_METHODS, computeLine, computeTotals, formatMoney, formatQty, round2 } from "@/lib/logic/inventory";

export interface SaleProduct {
  id: string;
  name: string;
  unit: string;
  sale_price: number;
  tax_rate: number;
  is_service: boolean;
  stock: number;
}

interface Line {
  key: number;
  productId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  taxRate: number;
}

interface Payment {
  key: number;
  method: string;
  amount: string;
  reference: string;
}

const num = (v: string): number => {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Venta interna: líneas con precio (IVA incluido), descuento, pagos mixtos y,
 * si lo cobrado no alcanza, saldo pendiente a nombre del cliente (crédito).
 */
export function SaleEditor({
  action,
  products,
  tutors,
  currency,
  cashOpen,
  prefill,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  products: SaleProduct[];
  tutors: { id: string; label: string; document: string | null }[];
  currency: string;
  cashOpen: boolean;
  prefill: { tutorId: string; patientId: string; consultationId: string; patientLabel: string };
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const nextKey = React.useRef(1);
  const [tutorId, setTutorId] = React.useState(prefill.tutorId);
  const [customerName, setCustomerName] = React.useState("");
  const [docType, setDocType] = React.useState("");
  const [docNumber, setDocNumber] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [lines, setLines] = React.useState<Line[]>([]);
  const [payments, setPayments] = React.useState<Payment[]>([]);

  const byId = React.useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const tutor = tutors.find((t) => t.id === tutorId) ?? null;

  const totals = computeTotals(
    lines.map((l) => ({ quantity: num(l.quantity), unitPrice: num(l.unitPrice), discount: num(l.discount), taxRate: l.taxRate }))
  );
  const paid = round2(payments.reduce((s, p) => s + num(p.amount), 0));
  const balance = round2(totals.gross - paid);

  const updateLine = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const updatePay = (key: number, patch: Partial<Payment>) => setPayments((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  function addProduct(id: string) {
    const p = byId.get(id);
    if (!p) return;
    setLines((ls) => [
      ...ls,
      { key: nextKey.current++, productId: id, description: p.name, quantity: "1", unitPrice: String(p.sale_price), discount: "0", taxRate: p.tax_rate },
    ]);
  }

  const payload = JSON.stringify({
    customer_tutor_id: tutorId || null,
    customer_name: customerName || null,
    customer_doc_type: docType || null,
    customer_doc_number: docNumber || null,
    patient_id: prefill.patientId || null,
    consultation_id: prefill.consultationId || null,
    notes,
    items: lines.map((l) => ({
      product_id: l.productId,
      description: l.description,
      quantity: num(l.quantity),
      unit_price: num(l.unitPrice),
      discount: num(l.discount),
      tax_rate: l.taxRate,
    })),
    payments: payments.filter((p) => num(p.amount) > 0).map((p) => ({ method: p.method, amount: num(p.amount), reference: p.reference || null })),
  });

  const hasCustomer = Boolean(tutorId || customerName.trim());

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="payload" value={payload} />

      <section className="rounded-[var(--radius-brand-md)] border border-brand-border bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-base font-semibold text-brand-ink">Cliente</h2>
        {prefill.patientLabel && <p className="mb-3 text-sm text-brand-muted">Paciente: {prefill.patientLabel}</p>}
        {tutor ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-brand-sm)] border border-brand-success/40 bg-brand-success/5 px-3 py-2 text-sm">
            <span className="font-medium">
              {tutor.label}
              {tutor.document ? ` · CC ${tutor.document}` : ""}
            </span>
            <button type="button" className="text-xs text-brand-dark hover:underline" onClick={() => setTutorId("")}>
              Cambiar
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <SearchPicker
              items={tutors.map((t) => ({ id: t.id, label: t.label }))}
              onPick={(i) => setTutorId(i.id)}
              placeholder="Busca al tutor (opcional)"
            />
            <div className="grid gap-3 sm:grid-cols-3">
              <TextField label="O escribe el nombre del cliente" value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="sm:col-span-1" />
              <TextField label="Tipo de documento" placeholder="CC, NIT..." value={docType} onChange={(e) => setDocType(e.target.value)} />
              <TextField label="Número de documento" value={docNumber} onChange={(e) => setDocNumber(e.target.value)} />
            </div>
          </div>
        )}
      </section>

      <section className="rounded-[var(--radius-brand-md)] border border-brand-border bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-base font-semibold text-brand-ink">Productos y servicios</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-60 flex-1">
            <SearchPicker
              items={products.map((p) => ({
                id: p.id,
                label: p.name,
                hint: p.is_service ? "Servicio" : `Hay ${formatQty(p.stock)} ${p.unit}`,
              }))}
              onPick={(i) => addProduct(i.id)}
              placeholder="Busca un producto o servicio"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setLines((ls) => [...ls, { key: nextKey.current++, productId: null, description: "", quantity: "1", unitPrice: "0", discount: "0", taxRate: 0 }])
            }
          >
            <Plus /> Línea libre
          </Button>
        </div>

        {lines.length === 0 ? (
          <p className="mt-4 text-sm text-brand-muted">Agrega lo que vas a cobrar.</p>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            {lines.map((l) => {
              const p = l.productId ? byId.get(l.productId) : null;
              const c = computeLine({ quantity: num(l.quantity), unitPrice: num(l.unitPrice), discount: num(l.discount), taxRate: l.taxRate });
              const short = p && !p.is_service && num(l.quantity) > p.stock;
              return (
                <div key={l.key} className="grid gap-3 rounded-[var(--radius-brand-sm)] border border-brand-border p-3 sm:grid-cols-12">
                  {p ? (
                    <p className="text-sm font-medium sm:col-span-12">{p.name}</p>
                  ) : (
                    <TextField className="sm:col-span-12" label="Descripción" value={l.description} onChange={(e) => updateLine(l.key, { description: e.target.value })} required />
                  )}
                  <TextField className="sm:col-span-3" label="Cantidad" inputMode="decimal" value={l.quantity} onChange={(e) => updateLine(l.key, { quantity: e.target.value })} />
                  <TextField className="sm:col-span-3" label="Precio unitario" inputMode="decimal" value={l.unitPrice} onChange={(e) => updateLine(l.key, { unitPrice: e.target.value })} />
                  <TextField className="sm:col-span-3" label="Descuento" inputMode="decimal" value={l.discount} onChange={(e) => updateLine(l.key, { discount: e.target.value })} />
                  <div className="flex flex-col justify-end sm:col-span-3">
                    <span className="text-xs text-brand-muted">Total de la línea</span>
                    <span className="text-base font-semibold">{formatMoney(c.gross, currency)}</span>
                    {l.taxRate > 0 && <span className="text-xs text-brand-muted">IVA {l.taxRate}%: {formatMoney(c.tax, currency)}</span>}
                  </div>
                  {short && <p className="text-xs text-brand-danger sm:col-span-12">Solo hay {formatQty(p!.stock)} {p!.unit} en inventario.</p>}
                  <div className="sm:col-span-12">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                      <Trash2 /> Quitar
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-[var(--radius-brand-md)] border border-brand-border bg-white p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-brand-ink">Pago</h2>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={totals.gross <= 0}
              onClick={() => setPayments([{ key: nextKey.current++, method: "efectivo", amount: String(totals.gross), reference: "" }])}
            >
              Cobrar todo en efectivo
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setPayments((ps) => [...ps, { key: nextKey.current++, method: "efectivo", amount: "", reference: "" }])}>
              <Plus /> Agregar pago
            </Button>
          </div>
        </div>

        {payments.length === 0 ? (
          <p className="text-sm text-brand-muted">Sin pagos: toda la venta quedará por cobrar al cliente.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {payments.map((p) => (
              <div key={p.key} className="grid gap-3 sm:grid-cols-12">
                <SelectField className="sm:col-span-3" label="Medio" value={p.method} onChange={(e) => updatePay(p.key, { method: e.target.value })} options={[...PAYMENT_METHODS]} />
                <TextField className="sm:col-span-4" label="Valor" inputMode="decimal" value={p.amount} onChange={(e) => updatePay(p.key, { amount: e.target.value })} />
                <TextField className="sm:col-span-4" label="Referencia" value={p.reference} onChange={(e) => updatePay(p.key, { reference: e.target.value })} />
                <div className="flex items-end sm:col-span-1">
                  <Button type="button" variant="ghost" size="icon" aria-label="Quitar pago" onClick={() => setPayments((ps) => ps.filter((x) => x.key !== p.key))}>
                    <Trash2 />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {paid > 0 && !cashOpen && (
          <p role="alert" className="mt-3 rounded-[var(--radius-brand-sm)] bg-brand-warning/15 px-3 py-2 text-sm text-brand-ink">
            La caja está cerrada: para cobrar debes{" "}
            <Link href="/dashboard/caja" className="font-medium text-brand-dark underline">
              abrirla primero
            </Link>
            .
          </p>
        )}
        {paid > totals.gross && <p className="mt-3 text-sm text-brand-danger">Lo que cobras supera el total. Ajusta los pagos.</p>}
        {balance > 0 && lines.length > 0 && (
          <p className="mt-3 rounded-[var(--radius-brand-sm)] bg-brand-soft px-3 py-2 text-sm">
            Quedará un saldo de <strong>{formatMoney(balance, currency)}</strong> por cobrar
            {hasCustomer ? "." : ". Indica el cliente para poder dejar saldo pendiente."}
          </p>
        )}
        <div className="mt-4">
          <TextField label="Notas" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </section>

      {state?.error && (
        <p role="alert" className="rounded-[var(--radius-brand-sm)] bg-brand-danger/10 px-3 py-2 text-sm text-brand-danger">
          {state.error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-brand-md)] border border-brand-border bg-white px-5 py-4 shadow-sm">
        <div>
          <p className="text-lg font-semibold">Total: {formatMoney(totals.gross, currency)}</p>
          <p className="text-sm text-brand-muted">
            Pagado {formatMoney(paid, currency)} · Saldo {formatMoney(Math.max(balance, 0), currency)}
          </p>
        </div>
        <Button type="submit" size="lg" disabled={pending || lines.length === 0 || paid > totals.gross}>
          {pending && <Loader2 className="animate-spin" />} Registrar venta
        </Button>
      </div>
    </form>
  );
}
