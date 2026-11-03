"use client";

import * as React from "react";
import { useActionState } from "react";
import { Loader2, Trash2 } from "lucide-react";

import { SearchPicker } from "@/components/search-picker";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/fields";
import type { ActionResult } from "@/lib/action-result";
import { formatMoney, round2 } from "@/lib/logic/inventory";

export interface PurchaseProduct {
  id: string;
  name: string;
  unit: string;
  track_lots: boolean;
  cost_avg: number;
}

interface Row {
  key: number;
  productId: string;
  quantity: string;
  unitCost: string;
  lotCode: string;
  expiresOn: string;
}

const num = (v: string): number => {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

/** Registro de una compra: las cantidades se SUMAN a las existencias. */
export function PurchaseEditor({
  action,
  products,
  suppliers,
  today,
  currency,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  products: PurchaseProduct[];
  suppliers: { id: string; name: string }[];
  today: string;
  currency: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [supplierId, setSupplierId] = React.useState("");
  const [invoice, setInvoice] = React.useState("");
  const [date, setDate] = React.useState(today);
  const [notes, setNotes] = React.useState("");
  const nextKey = React.useRef(1);
  const byId = React.useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  function addProduct(id: string) {
    const p = byId.get(id);
    if (!p) return;
    setRows((r) => [
      ...r,
      { key: nextKey.current++, productId: id, quantity: "1", unitCost: p.cost_avg ? String(p.cost_avg) : "", lotCode: "", expiresOn: "" },
    ]);
  }
  const update = (key: number, patch: Partial<Row>) => setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const total = round2(rows.reduce((s, r) => s + num(r.quantity) * num(r.unitCost), 0));
  const payload = JSON.stringify({
    supplier_id: supplierId || null,
    invoice_number: invoice,
    purchased_on: date,
    notes,
    items: rows.map((r) => ({
      product_id: r.productId,
      quantity: num(r.quantity),
      unit_cost: num(r.unitCost),
      lot_code: r.lotCode || null,
      expires_on: r.expiresOn || null,
    })),
  });

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="payload" value={payload} />
      <div className="grid gap-4 rounded-[var(--radius-brand-md)] border border-brand-border bg-white p-5 shadow-sm sm:grid-cols-2">
        <SelectField
          label="Proveedor"
          placeholder="Sin proveedor"
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
          options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
        />
        <TextField label="N.° de factura del proveedor" value={invoice} onChange={(e) => setInvoice(e.target.value)} />
        <TextField label="Fecha de la compra" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        <TextField label="Notas" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div className="rounded-[var(--radius-brand-md)] border border-brand-border bg-white p-5 shadow-sm">
        <h2 className="mb-1 text-base font-semibold text-brand-ink">Productos comprados</h2>
        <p className="mb-3 text-sm text-brand-muted">Cada cantidad se suma a lo que ya hay en inventario.</p>
        <SearchPicker
          items={products.map((p) => ({ id: p.id, label: p.name, hint: p.unit }))}
          onPick={(i) => addProduct(i.id)}
          placeholder="Busca el producto para agregarlo"
        />

        {rows.length > 0 && (
          <div className="mt-4 flex flex-col gap-3">
            {rows.map((r) => {
              const p = byId.get(r.productId)!;
              return (
                <div key={r.key} className="grid gap-3 rounded-[var(--radius-brand-sm)] border border-brand-border p-3 sm:grid-cols-12">
                  <p className="text-sm font-medium sm:col-span-12">{p.name}</p>
                  <TextField
                    className="sm:col-span-3"
                    label={`Cantidad (${p.unit})`}
                    inputMode="decimal"
                    value={r.quantity}
                    onChange={(e) => update(r.key, { quantity: e.target.value })}
                    required
                  />
                  <TextField
                    className="sm:col-span-3"
                    label="Costo unitario"
                    inputMode="decimal"
                    value={r.unitCost}
                    onChange={(e) => update(r.key, { unitCost: e.target.value })}
                    required
                  />
                  {p.track_lots && (
                    <>
                      <TextField className="sm:col-span-3" label="Lote" value={r.lotCode} onChange={(e) => update(r.key, { lotCode: e.target.value })} required />
                      <TextField className="sm:col-span-3" label="Vence" type="date" value={r.expiresOn} onChange={(e) => update(r.key, { expiresOn: e.target.value })} />
                    </>
                  )}
                  <div className="flex items-end justify-between gap-2 sm:col-span-12">
                    <span className="text-sm text-brand-muted">Subtotal: {formatMoney(num(r.quantity) * num(r.unitCost), currency)}</span>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setRows((x) => x.filter((y) => y.key !== r.key))}>
                      <Trash2 /> Quitar
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {state?.error && (
        <p role="alert" className="rounded-[var(--radius-brand-sm)] bg-brand-danger/10 px-3 py-2 text-sm text-brand-danger">
          {state.error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-brand-md)] border border-brand-border bg-white px-5 py-4 shadow-sm">
        <p className="text-lg font-semibold">Total: {formatMoney(total, currency)}</p>
        <Button type="submit" disabled={pending || rows.length === 0}>
          {pending && <Loader2 className="animate-spin" />} Registrar compra
        </Button>
      </div>
    </form>
  );
}
