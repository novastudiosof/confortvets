import { daysBetween } from "@/lib/logic/dates";

export const PRODUCT_CATEGORIES = [
  { value: "medicamento", label: "Medicamento" },
  { value: "insumo", label: "Insumo" },
  { value: "alimento", label: "Alimento" },
  { value: "accesorio", label: "Accesorio" },
  { value: "servicio", label: "Servicio" },
  { value: "otro", label: "Otro" },
] as const;

export const PAYMENT_METHODS = [
  { value: "efectivo", label: "Efectivo" },
  { value: "transferencia", label: "Transferencia" },
  { value: "tarjeta", label: "Tarjeta" },
  { value: "nequi", label: "Nequi" },
  { value: "daviplata", label: "Daviplata" },
  { value: "otro", label: "Otro" },
] as const;

export const MOVEMENT_LABEL: Record<string, string> = {
  entrada: "Entrada",
  compra: "Compra",
  anulacion_compra: "Anulación de compra",
  ajuste: "Ajuste",
  merma: "Merma",
  uso_consulta: "Uso en consulta",
  venta: "Venta",
  anulacion_venta: "Anulación de venta",
};

export const SALE_STATUS = {
  pagada: { label: "Pagada", variant: "success" },
  pendiente: { label: "Por cobrar", variant: "warning" },
  anulada: { label: "Anulada", variant: "danger" },
} as const;

export function paymentLabel(method: string): string {
  return PAYMENT_METHODS.find((m) => m.value === method)?.label ?? method;
}

/** Valor en pesos (o la moneda dada), sin decimales si es un valor entero. */
export function formatMoney(value: number | string | null | undefined, currency = "COP"): string {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
  }).format(n);
}

/** Cantidad sin ceros sobrantes: 3.000 -> "3", 2.500 -> "2,5". */
export function formatQty(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 3 }).format(n);
}

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export interface LineInput {
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
}

/** Misma cuenta que sale_create: el precio incluye el IVA. */
export function computeLine({ quantity, unitPrice, discount, taxRate }: LineInput): { gross: number; base: number; tax: number } {
  const gross = round2(quantity * unitPrice - discount);
  const base = round2(gross / (1 + taxRate / 100));
  return { gross, base, tax: round2(gross - base) };
}

export function computeTotals(lines: LineInput[]): { gross: number; base: number; tax: number; discount: number } {
  let gross = 0;
  let base = 0;
  let tax = 0;
  let discount = 0;
  for (const l of lines) {
    const c = computeLine(l);
    gross += c.gross;
    base += c.base;
    tax += c.tax;
    discount += l.discount;
  }
  return { gross: round2(gross), base: round2(base), tax: round2(tax), discount: round2(discount) };
}

export type StockState = "agotado" | "bajo" | "ok";

export function stockState(stock: number, minStock: number, isService: boolean): StockState {
  if (isService) return "ok";
  if (stock <= 0) return "agotado";
  if (minStock > 0 && stock <= minStock) return "bajo";
  return "ok";
}

export type ExpiryState = "vencido" | "por_vencer" | "ok" | "sin_fecha";

/** Estado de un lote según su vencimiento y los días de alerta. */
export function expiryState(expiresOn: string | null | undefined, today: string, alertDays: number): ExpiryState {
  if (!expiresOn) return "sin_fecha";
  const days = daysBetween(today, expiresOn);
  if (days < 0) return "vencido";
  if (days <= alertDays) return "por_vencer";
  return "ok";
}

/** Valor del inventario a costo promedio. */
export function inventoryValue(rows: { stock: number | string; cost_avg: number | string }[]): number {
  return round2(rows.reduce((sum, r) => sum + Number(r.stock) * Number(r.cost_avg), 0));
}
