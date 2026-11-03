import Link from "next/link";
import { PawPrint, Plus, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, Notice, PageHeader, Section, Stat } from "@/components/ui/misc";
import { can, hasModule, requireOrgContext } from "@/lib/auth";
import { formatBytes } from "@/lib/logic/storage";
import { formatDate } from "@/lib/logic/dates";
import { REMINDER_KIND_LABEL } from "@/lib/logic/reminders";
import { rowsById, storageUsedBytes } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import type { Reminder } from "@/lib/types";

import { TodayAppointments } from "./today-appointments";

export const metadata = { title: "Inicio" };

const STATUS_BADGE = {
  borrador: { label: "Borrador", variant: "warning" },
  cerrada: { label: "Cerrada", variant: "success" },
  anulada: { label: "Anulada", variant: "danger" },
} as const;

export default async function DashboardHome({ searchParams }: { searchParams: Promise<{ sin_acceso?: string }> }) {
  const ctx = await requireOrgContext();
  const { sin_acceso } = await searchParams;
  const supabase = await createClient();

  const canTutors = can(ctx, "tutors.read");
  const canPatients = can(ctx, "patients.read");
  const canClinical = can(ctx, "clinical.read") && hasModule(ctx, "clinical");
  const canReminders = can(ctx, "preventive.read");

  const [tutorsCount, patientsCount, reminders, consultations, used] = await Promise.all([
    canTutors ? supabase.from("tutors").select("id", { count: "exact", head: true }).eq("is_active", true) : null,
    canPatients ? supabase.from("patients").select("id", { count: "exact", head: true }).eq("status", "activo") : null,
    canReminders
      ? supabase
          .from("reminders")
          .select("id, patient_id, tutor_id, kind, title, due_date, remind_from, status, sent_at")
          .eq("status", "pendiente")
          .lte("remind_from", ctx.today)
          .order("due_date")
          .limit(6)
      : null,
    canClinical
      ? supabase
          .from("consultations")
          .select("id, patient_id, kind, status, consulted_at, reason")
          .order("consulted_at", { ascending: false })
          .limit(6)
      : null,
    ctx.profile.role === "owner" ? storageUsedBytes() : Promise.resolve(null),
  ]);

  const pending = (reminders?.data ?? []) as Reminder[];
  const recent = (consultations?.data ?? []) as {
    id: string;
    patient_id: string;
    kind: string;
    status: keyof typeof STATUS_BADGE;
    consulted_at: string;
    reason: string | null;
  }[];

  const patients = await rowsById<{ id: string; name: string }>(
    "patients",
    [...pending.map((r) => r.patient_id), ...recent.map((c) => c.patient_id)],
    "id, name"
  );

  const quotaBytes = ctx.org.storage_quota_mb * 1024 * 1024;

  return (
    <>
      <PageHeader
        title={`Hola, ${ctx.profile.full_name.split(" ")[0]}`}
        description={ctx.settings.business_name}
        actions={
          <>
            {can(ctx, "tutors.write") && !ctx.readOnly && (
              <Button asChild variant="outline">
                <Link href="/dashboard/tutores?nuevo=1">
                  <Plus /> Nuevo tutor
                </Link>
              </Button>
            )}
            {can(ctx, "patients.read") && (
              <Button asChild>
                <Link href="/dashboard/pacientes">
                  <PawPrint /> Ver pacientes
                </Link>
              </Button>
            )}
          </>
        }
      />

      {sin_acceso && (
        <Notice tone="warning" className="mb-6">
          No tienes acceso a esa sección, o el módulo no está activo para tu consultorio.
        </Notice>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tutorsCount && <Stat label="Tutores" value={tutorsCount.count ?? 0} />}
        {patientsCount && <Stat label="Pacientes activos" value={patientsCount.count ?? 0} />}
        {reminders && <Stat label="Recordatorios por enviar" value={pending.length >= 6 ? "6+" : pending.length} />}
        {used !== null && (
          <Stat
            label="Espacio usado"
            value={formatBytes(used)}
            hint={`de ${formatBytes(quotaBytes)} (${Math.min(100, Math.round((used / Math.max(quotaBytes, 1)) * 100))}%)`}
          />
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {hasModule(ctx, "agenda") && can(ctx, "agenda.read") && <TodayAppointments ctx={ctx} />}

        {reminders && (
          <Section
            title="Recordatorios pendientes"
            actions={
              <Button asChild variant="ghost" size="sm">
                <Link href="/dashboard/pendientes">Ver todos</Link>
              </Button>
            }
          >
            {pending.length === 0 ? (
              <EmptyState>No hay recordatorios por enviar.</EmptyState>
            ) : (
              <ul className="divide-y divide-brand-border">
                {pending.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-brand-ink">{patients.get(r.patient_id)?.name ?? "Paciente"}</p>
                      <p className="truncate text-brand-muted">
                        {REMINDER_KIND_LABEL[r.kind]} · {r.title}
                      </p>
                    </div>
                    <Badge variant={r.due_date < ctx.today ? "danger" : "warning"}>{formatDate(r.due_date)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}

        {consultations && (
          <Section title="Últimas consultas">
            {recent.length === 0 ? (
              <EmptyState>Todavía no hay consultas.</EmptyState>
            ) : (
              <ul className="divide-y divide-brand-border">
                {recent.map((c) => (
                  <li key={c.id}>
                    <Link href={`/dashboard/consultas/${c.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:bg-black/[0.02]">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-brand-ink">{patients.get(c.patient_id)?.name ?? "Paciente"}</p>
                        <p className="truncate text-brand-muted">
                          {c.kind === "control" ? "Control" : "Consulta"} · {c.reason ?? "Sin motivo"} · {formatDate(c.consulted_at, ctx.tz)}
                        </p>
                      </div>
                      <Badge variant={STATUS_BADGE[c.status].variant}>{STATUS_BADGE[c.status].label}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}
      </div>

      {!canTutors && !canPatients && !canReminders && (
        <EmptyState>
          <Users className="mx-auto mb-2 h-6 w-6" />
          Tu usuario todavía no tiene permisos asignados. Pídele al administrador que te los active.
        </EmptyState>
      )}
    </>
  );
}
