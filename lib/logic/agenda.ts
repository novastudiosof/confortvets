import { addDays } from "@/lib/logic/dates";

/** Estados de una cita y sus textos. */
export type AppointmentStatus = "programada" | "confirmada" | "en_sala" | "atendida" | "cancelada" | "no_asistio";

export const APPOINTMENT_STATUS: Record<
  AppointmentStatus,
  { label: string; variant: "warning" | "success" | "danger" | "muted" | "default" }
> = {
  programada: { label: "Programada", variant: "warning" },
  confirmada: { label: "Confirmada", variant: "success" },
  en_sala: { label: "En sala", variant: "default" },
  atendida: { label: "Atendida", variant: "muted" },
  cancelada: { label: "Cancelada", variant: "danger" },
  no_asistio: { label: "No asistió", variant: "danger" },
};

/** Estados en los que la cita todavía ocupa tiempo en la agenda. */
export const ACTIVE_STATUSES: AppointmentStatus[] = ["programada", "confirmada", "en_sala"];

export function isActiveStatus(status: string): boolean {
  return (ACTIVE_STATUSES as string[]).includes(status);
}

export const WEEKDAY_LABEL = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

// ---------------------------------------------------------------------------
// Zonas horarias: los horarios se guardan como hora local del consultorio y
// las citas como instante (UTC).
// ---------------------------------------------------------------------------
function tzOffsetMinutes(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const v = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second"));
  return (asUtc - utcMs) / 60000;
}

/** Instante que corresponde a una fecha (yyyy-mm-dd) y hora (HH:MM) locales. */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const [h, m] = time.split(":").map(Number);
  const naive = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), h, m);
  // Dos pasadas para acertar también cerca de cambios de horario.
  let ms = naive - tzOffsetMinutes(naive, tz) * 60000;
  ms = naive - tzOffsetMinutes(ms, tz) * 60000;
  return new Date(ms);
}

/** Fecha (yyyy-mm-dd) y hora (HH:MM) locales de un instante. */
export function localParts(instant: Date | string, tz: string): { date: string; time: string } {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d);
  const p = (type: string) => parts.find((x) => x.type === type)?.value ?? "00";
  return { date: `${p("year")}-${p("month")}-${p("day")}`, time: `${p("hour")}:${p("minute")}` };
}

/** Inicio y fin (instantes) del día local. */
export function dayRange(date: string, tz: string): { from: Date; to: Date } {
  return { from: zonedToUtc(date, "00:00", tz), to: zonedToUtc(addDays(date, 1), "00:00", tz) };
}

/** 0 = domingo ... 6 = sábado. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Lunes de la semana de la fecha dada. */
export function weekStart(date: string): string {
  const wd = weekdayOf(date);
  return addDays(date, wd === 0 ? -6 : 1 - wd);
}

// ---------------------------------------------------------------------------
// Horas
// ---------------------------------------------------------------------------
export function isTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** Acepta "08:00" o "08:00:00" (formato de Postgres) y devuelve "08:00". */
export function trimTime(value: string): string {
  return value.slice(0, 5);
}

export function minutesOf(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

export function timeOfMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function formatTime12(time: string): string {
  const total = minutesOf(time);
  const h = Math.floor(total / 60);
  const m = total % 60;
  const suffix = h >= 12 ? "p. m." : "a. m.";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

export interface HourRange {
  start: string;
  end: string;
}

/** Horas de inicio de cada espacio dentro de las franjas de atención. */
export function generateSlots(ranges: HourRange[], slotMinutes: number): string[] {
  const out: string[] = [];
  for (const r of [...ranges].sort((a, b) => a.start.localeCompare(b.start))) {
    for (let t = minutesOf(r.start); t + slotMinutes <= minutesOf(r.end); t += slotMinutes) {
      out.push(timeOfMinutes(t));
    }
  }
  return out;
}

/** ¿La cita (inicio y duración) cabe completa dentro de una franja de atención? */
export function fitsInHours(time: string, durationMinutes: number, ranges: HourRange[]): boolean {
  const start = minutesOf(time);
  const end = start + durationMinutes;
  return ranges.some((r) => start >= minutesOf(r.start) && end <= minutesOf(r.end));
}

export function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

/** Valida que las franjas de un día no se crucen. */
export function hasOverlappingRanges(ranges: HourRange[]): boolean {
  const sorted = [...ranges].sort((a, b) => a.start.localeCompare(b.start));
  for (let i = 1; i < sorted.length; i++) {
    if (minutesOf(sorted[i].start) < minutesOf(sorted[i - 1].end)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Línea de tiempo del día
// ---------------------------------------------------------------------------
export interface TimelineAppointment {
  id: string;
  startMin: number;
  endMin: number;
  status: string;
}

export interface TimelineBlock {
  id: string;
  startMin: number;
  endMin: number;
}

export type TimelineEntry =
  | { kind: "free"; start: string }
  | { kind: "appointment"; id: string; startMin: number }
  | { kind: "block"; id: string; startMin: number };

/**
 * Ordena en el tiempo las citas, los bloqueos y los espacios libres del día.
 * Un espacio libre solo aparece si ninguna cita activa ni bloqueo lo ocupa.
 * Las citas canceladas o sin asistencia se muestran pero no ocupan espacio.
 */
export function buildTimeline(
  slots: string[],
  slotMinutes: number,
  appointments: TimelineAppointment[],
  blocks: TimelineBlock[],
  allowOverlap: boolean
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  const busy = appointments.filter((a) => isActiveStatus(a.status));

  for (const s of slots) {
    const start = minutesOf(s);
    const end = start + slotMinutes;
    const taken = !allowOverlap && busy.some((a) => rangesOverlap(start, end, a.startMin, a.endMin));
    const blocked = blocks.some((b) => rangesOverlap(start, end, b.startMin, b.endMin));
    if (!taken && !blocked) entries.push({ kind: "free", start: s });
  }
  for (const a of appointments) entries.push({ kind: "appointment", id: a.id, startMin: a.startMin });
  for (const b of blocks) entries.push({ kind: "block", id: b.id, startMin: b.startMin });

  const keyOf = (e: TimelineEntry) => (e.kind === "free" ? minutesOf(e.start) : e.startMin);
  const rank = { block: 0, appointment: 1, free: 2 } as const;
  return entries.sort((x, y) => keyOf(x) - keyOf(y) || rank[x.kind] - rank[y.kind]);
}

/** Minutos desde las 00:00 del día local `date`, acotados a ese día (0 a 1440). */
export function minutesInDay(instant: Date | string, date: string, tz: string): number {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  const { from, to } = dayRange(date, tz);
  if (d <= from) return 0;
  if (d >= to) return 1440;
  return Math.round((d.getTime() - from.getTime()) / 60000);
}
