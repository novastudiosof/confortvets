import Link from "next/link";
import { Minus, Package, Plus, ShoppingCart } from "lucide-react";

import { ActionForm } from "@/components/action-form";
import { DialogForm } from "@/components/dialog-form";
import { AddStockFields, AdjustFields, ProductFields, type LotRow, type ProductRow } from "@/components/inventory-forms";
import { PAGE_SIZE, Pagination, pageFrom } from "@/components/pagination";
import { SearchForm } from "@/components/search-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckboxField, TextAreaField, TextField } from "@/components/ui/fields";
import { DataTable, EmptyState, PageHeader, Section, Stat, tdClass, thClass } from "@/components/ui/misc";
import { addStock, adjustStock, saveInventorySettings, saveProduct, saveSupplier, voidPurchase } from "@/lib/actions/inventory";
import { can, requireAccess } from "@/lib/auth";
import { formatDate } from "@/lib/logic/dates";
import { PRODUCT_CATEGORIES, expiryState, formatMoney, formatQty, inventoryValue, stockState } from "@/lib/logic/inventory";
import { rowsById, safeSearch } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Inventario" };

const TABS = [
  { key: "productos", label: "Productos" },
  { key: "compras", label: "Compras" },
  { key: "proveedores", label: "Proveedores" },
  { key: "ajustes", label: "Ajustes" },
] as const;

interface SearchParams {
  tab?: string;
  q?: string;
  page?: string;
  filtro?: string;
}

export default async function InventoryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireAccess("inventory.read");
  const sp = await searchParams;
  const canManage = can(ctx, "inventory.manage") && !ctx.readOnly;
  const tabs = TABS.filter((t) => t.key !== "ajustes" || can(ctx, "inventory.manage"));
  const tab = tabs.some((t) => t.key === sp.tab) ? (sp.tab as (typeof TABS)[number]["key"]) : "productos";

  return (
    <>
      <PageHeader
        title="Inventario"
        description="Productos, existencias, lotes y compras. Lo que agregues se suma a lo que ya hay."
        actions={
          <>
            {can(ctx, "inventory.write") && !ctx.readOnly && (
              <Button asChild variant="outline">
                <Link href="/dashboard/inventario/compras/nueva">
                  <ShoppingCart /> Registrar compra
                </Link>
              </Button>
            )}
            {canManage && (
              <DialogForm
                trigger={
                  <>
                    <Plus /> Nuevo producto
                  </>
                }
                title="Nuevo producto"
                action={saveProduct.bind(null, null)}
                submitLabel="Crear producto"
                wide
              >
                <ProductFields creating />
              </DialogForm>
            )}
          </>
        }
      />

      <nav className="mb-6 flex flex-wrap gap-1 border-b border-brand-border" aria-label="Secciones del inventario">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/dashboard/inventario?tab=${t.key}`}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              tab === t.key ? "border-brand text-brand-dark" : "border-transparent text-brand-muted hover:text-brand-ink"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "productos" && <ProductsTab ctx={ctx} sp={sp} />}
      {tab === "compras" && <PurchasesTab ctx={ctx} canManage={canManage} />}
      {tab === "proveedores" && <SuppliersTab canWrite={can(ctx, "inventory.write") && !ctx.readOnly} />}
      {tab === "ajustes" && <SettingsTab canManage={canManage} />}
    </>
  );
}

type Ctx = Awaited<ReturnType<typeof requireAccess>>;

async function ProductsTab({ ctx, sp }: { ctx: Ctx; sp: SearchParams }) {
  const supabase = await createClient();
  const q = safeSearch(sp.q);
  const filtro = ["bajo", "vencer", "inactivos"].includes(sp.filtro ?? "") ? sp.filtro! : "todos";
  const page = pageFrom(sp.page);
  const canWrite = can(ctx, "inventory.write") && !ctx.readOnly;

  const [{ data: productRows }, { data: settingsRow }] = await Promise.all([
    supabase.from("products").select("*").order("name").limit(3000),
    supabase.from("inventory_settings").select("expiry_alert_days").maybeSingle(),
  ]);
  const alertDays = Number(settingsRow?.expiry_alert_days ?? 60);
  const all = (productRows ?? []).map((p) => ({
    ...p,
    stock: Number(p.stock),
    cost_avg: Number(p.cost_avg),
    sale_price: Number(p.sale_price),
    tax_rate: Number(p.tax_rate),
    min_stock: Number(p.min_stock),
  })) as ProductRow[];

  // Lotes con existencias (para vencimientos y para ajustar por lote)
  const { data: lotRows } = await supabase
    .from("stock_lots")
    .select("id, product_id, lot_code, expires_on, quantity")
    .gt("quantity", 0)
    .order("expires_on", { ascending: true, nullsFirst: false })
    .limit(5000);
  const lots = (lotRows ?? []).map((l) => ({ ...l, quantity: Number(l.quantity) })) as LotRow[];
  const lotsByProduct = new Map<string, LotRow[]>();
  for (const l of lots) lotsByProduct.set(l.product_id, [...(lotsByProduct.get(l.product_id) ?? []), l]);
  const expiring = new Set(
    lots.filter((l) => ["vencido", "por_vencer"].includes(expiryState(l.expires_on, ctx.today, alertDays))).map((l) => l.product_id)
  );

  const active = all.filter((p) => p.is_active);
  const lowCount = active.filter((p) => stockState(p.stock, p.min_stock, p.is_service) !== "ok").length;
  const value = inventoryValue(active.filter((p) => !p.is_service));

  let list = all;
  if (filtro === "inactivos") list = all.filter((p) => !p.is_active);
  else list = active;
  if (filtro === "bajo") list = list.filter((p) => stockState(p.stock, p.min_stock, p.is_service) !== "ok");
  if (filtro === "vencer") list = list.filter((p) => expiring.has(p.id));
  if (q) {
    const needle = q.toLowerCase();
    list = list.filter((p) => p.name.toLowerCase().includes(needle) || (p.sku ?? "").toLowerCase().includes(needle));
  }
  const total = list.length;
  const rows = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const filters = [
    { key: "todos", label: "Activos" },
    { key: "bajo", label: `Stock bajo (${lowCount})` },
    { key: "vencer", label: `Por vencer (${expiring.size})` },
    { key: "inactivos", label: "Inactivos" },
  ];

  return (
    <>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Productos activos" value={active.length} />
        <Stat label="Stock bajo o agotado" value={lowCount} />
        <Stat label="Lotes por vencer o vencidos" value={expiring.size} hint={`Aviso: ${alertDays} días antes`} />
        <Stat label="Valor del inventario" value={formatMoney(value, ctx.settings.currency)} hint="A costo promedio" />
      </div>

      <div className="mb-3 flex flex-wrap gap-2 text-sm">
        {filters.map((f) => (
          <Link
            key={f.key}
            href={`/dashboard/inventario?tab=productos&filtro=${f.key}`}
            className={`rounded-full px-3 py-1 ${filtro === f.key ? "bg-brand text-brand-on" : "border border-brand-border text-brand-ink hover:bg-black/5"}`}
          >
            {f.label}
          </Link>
        ))}
      </div>
      <SearchForm defaultValue={q} placeholder="Buscar por nombre o código" hidden={{ tab: "productos", filtro }} />

      {rows.length === 0 ? (
        <EmptyState>
          <Package className="mx-auto mb-2 h-5 w-5" />
          {all.length === 0 ? "Todavía no hay productos. Crea el primero con «Nuevo producto»." : "No hay productos con ese filtro."}
        </EmptyState>
      ) : (
        <DataTable>
          <thead>
            <tr>
              <th className={thClass}>Producto</th>
              <th className={thClass}>Existencia</th>
              <th className={thClass}>Costo prom.</th>
              <th className={thClass}>Precio</th>
              <th className={thClass} />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const st = stockState(p.stock, p.min_stock, p.is_service);
              const cat = PRODUCT_CATEGORIES.find((c) => c.value === p.category)?.label ?? p.category;
              return (
                <tr key={p.id} className="hover:bg-black/[0.02]">
                  <td className={tdClass}>
                    <Link href={`/dashboard/inventario/${p.id}`} className="font-medium text-brand-dark hover:underline">
                      {p.name}
                    </Link>
                    <p className="text-xs text-brand-muted">
                      {cat}
                      {p.sku ? ` · ${p.sku}` : ""}
                      {p.track_lots ? " · lotes" : ""}
                    </p>
                  </td>
                  <td className={tdClass}>
                    {p.is_service ? (
                      <span className="text-brand-muted">Servicio</span>
                    ) : (
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        {formatQty(p.stock)} {p.unit}
                        {st === "agotado" && <Badge variant="danger">Agotado</Badge>}
                        {st === "bajo" && <Badge variant="warning">Bajo</Badge>}
                        {expiring.has(p.id) && <Badge variant="danger">Vence pronto</Badge>}
                      </span>
                    )}
                  </td>
                  <td className={tdClass}>{p.is_service ? "—" : formatMoney(p.cost_avg, ctx.settings.currency)}</td>
                  <td className={tdClass}>{formatMoney(p.sale_price, ctx.settings.currency)}</td>
                  <td className={`${tdClass} text-right`}>
                    {!p.is_service && p.is_active && (
                      <span className="inline-flex flex-wrap justify-end gap-1.5">
                        {canWrite && (
                          <DialogForm
                            trigger={
                              <>
                                <Plus /> Agregar
                              </>
                            }
                            triggerVariant="outline"
                            triggerSize="sm"
                            title={`Agregar existencias · ${p.name}`}
                            action={addStock.bind(null, p.id)}
                            submitLabel="Agregar"
                          >
                            <AddStockFields product={p} />
                          </DialogForm>
                        )}
                        {canWrite && (
                          <DialogForm
                            trigger={
                              <>
                                <Minus /> Ajustar
                              </>
                            }
                            triggerVariant="ghost"
                            triggerSize="sm"
                            title={`Ajustar existencias · ${p.name}`}
                            action={adjustStock.bind(null, p.id)}
                            submitLabel="Registrar ajuste"
                          >
                            <AdjustFields product={p} lots={lotsByProduct.get(p.id) ?? []} />
                          </DialogForm>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      )}
      <Pagination basePath="/dashboard/inventario" page={page} total={total} params={{ tab: "productos", filtro, q: q || undefined }} />
    </>
  );
}

async function PurchasesTab({ ctx, canManage }: { ctx: Ctx; canManage: boolean }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("purchases")
    .select("id, supplier_id, invoice_number, purchased_on, total, status, void_reason")
    .order("purchased_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(60);
  const purchases = data ?? [];
  const [suppliers, items] = await Promise.all([
    rowsById<{ id: string; name: string }>("suppliers", purchases.map((p) => (p.supplier_id as string) ?? ""), "id, name"),
    purchases.length
      ? supabase
          .from("purchase_items")
          .select("purchase_id, product_id, quantity, unit_cost, lot_code")
          .in("purchase_id", purchases.map((p) => p.id as string))
          .then((r) => r.data ?? [])
      : Promise.resolve([]),
  ]);
  const products = await rowsById<{ id: string; name: string; unit: string }>("products", items.map((i) => i.product_id as string), "id, name, unit");

  if (purchases.length === 0) return <EmptyState>Todavía no hay compras registradas.</EmptyState>;

  return (
    <div className="flex flex-col gap-3">
      {purchases.map((p) => {
        const lines = items.filter((i) => i.purchase_id === p.id);
        return (
          <details key={p.id as string} className="rounded-[var(--radius-brand-md)] border border-brand-border bg-white shadow-sm">
            <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <span>
                <strong>{formatDate(p.purchased_on as string)}</strong>
                <span className="text-brand-muted">
                  {" "}
                  · {(p.supplier_id && suppliers.get(p.supplier_id as string)?.name) || "Sin proveedor"}
                  {p.invoice_number ? ` · Fact. ${p.invoice_number}` : ""}
                </span>
              </span>
              <span className="flex items-center gap-2">
                {p.status === "anulada" && <Badge variant="danger">Anulada</Badge>}
                <strong>{formatMoney(p.total as number, ctx.settings.currency)}</strong>
              </span>
            </summary>
            <div className="border-t border-brand-border px-4 py-3 text-sm">
              <ul className="mb-3 space-y-1">
                {lines.map((l, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span>
                      {products.get(l.product_id as string)?.name ?? "Producto"}
                      {l.lot_code ? ` · lote ${l.lot_code}` : ""}
                    </span>
                    <span className="text-brand-muted">
                      {formatQty(l.quantity as number)} × {formatMoney(l.unit_cost as number, ctx.settings.currency)}
                    </span>
                  </li>
                ))}
              </ul>
              {p.status === "anulada" && <p className="text-brand-muted">Motivo de la anulación: {p.void_reason as string}</p>}
              {p.status === "registrada" && canManage && (
                <DialogForm
                  trigger="Anular compra"
                  triggerVariant="ghost"
                  triggerSize="sm"
                  title="Anular compra"
                  description="Se devuelven las existencias. Si ya vendiste parte de lo comprado, no se podrá anular."
                  action={voidPurchase.bind(null, p.id as string)}
                  submitLabel="Anular"
                  submitVariant="destructive"
                >
                  <TextAreaField label="Motivo" name="reason" required rows={2} />
                </DialogForm>
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}

async function SuppliersTab({ canWrite }: { canWrite: boolean }) {
  const supabase = await createClient();
  const { data } = await supabase.from("suppliers").select("id, name, tax_id, phone, email, notes, is_active").order("name");
  const suppliers = data ?? [];

  const fields = (s?: (typeof suppliers)[number]) => (
    <>
      <TextField label="Nombre" name="name" defaultValue={s?.name as string | undefined} required />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="NIT o cédula" name="tax_id" defaultValue={(s?.tax_id as string | null) ?? ""} />
        <TextField label="Teléfono" name="phone" type="tel" defaultValue={(s?.phone as string | null) ?? ""} />
      </div>
      <TextField label="Correo" name="email" type="email" defaultValue={(s?.email as string | null) ?? ""} />
      <TextAreaField label="Notas" name="notes" defaultValue={(s?.notes as string | null) ?? ""} rows={2} />
    </>
  );

  return (
    <Section
      title="Proveedores"
      actions={
        canWrite && (
          <DialogForm
            trigger={
              <>
                <Plus /> Nuevo proveedor
              </>
            }
            triggerVariant="outline"
            triggerSize="sm"
            title="Nuevo proveedor"
            action={saveSupplier.bind(null, null)}
          >
            {fields()}
          </DialogForm>
        )
      }
    >
      {suppliers.length === 0 ? (
        <EmptyState>Todavía no hay proveedores.</EmptyState>
      ) : (
        <ul className="divide-y divide-brand-border">
          {suppliers.map((s) => (
            <li key={s.id as string} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
              <span>
                <strong>{s.name as string}</strong>
                <span className="text-brand-muted">
                  {s.tax_id ? ` · ${s.tax_id}` : ""}
                  {s.phone ? ` · ${s.phone}` : ""}
                </span>
              </span>
              {canWrite && (
                <DialogForm
                  trigger="Editar"
                  triggerVariant="ghost"
                  triggerSize="sm"
                  title="Editar proveedor"
                  action={saveSupplier.bind(null, s.id as string)}
                >
                  {fields(s)}
                </DialogForm>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

async function SettingsTab({ canManage }: { canManage: boolean }) {
  const supabase = await createClient();
  const { data } = await supabase.from("inventory_settings").select("expiry_alert_days, allow_negative_stock").maybeSingle();
  return (
    <Section title="Ajustes del inventario">
      <ActionForm action={saveInventorySettings} submitLabel="Guardar ajustes">
        <fieldset disabled={!canManage} className="flex flex-col gap-4">
          <TextField
            label="Avisar de vencimientos con (días)"
            name="expiry_alert_days"
            type="number"
            min={1}
            max={365}
            defaultValue={String(data?.expiry_alert_days ?? 60)}
            className="max-w-xs"
            hint="Un lote aparece como «por vencer» cuando le quedan estos días o menos."
          />
          <CheckboxField
            label="Permitir vender sin existencias (queda en negativo)"
            name="allow_negative_stock"
            defaultChecked={Boolean(data?.allow_negative_stock)}
            hint="Solo para productos sin lotes. No se recomienda: el inventario deja de ser confiable."
          />
        </fieldset>
      </ActionForm>
    </Section>
  );
}
