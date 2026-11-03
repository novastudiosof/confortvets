import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, Section } from "@/components/ui/misc";
import type { Context } from "@/lib/auth";
import { APPOINTMENT_STATUS, dayRange, formatTime12, localParts, type AppointmentStatus } from "@/lib/logic/agenda";
import { rowsById } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";

/** Citas de hoy para el inicio del consultorio. */
export async function TodayAppointments({ ctx }: { ctx: Pick<Context, "today" | "tz"> }) {
  const supabase = await createClient();
  const range = dayRange(ctx.today, ctx.tz);
  const { data } = await supabase
    .from("appointments")
    .select("id, patient_id, type_id, starts_at, status, reason")
    .gte("starts_at", range.from.toISOString())
    .lt("starts_at", range.to.toISOString())
    .neq("status", "cancelada")
    .order("starts_at")
    .limit(12);
  const rows = (data ?? []) as {
    id: string;
    patient_id: string;
    type_id: string | null;
    starts_at: string;
    status: AppointmentStatus;
    reason: string | null;
  }[];

  const [patients, types] = await Promise.all([
    rowsById<{ id: string; name: string }>("patients", rows.map((r) => r.patient_id), "id, name"),
    rowsById<{ id: string; name: string }>("appointment_types", rows.map((r) => r.type_id ?? ""), "id, name"),
  ]);

  return (
    <Section
      title="Citas de hoy"
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard/agenda">Abrir agenda</Link>
        </Button>
      }
    >
      {rows.length === 0 ? (
        <EmptyState>No hay citas para hoy.</EmptyState>
      ) : (
        <ul className="divide-y divide-brand-border">
          {rows.map((a) => {
            const st = APPOINTMENT_STATUS[a.status];
            return (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-brand-ink">
                    {formatTime12(localParts(a.starts_at, ctx.tz).time)} · {patients.get(a.patient_id)?.name ?? "Paciente"}
                  </p>
                  <p className="truncate text-brand-muted">
                    {(a.type_id && types.get(a.type_id)?.name) || "Cita"}
                    {a.reason ? ` · ${a.reason}` : ""}
                  </p>
                </div>
                <Badge variant={st.variant}>{st.label}</Badge>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
