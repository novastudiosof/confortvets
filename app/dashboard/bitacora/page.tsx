import { redirect } from "next/navigation";

import { PAGE_SIZE, Pagination, pageFrom } from "@/components/pagination";
import { DataTable, EmptyState, PageHeader, tdClass, thClass } from "@/components/ui/misc";
import { requireOrgContext } from "@/lib/auth";
import { formatDateTime } from "@/lib/logic/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Bitácora" };

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const ctx = await requireOrgContext();
  if (ctx.profile.role !== "owner") redirect("/dashboard?sin_acceso=1");
  const page = pageFrom((await searchParams).page);
  const supabase = await createClient();

  const { data, count } = await supabase
    .from("activity_log")
    .select("id, user_name, action, detail, created_at", { count: "exact" })
    .eq("organization_id", ctx.org.id)
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const rows = data ?? [];

  return (
    <>
      <PageHeader title="Bitácora" description="Quién hizo qué y cuándo. Los registros no se pueden editar ni borrar." />
      {rows.length === 0 ? (
        <EmptyState>Todavía no hay actividad registrada.</EmptyState>
      ) : (
        <DataTable>
          <thead>
            <tr>
              <th className={thClass}>Fecha</th>
              <th className={thClass}>Usuario</th>
              <th className={thClass}>Acción</th>
              <th className={thClass}>Detalle</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id as number}>
                <td className={`${tdClass} whitespace-nowrap`}>{formatDateTime(r.created_at as string, ctx.tz)}</td>
                <td className={tdClass}>{(r.user_name as string | null) ?? "—"}</td>
                <td className={tdClass}>{r.action as string}</td>
                <td className={tdClass}>{(r.detail as string | null) ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
      <Pagination basePath="/dashboard/bitacora" page={page} total={count ?? 0} />
    </>
  );
}
