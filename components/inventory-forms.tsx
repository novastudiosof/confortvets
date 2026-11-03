import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/ui/fields";
import { PRODUCT_CATEGORIES } from "@/lib/logic/inventory";

export interface ProductRow {
  id: string;
  name: string;
  sku: string | null;
  category: string;
  unit: string;
  description: string | null;
  is_service: boolean;
  track_lots: boolean;
  cost_avg: number;
  sale_price: number;
  tax_rate: number;
  min_stock: number;
  stock: number;
  is_active: boolean;
}

export interface LotRow {
  id: string;
  product_id: string;
  lot_code: string;
  expires_on: string | null;
  quantity: number;
}

/** Campos del producto (crear y editar). Al crear también pide costo y existencia inicial. */
export function ProductFields({ product, creating }: { product?: ProductRow; creating?: boolean }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Nombre" name="name" defaultValue={product?.name} required className="sm:col-span-2" />
        <SelectField
          label="Categoría"
          name="category"
          defaultValue={product?.category ?? "medicamento"}
          options={[...PRODUCT_CATEGORIES]}
          hint="«Servicio» no maneja existencias (consulta, baño, cirugía...)."
        />
        <TextField label="Código (opcional)" name="sku" defaultValue={product?.sku ?? ""} />
        <TextField label="Unidad" name="unit" defaultValue={product?.unit ?? "unidad"} hint="caja, frasco, tableta, ml, kg..." />
        <TextField
          label="Precio de venta (IVA incluido)"
          name="sale_price"
          inputMode="decimal"
          defaultValue={product ? String(product.sale_price) : ""}
        />
        <TextField label="IVA (%)" name="tax_rate" inputMode="decimal" defaultValue={product ? String(product.tax_rate) : "0"} hint="0 si no lleva IVA." />
        <TextField
          label="Existencia mínima"
          name="min_stock"
          inputMode="decimal"
          defaultValue={product ? String(product.min_stock) : "0"}
          hint="Avisa cuando queden estas unidades o menos."
        />
      </div>
      <TextAreaField label="Descripción" name="description" defaultValue={product?.description ?? ""} rows={2} />
      <div className="grid gap-2 sm:grid-cols-2">
        <CheckboxField label="Es un servicio (sin existencias)" name="is_service" defaultChecked={product?.is_service} />
        <CheckboxField
          label="Controlar lote y vencimiento"
          name="track_lots"
          defaultChecked={product?.track_lots}
          hint="Recomendado para medicamentos y vacunas. No se puede cambiar cuando ya tiene movimientos."
        />
      </div>
      {creating && (
        <fieldset className="grid gap-4 rounded-[var(--radius-brand-sm)] border border-brand-border p-4 sm:grid-cols-2">
          <legend className="px-1 text-sm font-semibold text-brand-ink">Existencia inicial (opcional)</legend>
          <TextField label="Costo unitario" name="cost" inputMode="decimal" />
          <TextField label="Cantidad que ya tienes" name="initial_stock" inputMode="decimal" />
          <TextField label="Lote (si controlas lotes)" name="initial_lot" />
          <TextField label="Vence (si controlas lotes)" name="initial_expiry" type="date" />
        </fieldset>
      )}
    </>
  );
}

/** Agregar existencias: lo que se escribe se SUMA a lo que ya hay. */
export function AddStockFields({ product }: { product: Pick<ProductRow, "name" | "unit" | "stock" | "track_lots" | "cost_avg"> }) {
  return (
    <>
      <p className="rounded-[var(--radius-brand-sm)] bg-brand-soft px-3 py-2 text-sm">
        Hay <strong>{Number(product.stock)}</strong> {product.unit}. Lo que agregues se suma a esa cantidad.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label={`Cantidad a agregar (${product.unit})`} name="quantity" inputMode="decimal" required />
        <TextField
          label="Costo unitario"
          name="unit_cost"
          inputMode="decimal"
          defaultValue={product.cost_avg ? String(product.cost_avg) : ""}
          hint="Con esto se recalcula el costo promedio."
        />
        {product.track_lots && (
          <>
            <TextField label="Lote" name="lot_code" required hint="Si el lote ya existe, se suma a ese lote." />
            <TextField label="Vence" name="expires_on" type="date" />
          </>
        )}
      </div>
      <TextField label="Nota (opcional)" name="reason" placeholder="Ej.: pedido del proveedor" />
    </>
  );
}

/** Ajuste o merma, siempre con motivo. */
export function AdjustFields({ product, lots }: { product: Pick<ProductRow, "unit" | "stock" | "track_lots">; lots: LotRow[] }) {
  return (
    <>
      <p className="rounded-[var(--radius-brand-sm)] bg-brand-soft px-3 py-2 text-sm">
        Hay <strong>{Number(product.stock)}</strong> {product.unit}. El ajuste queda registrado en el historial.
      </p>
      <SelectField
        label="Tipo"
        name="type"
        required
        options={[
          { value: "merma", label: "Merma (se dañó, se perdió o se venció): resta" },
          { value: "ajuste_menos", label: "Ajuste por conteo: resta" },
          { value: "ajuste_mas", label: "Ajuste por conteo: suma" },
        ]}
      />
      {product.track_lots && (
        <SelectField
          label="Lote"
          name="lot_id"
          required
          placeholder="Elegir el lote"
          options={lots.map((l) => ({ value: l.id, label: `${l.lot_code}${l.expires_on ? ` · vence ${l.expires_on}` : ""} · ${Number(l.quantity)}` }))}
        />
      )}
      <TextField label={`Cantidad (${product.unit})`} name="quantity" inputMode="decimal" required />
      <TextField label="Motivo" name="reason" required placeholder="Ej.: frasco roto" />
    </>
  );
}
