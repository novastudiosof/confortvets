import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Minus, Pencil, Plus } from "lucide-react";

import { DialogForm } from "@/components/dialog-form";
import { AddStockFields, AdjustFields, ProductFields, type LotRow, type ProductRow } from "@/components/inventory-forms";
import { Badge } from "@/components/ui/badge";
import { DataTable, DefinitionList, EmptyState, PageHeader, Section, tdClass, thClass } from "@/components/ui/misc";
import { addStock, adjustStock, saveProduct } from "@/lib/actions/inventory";
import { can, requireAccess } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/logic/dates";
import { MOVEMENT_LABEL, PRODUCT_CATEGORIES, expiryState, formatMoney, formatQty, stockState } from "@/lib/logic/inventory";
import { createClient } from "@/lib/supabase/server";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAccess("inventory.read");
  const { id } = await params;
  const supabase = await createClient();

  const { data } = await supabase.from("products").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const product = {
    ...data,
    stock: Number(data.stock),
    cost_avg: Number(data.cost_avg),
    sale_price: Number(data.sale_price),
    tax_rate: Number(data.tax_rate),
    min_stock: Number(data.min_stock),
  } as ProductRow;

  const [{ data: lotRows }, { data: movements }, { data: settings }] = await Promise.all([
    supabase.from("stock_lots").select("id, product_id, lot_code, expires_on, quantity").eq("product_id", id).order("expires_on", { ascending: true, nullsFirst: false }),
    supabase
      .from("stock_movements")
      .select("id, kind, quantity, unit_cost, balance_after, reason, created_at, lot_id")
      .eq("product_id", id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(100),
    supabase.from("inventory_settings").select("expiry_alert_days").maybeSingle(),
  ]);
  const lots = (lotRows ?? []).map((l) => ({ ...l, quantity: Number(l.quantity) })) as LotRow[];
  const lotCode = new Map(lots.map((l) => [l.id, l.lot_code]));
  const alertDays = Number(settings?.expiry_alert_days ?? 60);
  const writable = !ctx.readOnly;
  const canWrite = can(ctx, "inventory.write") && writable;
  const canManage = can(ctx, "inventory.manage") && writable;
  const st = stockState(product.stock, product.min_stock, product.is_service);
  const cat = PRODUCT_CATEGORIES.find((c) => c.value === product.category)?.label ?? product.category;

  return (
    <>
      <PageHeader
        back={
          <Link href="/dashboard/inventario" className="mb-2 inline-flex items-center gap-1 text-sm text-brand-muted hover:text-brand-ink">
            <ArrowLeft className="h-4 w-4" /> Inventario
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            {product.name}
            {!product.is_active && <Badge variant="muted">Inactivo</Badge>}
            {st === "agotado" && <Badge variant="danger">Agotado</Badge>}
            {st === "bajo" && <Badge variant="warning">Stock bajo</Badge>}
          </span>
        }
        description={`${cat}${product.sku ? ` · ${product.sku}` : ""}`}
        actions={
          <>
            {canWrite && !product.is_service && product.is_active && (
              <>
                <DialogForm
                  trigger={
                    <>
                      <Plus /> Agregar existencias
                    </>
                  }
                  title={`Agregar existencias · ${product.name}`}
                  action={addStock.bind(null, id)}
                  submitLabel="Agregar"
                >
                  <AddStockFields product={product} />
                </DialogForm>
                <DialogForm
                  trigger={
                    <>
                      <Minus /> Ajustar
                    </>
                  }
                  triggerVariant="outline"
                  title={`Ajustar existencias · ${product.name}`}
                  action={adjustStock.bind(null, id)}
                  submitLabel="Registrar ajuste"
                >
                  <AdjustFields product={product} lots={lots.filter((l) => l.quantity > 0)} />
                </DialogForm>
              </>
            )}
            {canManage && (
              <DialogForm
                trigger={
                  <>
                    <Pencil /> Editar
                  </>
                }
                triggerVariant="outline"
                title="Editar producto"
                action={saveProduct.bind(null, id)}
                wide
              >
                <ProductFields product={product} />
              </DialogForm>
            )}
          </>
        }
      />

      <div className="flex flex-col gap-6">
        <Section title="Datos">
          <DefinitionList
            items={[
              { label: "Existencia", value: product.is_service ? "Servicio (sin existencias)" : `${formatQty(product.stock)} ${product.unit}` },
              { label: "Existencia mínima", value: product.is_service ? "—" : formatQty(product.min_stock) },
              { label: "Costo promedio", value: product.is_service ? "—" : formatMoney(product.cost_avg, ctx.settings.currency) },
              { label: "Precio de venta (IVA incl.)", value: formatMoney(product.sale_price, ctx.settings.currency) },
              { label: "IVA", value: `${product.tax_rate}%` },
              { label: "Lotes y vencimiento", value: product.track_lots ? "Sí" : "No" },
              { label: "Descripción", value: product.description },
            ]}
          />
        </Section>

        {product.track_lots && (
          <Section title="Lotes">
            {lots.length === 0 ? (
              <EmptyState>No hay lotes registrados.</EmptyState>
            ) : (
              <DataTable>
                <thead>
                  <tr>
                    <th className={thClass}>Lote</th>
                    <th className={thClass}>Vence</th>
                    <th className={thClass}>Cantidad</th>
                  </tr>
                </thead>
                <tbody>
                  {lots.map((l) => {
                    const ex = expiryState(l.expires_on, ctx.today, alertDays);
                    return (
                      <tr key={l.id}>
                        <td className={tdClass}>{l.lot_code}</td>
                        <td className={tdClass}>
                          {l.expires_on ? formatDate(l.expires_on) : "—"}{" "}
                          {l.quantity > 0 && ex === "vencido" && <Badge variant="danger">Vencido</Badge>}
                          {l.quantity > 0 && ex === "por_vencer" && <Badge variant="warning">Por vencer</Badge>}
                        </td>
                        <td className={tdClass}>{formatQty(l.quantity)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </DataTable>
            )}
          </Section>
        )}

        <Section title="Historial de movimientos">
          {(movements ?? []).length === 0 ? (
            <EmptyState>Todavía no hay movimientos.</EmptyState>
          ) : (
            <DataTable>
              <thead>
                <tr>
                  <th className={thClass}>Fecha</th>
                  <th className={thClass}>Movimiento</th>
                  <th className={thClass}>Cantidad</th>
                  <th className={thClass}>Saldo</th>
                  <th className={thClass}>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {(movements ?? []).map((m) => {
                  const qty = Number(m.quantity);
                  return (
                    <tr key={m.id as string}>
                      <td className={tdClass}>{formatDateTime(m.created_at as string, ctx.tz)}</td>
                      <td className={tdClass}>{MOVEMENT_LABEL[m.kind as string] ?? (m.kind as string)}</td>
                      <td className={`${tdClass} font-medium ${qty > 0 ? "text-brand-success" : "text-brand-danger"}`}>
                        {qty > 0 ? "+" : ""}
                        {formatQty(qty)}
                      </td>
                      <td className={tdClass}>{m.balance_after != null ? formatQty(m.balance_after as number) : "—"}</td>
                      <td className={tdClass}>
                        {m.lot_id ? `Lote ${lotCode.get(m.lot_id as string) ?? ""} ` : ""}
                        {m.unit_cost != null ? `· costo ${formatMoney(m.unit_cost as number, ctx.settings.currency)} ` : ""}
                        {m.reason ? `· ${m.reason}` : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
          )}
        </Section>
      </div>
    </>
  );
}
