"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";

import { SearchPicker } from "@/components/search-picker";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/fields";
import { formatQty } from "@/lib/logic/inventory";

export interface UsableProduct {
  id: string;
  name: string;
  unit: string;
  stock: number;
}

interface Row {
  productId: string;
  quantity: string;
}

/** Campos del diálogo «Descontar del inventario» de una consulta. */
export function UseInventoryFields({ products, suggested }: { products: UsableProduct[]; suggested: string[] }) {
  const byId = React.useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const [rows, setRows] = React.useState<Row[]>(() => suggested.filter((id) => byId.has(id)).map((id) => ({ productId: id, quantity: "1" })));

  const payload = JSON.stringify({
    items: rows.map((r) => ({ product_id: r.productId, quantity: Number(r.quantity.replace(",", ".")) || 0 })),
  });

  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name="payload" value={payload} />
      {suggested.length > 0 && <p className="text-sm text-brand-muted">Se sugieren los productos que coinciden con la fórmula. Ajusta las cantidades.</p>}
      <SearchPicker
        items={products.map((p) => ({ id: p.id, label: p.name, hint: `Hay ${formatQty(p.stock)} ${p.unit}` }))}
        onPick={(i) => setRows((r) => (r.some((x) => x.productId === i.id) ? r : [...r, { productId: i.id, quantity: "1" }]))}
        placeholder="Busca un producto para agregarlo"
      />
      {rows.map((r) => {
        const p = byId.get(r.productId)!;
        return (
          <div key={r.productId} className="grid grid-cols-[1fr_8rem_auto] items-end gap-2">
            <p className="text-sm font-medium">{p.name}</p>
            <TextField
              label={`Cantidad (${p.unit})`}
              inputMode="decimal"
              value={r.quantity}
              onChange={(e) => setRows((x) => x.map((y) => (y.productId === r.productId ? { ...y, quantity: e.target.value } : y)))}
            />
            <Button type="button" variant="ghost" size="icon" aria-label="Quitar" onClick={() => setRows((x) => x.filter((y) => y.productId !== r.productId))}>
              <Trash2 />
            </Button>
          </div>
        );
      })}
    </div>
  );
}
