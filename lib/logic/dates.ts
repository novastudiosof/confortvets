export const DEFAULT_TZ = "America/Bogota";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Fecha de hoy (yyyy-mm-dd) en la zona horaria dada. */
export function todayISO(tz: string = DEFAULT_TZ, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function toUtc(iso: string): number {
  return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
}

export function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((toUtc(toISO) - toUtc(fromISO)) / 86400000);
}

export function addDays(iso: string, days: number): string {
  return new Date(toUtc(iso) + days * 86400000).toISOString().slice(0, 10);
}

/** Suma meses a una fecha; si el día no existe en el mes destino, usa el último día. */
export function addMonths(iso: string, months: number): string {
  const y = +iso.slice(0, 4);
  const m = +iso.slice(5, 7) - 1;
  const d = +iso.slice(8, 10);
  const target = new Date(Date.UTC(y, m + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** dd/mm/aaaa a partir de yyyy-mm-dd o de un instante. */
export function formatDate(value: string | Date | null | undefined, tz: string = DEFAULT_TZ): string {
  if (!value) return "—";
  if (typeof value === "string" && ISO_DATE.test(value)) {
    return `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`;
  }
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export function formatDateTime(value: string | Date | null | undefined, tz: string = DEFAULT_TZ): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

/** Edad legible: "3 años 2 meses", "5 meses", "3 semanas", "4 días". */
export function calcAge(birthISO: string | null | undefined, today: string): string | null {
  if (!birthISO || !isIsoDate(birthISO) || birthISO > today) return null;
  const by = +birthISO.slice(0, 4), bm = +birthISO.slice(5, 7), bd = +birthISO.slice(8, 10);
  const ty = +today.slice(0, 4), tm = +today.slice(5, 7), td = +today.slice(8, 10);
  let months = (ty - by) * 12 + (tm - bm);
  if (td < bd) months -= 1;
  if (months >= 12) {
    const years = Math.floor(months / 12);
    const rest = months % 12;
    const y = `${years} ${years === 1 ? "año" : "años"}`;
    return rest ? `${y} ${rest} ${rest === 1 ? "mes" : "meses"}` : y;
  }
  if (months >= 1) return `${months} ${months === 1 ? "mes" : "meses"}`;
  const days = daysBetween(birthISO, today);
  if (days >= 7) {
    const weeks = Math.floor(days / 7);
    return `${weeks} ${weeks === 1 ? "semana" : "semanas"}`;
  }
  return `${days} ${days === 1 ? "día" : "días"}`;
}
