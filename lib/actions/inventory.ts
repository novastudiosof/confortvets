"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { checked, dbError, fail, ok, optNum, optStr, str, type ActionResult } from "@/lib/action-result";
import { logActivity } from "@/lib/activity";
import { can, guard } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

function refresh(): void {
  revalidatePath("/dashboard/inventario");
  revalidatePath("/dashboard/ventas");
  revalidatePath("/dashboard/caja");
}

/** Lee el campo `payload` (JSON) que envían los editores de compras y ventas. */
function readPayload(formData: FormData): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(str(formData, "payload"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Productos
// ---------------------------------------------------------------------------
const CATEGORIES = ["medicamento", "insumo", "alimento", "accesorio", "servicio", "otro"];

export async function saveProduct(productId: string | null, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("inventory.manage");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const name = str(formData, "name");
  if (name.length < 2) return fail("Escribe el nombre del producto");
  const category = str(formData, "category") || "otro";
  if (!CATEGORIES.includes(category)) return fail("La categoría no es válida");

  const price = optNum(formData, "sale_price");
  const tax = optNum(formData, "tax_rate");
  const minStock = optNum(formData, "min_stock");
  if (price === undefined || (price ?? 0) < 0) return fail("El precio no es válido");
  if (tax === undefined || (tax ?? 0) < 0 || (tax ?? 0) > 100) return fail("El IVA debe estar entre 0 y 100");
  if (minStock === undefined || (minStock ?? 0) < 0) return fail("La existencia mínima no es válida");

  const isService = category === "servicio" || checked(formData, "is_service");
  const row: Record<string, unknown> = {
    name,
    sku: optStr(formData, "sku"),
    category,
    unit: optStr(formData, "unit") ?? "unidad",
    description: optStr(formData, "description"),
    is_service: isService,
    track_lots: !isService && checked(formData, "track_lots"),
    sale_price: price ?? 0,
    tax_rate: tax ?? 0,
    min_stock: isService ? 0 : (minStock ?? 0),
  };

  const supabase = await createClient();
  if (productId) {
    const { error } = await supabase.from("products").update(row).eq("id", productId).eq("organization_id", ctx.org.id);
    if (error) {
      if (error.code === "23505") return fail("Ya existe un producto con ese nombre o ese código");
      return fail(dbError(error, "No se pudo guardar el producto"));
    }
    await logActivity(ctx, "Editó un producto", { entity: "product", entityId: productId, detail: name });
    refresh();
    return ok("Producto actualizado");
  }

  const cost = optNum(formData, "cost");
  if (cost === undefined || (cost ?? 0) < 0) return fail("El costo no es válido");
  const { data, error } = await supabase
    .from("products")
    .insert({ ...row, cost_avg: cost ?? 0, organization_id: ctx.org.id })
    .select("id")
    .single();
  if (error || !data) {
    if (error?.code === "23505") return fail("Ya existe un producto con ese nombre o ese código");
    return fail(dbError(error, "No se pudo crear el producto"));
  }

  // Existencia inicial: se agrega como una entrada más.
  const initial = optNum(formData, "initial_stock");
  if (initial === undefined || (initial ?? 0) < 0) return fail("El producto se creó, pero la existencia inicial no es válida. Agrégala desde «Agregar existencias».");
  if (initial && initial > 0 && !isService) {
    if (!can(ctx, "inventory.write")) {
      return ok("Producto creado. No tienes permiso para agregar existencias.");
    }
    const { error: stockError } = await supabase.rpc("inv_add_stock", {
      p_product: data.id,
      p_quantity: initial,
      p_unit_cost: cost ?? 0,
      p_lot_code: optStr(formData, "initial_lot"),
      p_expires_on: optStr(formData, "initial_expiry"),
      p_reason: "Existencia inicial",
    });
    if (stockError) return fail(`El producto se creó, pero no se pudo agregar la existencia: ${dbError(stockError, "error")}`);
  }

  await logActivity(ctx, "Creó un producto", { entity: "product", entityId: data.id, detail: name });
  refresh();
  return ok("Producto creado");
}

export async function setProductActive(productId: string, active: boolean): Promise<ActionResult> {
  const g = await guard("inventory.manage");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;
  const supabase = await createClient();
  const { error } = await supabase.from("products").update({ is_active: active }).eq("id", productId).eq("organization_id", ctx.org.id);
  if (error) return fail(dbError(error, "No se pudo actualizar"));
  await logActivity(ctx, active ? "Activó un producto" : "Desactivó un producto", { entity: "product", entityId: productId });
  refresh();
  return ok(active ? "Activado" : "Desactivado");
}

// ---------------------------------------------------------------------------
// Existencias
// ---------------------------------------------------------------------------
/** AGREGAR existencias: se suman a las que ya hay. */
export async function addStock(productId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("inventory.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const qty = optNum(formData, "quantity");
  if (qty === null || qty === undefined || qty <= 0) return fail("Escribe la cantidad que vas a agregar");
  const cost = optNum(formData, "unit_cost");
  if (cost === undefined || (cost ?? 0) < 0) return fail("El costo no es válido");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("inv_add_stock", {
    p_product: productId,
    p_quantity: qty,
    p_unit_cost: cost,
    p_lot_code: optStr(formData, "lot_code"),
    p_expires_on: optStr(formData, "expires_on"),
    p_reason: optStr(formData, "reason"),
  });
  if (error) return fail(dbError(error, "No se pudo agregar la existencia"));

  await logActivity(ctx, "Agregó existencias", { entity: "product", entityId: productId, detail: `+${qty}` });
  refresh();
  return ok(`Listo. Ahora hay ${Number(data)} en existencia.`);
}

export async function adjustStock(productId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("inventory.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const qty = optNum(formData, "quantity");
  if (qty === null || qty === undefined || qty <= 0) return fail("Escribe la cantidad");
  const type = str(formData, "type");
  if (!["merma", "ajuste_menos", "ajuste_mas"].includes(type)) return fail("Elige el tipo de ajuste");
  const reason = str(formData, "reason");
  if (reason.length < 3) return fail("Escribe el motivo");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("inv_adjust_stock", {
    p_product: productId,
    p_delta: type === "ajuste_mas" ? qty : -qty,
    p_kind: type === "merma" ? "merma" : "ajuste",
    p_reason: reason,
    p_lot_id: optStr(formData, "lot_id"),
  });
  if (error) return fail(dbError(error, "No se pudo ajustar la existencia"));

  await logActivity(ctx, "Ajustó existencias", { entity: "product", entityId: productId, detail: `${type} ${qty}: ${reason}` });
  refresh();
  return ok(`Listo. Ahora hay ${Number(data)} en existencia.`);
}

export async function saveInventorySettings(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("inventory.manage");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const days = optNum(formData, "expiry_alert_days");
  if (days === null || days === undefined || !Number.isInteger(days) || days < 1 || days > 365) {
    return fail("Los días de aviso de vencimiento deben estar entre 1 y 365");
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("inventory_settings")
    .update({ expiry_alert_days: days, allow_negative_stock: checked(formData, "allow_negative_stock") })
    .eq("organization_id", ctx.org.id);
  if (error) return fail(dbError(error, "No se pudo guardar"));
  await logActivity(ctx, "Cambió los ajustes de inventario");
  refresh();
  return ok("Ajustes guardados");
}

// ---------------------------------------------------------------------------
// Proveedores y compras
// ---------------------------------------------------------------------------
export async function saveSupplier(supplierId: string | null, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("inventory.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const name = str(formData, "name");
  if (name.length < 2) return fail("Escribe el nombre del proveedor");
  const email = optStr(formData, "email");
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail("El correo no es válido");
  const row = { name, tax_id: optStr(formData, "tax_id"), phone: optStr(formData, "phone"), email, notes: optStr(formData, "notes") };

  const supabase = await createClient();
  const result = supplierId
    ? await supabase.from("suppliers").update(row).eq("id", supplierId).eq("organization_id", ctx.org.id)
    : await supabase.from("suppliers").insert({ ...row, organization_id: ctx.org.id });
  if (result.error) {
    if (result.error.code === "23505") return fail("Ya existe un proveedor con ese nombre");
    return fail(dbError(result.error, "No se pudo guardar el proveedor"));
  }
  await logActivity(ctx, supplierId ? "Editó un proveedor" : "Creó un proveedor", { entity: "supplier", detail: name });
  refresh();
  return ok("Proveedor guardado");
}

export async function receivePurchase(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("inventory.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const payload = readPayload(formData);
  if (!payload) return fail("No se pudo leer la compra. Inténtalo de nuevo.");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("inv_receive_purchase", { p_payload: payload });
  if (error) return fail(dbError(error, "No se pudo registrar la compra"));

  await logActivity(ctx, "Registró una compra", { entity: "purchase", entityId: data as string });
  refresh();
  redirect("/dashboard/inventario?tab=compras");
}

export async function voidPurchase(purchaseId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("inventory.manage");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const supabase = await createClient();
  const { error } = await supabase.rpc("inv_void_purchase", { p_purchase: purchaseId, p_reason: str(formData, "reason") });
  if (error) return fail(dbError(error, "No se pudo anular la compra"));

  await logActivity(ctx, "Anuló una compra", { entity: "purchase", entityId: purchaseId, detail: str(formData, "reason") });
  refresh();
  return ok("Compra anulada");
}

/** Descuenta del inventario lo usado en una consulta. */
export async function useInConsultation(consultationId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("inventory.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const payload = readPayload(formData);
  const items = payload && Array.isArray(payload.items) ? payload.items : null;
  if (!items || items.length === 0) return fail("Elige al menos un producto");

  const supabase = await createClient();
  const { error } = await supabase.rpc("inv_use_in_consultation", { p_consultation: consultationId, p_items: items });
  if (error) return fail(dbError(error, "No se pudo descontar del inventario"));

  await logActivity(ctx, "Descontó inventario de una consulta", { entity: "consultation", entityId: consultationId });
  refresh();
  revalidatePath(`/dashboard/consultas/${consultationId}`);
  return ok("Descontado del inventario");
}

// ---------------------------------------------------------------------------
// Ventas
// ---------------------------------------------------------------------------
export async function createSale(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("sales.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const payload = readPayload(formData);
  if (!payload) return fail("No se pudo leer la venta. Inténtalo de nuevo.");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sale_create", { p_payload: payload });
  if (error) return fail(dbError(error, "No se pudo registrar la venta"));

  await logActivity(ctx, "Registró una venta", { entity: "sale", entityId: data as string });
  refresh();
  redirect(`/dashboard/ventas/${data as string}`);
}

export async function addSalePayment(saleId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("sales.write");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const amount = optNum(formData, "amount");
  if (amount === null || amount === undefined || amount <= 0) return fail("Escribe el valor del abono");

  const supabase = await createClient();
  const { error } = await supabase.rpc("sale_add_payment", {
    p_sale: saleId,
    p_method: str(formData, "method") || "efectivo",
    p_amount: amount,
    p_reference: optStr(formData, "reference"),
  });
  if (error) return fail(dbError(error, "No se pudo registrar el abono"));

  await logActivity(ctx, "Registró un abono", { entity: "sale", entityId: saleId, detail: String(amount) });
  refresh();
  revalidatePath(`/dashboard/ventas/${saleId}`);
  return ok("Abono registrado");
}

export async function voidSale(saleId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("cash.manage");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const supabase = await createClient();
  const { error } = await supabase.rpc("sale_void", { p_sale: saleId, p_reason: str(formData, "reason") });
  if (error) return fail(dbError(error, "No se pudo anular la venta"));

  await logActivity(ctx, "Anuló una venta", { entity: "sale", entityId: saleId, detail: str(formData, "reason") });
  refresh();
  revalidatePath(`/dashboard/ventas/${saleId}`);
  return ok("Venta anulada");
}

// ---------------------------------------------------------------------------
// Caja
// ---------------------------------------------------------------------------
export async function openCash(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("cash.manage");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const amount = optNum(formData, "opening_amount");
  if (amount === undefined || (amount ?? 0) < 0) return fail("El monto inicial no es válido");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cash_open", { p_opening: amount ?? 0, p_notes: optStr(formData, "notes") });
  if (error) return fail(dbError(error, "No se pudo abrir la caja"));

  await logActivity(ctx, "Abrió la caja", { entity: "cash_session", entityId: data as string });
  refresh();
  return ok("Caja abierta");
}

export async function addCashMovement(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("cash.manage");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const amount = optNum(formData, "amount");
  if (amount === null || amount === undefined || amount <= 0) return fail("Escribe el valor");
  const kind = str(formData, "kind");
  if (!["ingreso", "egreso"].includes(kind)) return fail("Elige si es ingreso o egreso");

  const supabase = await createClient();
  const { error } = await supabase.rpc("cash_add_movement", {
    p_kind: kind,
    p_method: str(formData, "method") || "efectivo",
    p_amount: amount,
    p_concept: str(formData, "concept"),
  });
  if (error) return fail(dbError(error, "No se pudo registrar el movimiento"));

  await logActivity(ctx, `Registró un ${kind} de caja`, { entity: "cash_session", detail: `${amount} · ${str(formData, "concept")}` });
  refresh();
  return ok("Movimiento registrado");
}

export async function closeCash(sessionId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard("cash.manage");
  if (!g.ok) return fail(g.error);
  const { ctx } = g;

  const counted = optNum(formData, "counted_cash");
  if (counted === null || counted === undefined || counted < 0) return fail("Escribe el efectivo que contaste");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cash_close", { p_session: sessionId, p_counted: counted, p_notes: optStr(formData, "notes") });
  if (error) return fail(dbError(error, "No se pudo cerrar la caja"));

  const diff = Number((data as { difference: number }).difference);
  await logActivity(ctx, "Cerró la caja", { entity: "cash_session", entityId: sessionId, detail: `diferencia ${diff}` });
  refresh();
  return ok(diff === 0 ? "Caja cerrada. Cuadró exacto." : `Caja cerrada. Diferencia: ${diff > 0 ? "+" : ""}${diff}.`);
}
