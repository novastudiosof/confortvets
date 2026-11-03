import Link from "next/link";

import { ReminderActions } from "@/components/reminder-actions";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Notice, PageHeader } from "@/components/ui/misc";
import { can, requireAccess } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/logic/dates";
import { REMINDER_KIND_LABEL, reminderBucket, whatsappLink } from "@/lib/logic/reminders";
import { renderTemplate } from "@/lib/logic/templates";
import { rowsById } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import type { Reminder } from "@/lib/types";

export const metadata = { title: "Recordatorios" };

const VIEWS = [
  { key: "por-enviar", label: "Por enviar" },
  { key: "enviados", label: "Enviados" },
  { key: "proximos", label: "Más adelante" },
] as const;

const BUCKET = {
  vencido: { label: "Vencido", variant: "danger" },
  hoy: { label: "Hoy", variant: "warning" },
  proximo: { label: "Próximo", variant: "default" },
} as const;

export default async function RemindersPage({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const ctx = await requireAccess("preventive.read");
  const { ver } = await searchParams;
  const view = VIEWS.some((v) => v.key === ver) ? (ver as (typeof VIEWS)[number]["key"]) : "por-enviar";
  const supabase = await createClient();

  let query = supabase
    .from("reminders")
    .select("id, patient_id, tutor_id, kind, title, due_date, remind_from, status, sent_at")
    .limit(200);
  if (view === "por-enviar") query = query.eq("status", "pendiente").lte("remind_from", ctx.today).order("due_date");
  else if (view === "proximos") query = query.eq("status", "pendiente").gt("remind_from", ctx.today).order("due_date");
  else query = query.eq("status", "enviado").order("sent_at", { ascending: false });
  const { data } = await query;
  const reminders = (data ?? []) as Reminder[];

  const [patients, tutors, { data: templateRows }] = await Promise.all([
    rowsById<{ id: string; name: string }>("patients", reminders.map((r) => r.patient_id), "id, name"),
    rowsById<{ id: string; full_name: string; whatsapp: string | null; contact_consent: boolean }>(
      "tutors",
      reminders.map((r) => r.tutor_id),
      "id, full_name, whatsapp, contact_consent"
    ),
    supabase.from("message_templates").select("kind, body"),
  ]);
  const templates = new Map((templateRows ?? []).map((t) => [t.kind as string, t.body as string]));
  const canManage = can(ctx, "reminders.manage") && !ctx.readOnly;

  return (
    <>
      <PageHeader
        title="Recordatorios"
        description="Vacunas, desparasitación y controles. Cada mensaje se envía con un clic por WhatsApp."
      />

      <nav className="mb-6 flex flex-wrap gap-2" aria-label="Filtros">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={`/dashboard/pendientes?ver=${v.key}`}
            className={`rounded-full px-4 py-1.5 text-sm ${view === v.key ? "bg-brand text-brand-on" : "border border-brand-border bg-white text-brand-ink hover:bg-black/5"}`}
          >
            {v.label}
          </Link>
        ))}
      </nav>

      {!can(ctx, "reminders.manage") && (
        <Notice tone="info" className="mb-4">
          Puedes ver los recordatorios, pero tu usuario no tiene permiso para enviarlos o marcarlos.
        </Notice>
      )}

      {reminders.length === 0 ? (
        <EmptyState>
          {view === "por-enviar" && "No hay recordatorios por enviar. ¡Todo al día!"}
          {view === "proximos" && "No hay recordatorios programados más adelante."}
          {view === "enviados" && "Todavía no se ha enviado ningún recordatorio."}
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {reminders.map((r) => {
            const patient = patients.get(r.patient_id);
            const tutor = tutors.get(r.tutor_id);
            const bucket = r.status === "pendiente" ? reminderBucket(r.due_date, r.remind_from, ctx.today) : null;
            const body = templates.get(r.kind) ?? "";
            const message = renderTemplate(body, {
              tutor: tutor?.full_name ?? "",
              paciente: patient?.name ?? "",
              clinica: ctx.settings.business_name,
              fecha: formatDate(r.due_date),
              motivo: r.title,
            });
            const link = whatsappLink(tutor?.whatsapp, message);

            return (
              <li
                key={r.id}
                className="flex flex-col gap-3 rounded-[var(--radius-brand-md)] border border-brand-border bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-brand-ink">
                    <Link href={`/dashboard/pacientes/${r.patient_id}?tab=preventivo`} className="hover:underline">
                      {patient?.name ?? "Paciente"}
                    </Link>
                    <span className="text-sm font-normal text-brand-muted">· {tutor?.full_name ?? "Tutor"}</span>
                    {bucket && <Badge variant={BUCKET[bucket].variant}>{BUCKET[bucket].label}</Badge>}
                    {r.status === "enviado" && <Badge variant="success">Enviado {formatDateTime(r.sent_at, ctx.tz)}</Badge>}
                    {tutor && !tutor.contact_consent && <Badge variant="warning">Sin autorización de contacto</Badge>}
                  </p>
                  <p className="text-sm text-brand-muted">
                    {REMINDER_KIND_LABEL[r.kind]} · {r.title} · para el {formatDate(r.due_date)}
                  </p>
                  <p className="mt-1 line-clamp-2 text-xs text-brand-muted">{message}</p>
                </div>
                {r.status !== "hecho" && r.status !== "descartado" && (
                  <ReminderActions id={r.id} link={link} message={message} status={r.status} canManage={canManage} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
