import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Plus, Settings } from "lucide-react";

import { AppointmentActions } from "@/components/appointment-actions";
import { AppointmentFields, type AppointmentDefaults, type TypeOption } from "@/components/appointment-fields";
import { DialogForm } from "@/components/dialog-form";
import { PatientPicker } from "@/components/patient-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SelectField, TextAreaField } from "@/components/ui/fields";
import { EmptyState, Notice, PageHeader, Section } from "@/components/ui/misc";
import { DiscardWaitlistButton, ReminderLink } from "@/components/waitlist-actions";
import { addToWaitlist, createAppointment } from "@/lib/actions/agenda";
import { can, requireAccess } from "@/lib/auth";
import {
  APPOINTMENT_STATUS,
  buildTimeline,
  dayRange,
  formatTime12,
  generateSlots,
  isActiveStatus,
  isTime,
  localParts,
  minutesInDay,
  trimTime,
  weekStart,
  weekdayOf,
} from "@/lib/logic/agenda";
import { addDays, formatDate, isIsoDate } from "@/lib/logic/dates";
import { isHexColor } from "@/lib/logic/colors";
import { whatsappLink } from "@/lib/logic/reminders";
import { renderTemplate } from "@/lib/logic/templates";
import { rowsById } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import type { AgendaBlock, AgendaHour, AgendaSettings, Appointment, AppointmentType, WaitlistEntry } from "@/lib/types";

export const metadata = { title: "Agenda" };

interface SearchParams {
  fecha?: string;
  vista?: string;
  nueva?: string;
  hora?: string;
  paciente?: string;
  tipo?: string;
  espera?: string;
}

const DEFAULT_COLOR = "#3B82F6";

function longDate(date: string): string {
  return new Intl.DateTimeFormat("es-CO", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(
    new Date(`${date}T12:00:00Z`)
  );
}

function shortDay(date: string): string {
  return new Intl.DateTimeFormat("es-CO", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(
    new Date(`${date}T12:00:00Z`)
  );
}

export default async function AgendaPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireAccess("agenda.read");
  const sp = await searchParams;
  const supabase = await createClient();

  const date = sp.fecha && isIsoDate(sp.fecha) ? sp.fecha : ctx.today;
  const view = sp.vista === "semana" ? "semana" : "dia";
  const canWrite = can(ctx, "agenda.write") && !ctx.readOnly;
  const canAttend = canWrite;

  const rangeFrom = view === "dia" ? dayRange(date, ctx.tz).from : dayRange(weekStart(date), ctx.tz).from;
  const rangeTo = view === "dia" ? dayRange(date, ctx.tz).to : dayRange(addDays(weekStart(date), 6), ctx.tz).to;
  const tomorrow = addDays(ctx.today, 1);
  const tomorrowRange = dayRange(tomorrow, ctx.tz);

  const [settingsRes, hoursRes, typesRes, apptsRes, blocksRes, waitRes, remindRes] = await Promise.all([
    supabase.from("agenda_settings").select("*").maybeSingle(),
    supabase.from("agenda_hours").select("id, weekday, starts_at, ends_at").order("starts_at"),
    supabase.from("appointment_types").select("id, name, duration_minutes, color, is_active").order("sort_order").order("name"),
    supabase
      .from("appointments")
      .select("id, patient_id, tutor_id, type_id, starts_at, ends_at, status, reason, notes, consultation_id, cancel_reason, reminder_sent_at")
      .gte("starts_at", rangeFrom.toISOString())
      .lt("starts_at", rangeTo.toISOString())
      .order("starts_at"),
    supabase
      .from("agenda_blocks")
      .select("id, starts_at, ends_at, reason")
      .lt("starts_at", rangeTo.toISOString())
      .gt("ends_at", rangeFrom.toISOString())
      .order("starts_at"),
    supabase.from("agenda_waitlist").select("id, patient_id, tutor_id, type_id, notes, status, created_at").eq("status", "esperando").order("created_at"),
    supabase
      .from("appointments")
      .select("id, patient_id, tutor_id, starts_at, reason, status, reminder_sent_at")
      .in("status", ["programada", "confirmada"])
      .is("reminder_sent_at", null)
      .gte("starts_at", tomorrowRange.from.toISOString())
      .lt("starts_at", tomorrowRange.to.toISOString())
      .order("starts_at"),
  ]);

  const settings = (settingsRes.data ?? {
    organization_id: ctx.org.id,
    slot_minutes: 30,
    allow_overlap: false,
    reminder_template: "",
  }) as AgendaSettings;
  const hours = (hoursRes.data ?? []) as AgendaHour[];
  const allTypes = (typesRes.data ?? []) as AppointmentType[];
  const types = allTypes.filter((t) => t.is_active);
  const typeById = new Map(allTypes.map((t) => [t.id, t]));
  const typeOptions: TypeOption[] = types.map((t) => ({ id: t.id, name: t.name, duration_minutes: t.duration_minutes }));
  const appts = (apptsRes.data ?? []) as Appointment[];
  const blocks = (blocksRes.data ?? []) as AgendaBlock[];
  const waitlist = (waitRes.data ?? []) as WaitlistEntry[];
  const toRemind = (remindRes.data ?? []) as Pick<Appointment, "id" | "patient_id" | "tutor_id" | "starts_at" | "reason" | "status" | "reminder_sent_at">[];

  // Nombres de pacientes y tutores que aparecen en pantalla
  const patientIds = [...appts.map((a) => a.patient_id), ...waitlist.map((w) => w.patient_id), ...toRemind.map((a) => a.patient_id)];
  const tutorIds = [...appts.map((a) => a.tutor_id), ...waitlist.map((w) => w.tutor_id), ...toRemind.map((a) => a.tutor_id)];
  const [patientMap, tutorMap] = await Promise.all([
    rowsById<{ id: string; name: string }>("patients", patientIds, "id, name"),
    rowsById<{ id: string; full_name: string; phone: string | null; whatsapp: string | null }>("tutors", tutorIds, "id, full_name, phone, whatsapp"),
  ]);

  // Lista para elegir paciente al agendar
  let pickerPatients: { id: string; label: string }[] = [];
  if (canWrite) {
    const [{ data: pRows }, { data: tRows }] = await Promise.all([
      supabase.from("patients").select("id, name, tutor_id").eq("status", "activo").order("name").limit(2000),
      supabase.from("tutors").select("id, full_name").eq("is_active", true).limit(2000),
    ]);
    const tutorName = new Map((tRows ?? []).map((t) => [t.id as string, t.full_name as string]));
    pickerPatients = (pRows ?? [])
      .filter((p) => tutorName.has(p.tutor_id as string))
      .map((p) => ({ id: p.id as string, label: `${p.name} · ${tutorName.get(p.tutor_id as string)}` }));
  }

  function reminderUrl(a: Pick<Appointment, "patient_id" | "tutor_id" | "starts_at" | "reason">): string | null {
    const tutor = tutorMap.get(a.tutor_id);
    if (!tutor) return null;
    const local = localParts(a.starts_at, ctx.tz);
    const message = renderTemplate(settings.reminder_template, {
      tutor: tutor.full_name,
      paciente: patientMap.get(a.patient_id)?.name ?? "",
      clinica: ctx.settings.business_name,
      profesional: ctx.settings.professional_name ?? "",
      telefono_clinica: ctx.settings.phone ?? "",
      fecha: formatDate(local.date),
      hora: formatTime12(local.time),
      motivo: a.reason ?? "",
    });
    return whatsappLink(tutor.whatsapp ?? tutor.phone, message);
  }

  function defaultsFor(a: Appointment): AppointmentDefaults {
    const local = localParts(a.starts_at, ctx.tz);
    return {
      date: local.date,
      time: local.time,
      duration: Math.round((new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 60000),
      typeId: a.type_id ?? "",
      reason: a.reason ?? "",
      notes: a.notes ?? "",
    };
  }

  const baseQuery = (extra: Record<string, string> = {}) => {
    const q = new URLSearchParams({ vista: view, fecha: date, ...extra });
    return `/dashboard/agenda?${q.toString()}`;
  };
  const step = view === "dia" ? 1 : 7;

  // Valores iniciales del diálogo "Nueva cita"
  const prefillType = types.find((t) => t.id === sp.tipo);
  const newDefaults: AppointmentDefaults = {
    date,
    time: sp.hora && isTime(sp.hora) ? sp.hora : "",
    duration: prefillType?.duration_minutes ?? settings.slot_minutes,
    typeId: prefillType?.id ?? "",
    reason: "",
    notes: "",
  };

  function renderCard(a: Appointment) {
    const start = localParts(a.starts_at, ctx.tz);
    const end = localParts(a.ends_at, ctx.tz);
    const type = a.type_id ? typeById.get(a.type_id) : null;
    const color = type?.color && isHexColor(type.color) ? type.color : DEFAULT_COLOR;
    const tutor = tutorMap.get(a.tutor_id);
    const st = APPOINTMENT_STATUS[a.status];
    const closed = !isActiveStatus(a.status);
    return (
      <div
        key={`a-${a.id}`}
        className={`rounded-[var(--radius-brand-md)] border border-brand-border bg-white p-3 shadow-sm ${closed ? "opacity-70" : ""}`}
        style={{ borderLeft: `4px solid ${color}` }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-brand-ink">
            {formatTime12(start.time)} – {formatTime12(end.time)}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {type && (
              <Badge variant="outline" style={{ borderColor: color, color }}>
                {type.name}
              </Badge>
            )}
            <Badge variant={st.variant}>{st.label}</Badge>
          </div>
        </div>
        <p className="mt-1 text-sm">
          <Link href={`/dashboard/pacientes/${a.patient_id}`} className="font-medium text-brand-dark hover:underline">
            {patientMap.get(a.patient_id)?.name ?? "Paciente"}
          </Link>
          {tutor && (
            <span className="text-brand-muted">
              {" "}
              · {tutor.full_name}
              {tutor.whatsapp || tutor.phone ? ` · ${tutor.whatsapp ?? tutor.phone}` : ""}
            </span>
          )}
        </p>
        {a.reason && <p className="text-sm text-brand-ink">{a.reason}</p>}
        {a.notes && <p className="text-xs text-brand-muted">Nota: {a.notes}</p>}
        {a.status === "cancelada" && a.cancel_reason && <p className="text-xs text-brand-muted">Motivo: {a.cancel_reason}</p>}
        {a.reminder_sent_at && isActiveStatus(a.status) && <p className="text-xs text-brand-muted">Recordatorio enviado</p>}
        {a.consultation_id && (
          <p className="mt-1 text-sm">
            <Link href={`/dashboard/consultas/${a.consultation_id}`} className="text-brand-dark hover:underline">
              Ver la consulta
            </Link>
          </p>
        )}
        {canWrite && isActiveStatus(a.status) && (
          <div className="mt-2">
            <AppointmentActions
              id={a.id}
              status={a.status}
              canAttend={canAttend}
              whatsappUrl={reminderUrl(a)}
              reminded={Boolean(a.reminder_sent_at)}
              types={typeOptions}
              defaults={defaultsFor(a)}
              slotMinutes={settings.slot_minutes}
            />
          </div>
        )}
      </div>
    );
  }

  // --- Vista de un día ----------------------------------------------------
  function renderDay() {
    const ranges = hours.filter((h) => h.weekday === weekdayOf(date)).map((h) => ({ start: trimTime(h.starts_at), end: trimTime(h.ends_at) }));
    const slots = generateSlots(ranges, settings.slot_minutes);
    const nowLocal = localParts(new Date(), ctx.tz);
    const futureSlots = slots.filter((s) => date > ctx.today || (date === ctx.today && s >= nowLocal.time));

    const timelineAppts = appts.map((a) => ({
      id: a.id,
      status: a.status,
      startMin: minutesInDay(a.starts_at, date, ctx.tz),
      endMin: minutesInDay(a.ends_at, date, ctx.tz),
    }));
    const timelineBlocks = blocks.map((b) => ({
      id: b.id,
      startMin: minutesInDay(b.starts_at, date, ctx.tz),
      endMin: minutesInDay(b.ends_at, date, ctx.tz),
    }));
    const entries = buildTimeline(canWrite ? futureSlots : [], settings.slot_minutes, timelineAppts, timelineBlocks, settings.allow_overlap);
    const apptById = new Map(appts.map((a) => [a.id, a]));
    const blockById = new Map(blocks.map((b) => [b.id, b]));
    const active = appts.filter((a) => isActiveStatus(a.status)).length;

    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-brand-muted">
          {appts.length === 0 ? "Sin citas este día." : `${active} cita${active === 1 ? "" : "s"} activa${active === 1 ? "" : "s"} de ${appts.length}.`}
          {ranges.length > 0
            ? ` Horario: ${ranges.map((r) => `${formatTime12(r.start)} a ${formatTime12(r.end)}`).join(" y ")}.`
            : " No hay horario de atención este día."}
        </p>
        {entries.length === 0 ? (
          <EmptyState>
            <CalendarDays className="mx-auto mb-2 h-5 w-5" />
            No hay citas ni espacios para mostrar.
          </EmptyState>
        ) : (
          entries.map((e, i) => {
            if (e.kind === "free") {
              return (
                <Link
                  key={`f-${e.start}-${i}`}
                  href={baseQuery({ nueva: "1", hora: e.start })}
                  className="flex items-center gap-3 rounded-[var(--radius-brand-md)] border border-dashed border-brand-border px-3 py-2 text-sm text-brand-muted hover:border-brand hover:bg-brand/5 hover:text-brand-dark"
                >
                  <Clock className="h-4 w-4" />
                  <span className="w-20 font-medium">{formatTime12(e.start)}</span>
                  <span>Libre · agendar</span>
                </Link>
              );
            }
            if (e.kind === "block") {
              const b = blockById.get(e.id)!;
              return (
                <div key={`b-${b.id}`} className="rounded-[var(--radius-brand-md)] border border-brand-border bg-black/[0.04] px-3 py-2 text-sm text-brand-muted">
                  <strong>Bloqueado</strong> · {b.reason} ({formatTime12(localParts(b.starts_at, ctx.tz).time)} –{" "}
                  {formatTime12(localParts(b.ends_at, ctx.tz).time)})
                </div>
              );
            }
            const a = apptById.get(e.id)!;
            return renderCard(a);
          })
        )}
      </div>
    );
  }

  // --- Vista de la semana -------------------------------------------------
  function renderWeek() {
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart(date), i));
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {days.map((d) => {
          const list = appts.filter((a) => localParts(a.starts_at, ctx.tz).date === d);
          const dayBlocks = blocks.filter((b) => localParts(b.starts_at, ctx.tz).date <= d && localParts(b.ends_at, ctx.tz).date >= d);
          const hasHours = hours.some((h) => h.weekday === weekdayOf(d));
          return (
            <div
              key={d}
              className={`flex flex-col gap-2 rounded-[var(--radius-brand-md)] border bg-white p-2.5 shadow-sm ${d === ctx.today ? "border-brand" : "border-brand-border"}`}
            >
              <Link href={`/dashboard/agenda?vista=dia&fecha=${d}`} className="text-sm font-semibold capitalize text-brand-dark hover:underline">
                {shortDay(d)}
              </Link>
              {!hasHours && list.length === 0 && <p className="text-xs text-brand-muted">Sin atención</p>}
              {dayBlocks.map((b) => (
                <p key={b.id} className="rounded bg-black/[0.05] px-2 py-1 text-xs text-brand-muted">
                  Bloqueado: {b.reason}
                </p>
              ))}
              {list.map((a) => {
                const start = localParts(a.starts_at, ctx.tz);
                const type = a.type_id ? typeById.get(a.type_id) : null;
                const color = type?.color && isHexColor(type.color) ? type.color : DEFAULT_COLOR;
                return (
                  <Link
                    key={a.id}
                    href={`/dashboard/agenda?vista=dia&fecha=${d}`}
                    className={`rounded border border-brand-border px-2 py-1 text-xs hover:bg-black/5 ${isActiveStatus(a.status) ? "" : "opacity-60 line-through"}`}
                    style={{ borderLeft: `3px solid ${color}` }}
                  >
                    <span className="font-semibold">{formatTime12(start.time)}</span> {patientMap.get(a.patient_id)?.name ?? "Paciente"}
                  </Link>
                );
              })}
              {canWrite && d >= ctx.today && (
                <Link href={`/dashboard/agenda?vista=dia&fecha=${d}&nueva=1`} className="text-xs text-brand-dark hover:underline">
                  + Agendar
                </Link>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Agenda"
        description={view === "dia" ? <span className="capitalize">{longDate(date)}</span> : `Semana del ${formatDate(weekStart(date))}`}
        actions={
          <>
            {can(ctx, "settings.write") && (
              <Button asChild variant="outline">
                <Link href="/dashboard/configuracion?tab=agenda">
                  <Settings /> Horario y ajustes
                </Link>
              </Button>
            )}
            {canWrite && (
              <DialogForm
                key={`${date}-${sp.hora ?? ""}-${sp.paciente ?? ""}-${sp.nueva ?? ""}`}
                defaultOpen={sp.nueva === "1"}
                trigger={
                  <>
                    <Plus /> Nueva cita
                  </>
                }
                title="Nueva cita"
                description="Elige el paciente y la fecha. Si el tutor todavía no está registrado, créalo primero en Tutores."
                action={createAppointment}
                submitLabel="Agendar cita"
                wide
              >
                <PatientPicker patients={pickerPatients} defaultId={sp.paciente} />
                {sp.espera && <input type="hidden" name="waitlist_id" value={sp.espera} />}
                <AppointmentFields types={typeOptions} defaults={newDefaults} slotMinutes={settings.slot_minutes} showConfirmed />
              </DialogForm>
            )}
          </>
        }
      />

      {ctx.readOnly && (
        <Notice tone="warning" className="mb-4">
          Tu membresía venció: puedes ver la agenda pero no agendar ni cambiar citas.
        </Notice>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="icon" aria-label="Anterior">
          <Link href={`/dashboard/agenda?vista=${view}&fecha=${addDays(date, -step)}`}>
            <ChevronLeft />
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={`/dashboard/agenda?vista=${view}&fecha=${ctx.today}`}>Hoy</Link>
        </Button>
        <Button asChild variant="outline" size="icon" aria-label="Siguiente">
          <Link href={`/dashboard/agenda?vista=${view}&fecha=${addDays(date, step)}`}>
            <ChevronRight />
          </Link>
        </Button>
        <form method="get" className="flex items-center gap-2">
          <input type="hidden" name="vista" value={view} />
          <input
            type="date"
            name="fecha"
            defaultValue={date}
            className="h-10 rounded-[var(--radius-brand-sm)] border border-brand-border bg-white px-3 text-sm"
            aria-label="Ir a la fecha"
          />
          <Button type="submit" variant="outline">
            Ir
          </Button>
        </form>
        <div className="ml-auto inline-flex rounded-[var(--radius-brand-sm)] border border-brand-border bg-white p-0.5 text-sm">
          {(["dia", "semana"] as const).map((v) => (
            <Link
              key={v}
              href={`/dashboard/agenda?vista=${v}&fecha=${date}`}
              className={`rounded px-3 py-1.5 font-medium ${view === v ? "bg-brand text-brand-on" : "text-brand-muted hover:text-brand-ink"}`}
            >
              {v === "dia" ? "Día" : "Semana"}
            </Link>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-6">
        {view === "dia" ? renderDay() : renderWeek()}

        {canWrite && toRemind.length > 0 && (
          <Section title={`Recordar las citas de mañana (${toRemind.length})`}>
            <ul className="divide-y divide-brand-border">
              {toRemind.map((a) => {
                const url = reminderUrl(a);
                const local = localParts(a.starts_at, ctx.tz);
                return (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span>
                      <strong>{formatTime12(local.time)}</strong> · {patientMap.get(a.patient_id)?.name ?? "Paciente"} ·{" "}
                      <span className="text-brand-muted">{tutorMap.get(a.tutor_id)?.full_name}</span>
                    </span>
                    {url ? <ReminderLink id={a.id} url={url} reminded={false} /> : <span className="text-xs text-brand-muted">Sin WhatsApp ni teléfono</span>}
                  </li>
                );
              })}
            </ul>
          </Section>
        )}

        <Section
          title={`Lista de espera (${waitlist.length})`}
          actions={
            canWrite && (
              <DialogForm
                trigger={
                  <>
                    <Plus /> Agregar
                  </>
                }
                triggerVariant="outline"
                triggerSize="sm"
                title="Agregar a la lista de espera"
                description="Para quien quiere cita y todavía no hay un espacio. Cuando se libere uno, lo agendas desde aquí."
                action={addToWaitlist}
                submitLabel="Agregar"
              >
                <PatientPicker patients={pickerPatients} />
                <SelectField
                  label="Tipo de cita"
                  name="type_id"
                  placeholder="Sin tipo"
                  options={typeOptions.map((t) => ({ value: t.id, label: t.name }))}
                />
                <TextAreaField label="Notas (opcional)" name="notes" rows={2} placeholder="Ej.: prefiere las tardes" />
              </DialogForm>
            )
          }
        >
          {waitlist.length === 0 ? (
            <EmptyState>Nadie está esperando un espacio.</EmptyState>
          ) : (
            <ul className="divide-y divide-brand-border">
              {waitlist.map((w) => (
                <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <span>
                    <strong>{patientMap.get(w.patient_id)?.name ?? "Paciente"}</strong>
                    <span className="text-brand-muted">
                      {" "}
                      · {tutorMap.get(w.tutor_id)?.full_name}
                      {w.type_id && typeById.get(w.type_id) ? ` · ${typeById.get(w.type_id)!.name}` : ""} · desde {formatDate(w.created_at, ctx.tz)}
                    </span>
                    {w.notes && <span className="block text-xs text-brand-muted">{w.notes}</span>}
                  </span>
                  {canWrite && (
                    <span className="flex gap-1.5">
                      <Button asChild size="sm">
                        <Link href={baseQuery({ nueva: "1", paciente: w.patient_id, espera: w.id, ...(w.type_id ? { tipo: w.type_id } : {}) })}>Agendar</Link>
                      </Button>
                      <DiscardWaitlistButton id={w.id} />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
