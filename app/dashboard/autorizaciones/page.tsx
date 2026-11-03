import Link from "next/link";

import { PAGE_SIZE, Pagination, pageFrom } from "@/components/pagination";
import { Badge } from "@/components/ui/badge";
import { DataTable, EmptyState, PageHeader, tdClass, thClass } from "@/components/ui/misc";
import { requireAccess } from "@/lib/auth";
import { formatDateTime } from "@/lib/logic/dates";
import { rowsById } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import type { Consent } from "@/lib/types";

export const metadata = { title: "Autorizaciones" };

const STATUS = {
  pendiente: { label: "Pendiente", variant: "warning" },
  firmada: { label: "Firmada", variant: "success" },
  rechazada: { label: "No autorizó", variant: "danger" },
  anulada: { label: "Anulada", variant: "muted" },
} as const;

export default async function ConsentsPage({ searchParams }: { searchParams: Promise<{ estado?: string; page?: string }> }) {
  const ctx = await requireAccess("consents.read");
  const sp = await searchParams;
  const page = pageFrom(sp.page);
  const estado = sp.estado === "todas" ? "todas" : "pendiente";
  const supabase = await createClient();

  let query = supabase
    .from("consents")
    .select("id, kind, status, title, patient_id, tutor_id, created_at, signed_at, signer_name", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (estado === "pendiente") query = query.eq("status", "pendiente");
  const { data, count } = await query;
  const rows = (data ?? []) as Pick<Consent, "id" | "status" | "title" | "patient_id" | "tutor_id" | "created_at" | "signed_at" | "signer_name">[];

  const [patients, tutors] = await Promise.all([
    rowsById<{ id: string; name: string }>("patients", rows.map((r) => r.patient_id ?? ""), "id, name"),
    rowsById<{ id: string; full_name: string }>("tutors", rows.map((r) => r.tutor_id), "id, full_name"),
  ]);

  return (
    <>
      <PageHeader
        title="Autorizaciones"
        description="Para crear una nueva, entra a la ficha del paciente (o del tutor, para la autorización de datos)."
        actions={
          <div className="flex gap-2 text-sm">
            <Link href="/dashboard/autorizaciones" className={`rounded-full px-3 py-1 ${estado === "pendiente" ? "bg-brand text-brand-on" : "border border-brand-border"}`}>
              Pendientes
            </Link>
            <Link href="/dashboard/autorizaciones?estado=todas" className={`rounded-full px-3 py-1 ${estado === "todas" ? "bg-brand text-brand-on" : "border border-brand-border"}`}>
              Todas
            </Link>
          </div>
        }
      />

      {rows.length === 0 ? (
        <EmptyState>{estado === "pendiente" ? "No hay autorizaciones pendientes de firma." : "Todavía no hay autorizaciones."}</EmptyState>
      ) : (
        <DataTable>
          <thead>
            <tr>
              <th className={thClass}>Fecha</th>
              <th className={thClass}>Autorización</th>
              <th className={thClass}>Paciente</th>
              <th className={thClass}>Tutor</th>
              <th className={thClass}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="hover:bg-black/[0.02]">
                <td className={tdClass}>{formatDateTime(c.signed_at ?? c.created_at, ctx.tz)}</td>
                <td className={tdClass}>
                  <Link href={`/dashboard/autorizaciones/${c.id}`} className="font-medium text-brand-dark hover:underline">
                    {c.title}
                  </Link>
                </td>
                <td className={tdClass}>{c.patient_id ? (patients.get(c.patient_id)?.name ?? "—") : "—"}</td>
                <td className={tdClass}>{tutors.get(c.tutor_id)?.full_name ?? "—"}</td>
                <td className={tdClass}>
                  <Badge variant={STATUS[c.status].variant}>{STATUS[c.status].label}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}

      <Pagination basePath="/dashboard/autorizaciones" page={page} total={count ?? 0} params={{ estado: estado === "todas" ? "todas" : undefined }} />
    </>
  );
}
