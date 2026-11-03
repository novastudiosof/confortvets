import Link from "next/link";
import { Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, EmptyState, PageHeader, tdClass, thClass } from "@/components/ui/misc";
import { requireSuperAdmin } from "@/lib/auth";
import { formatDate } from "@/lib/logic/dates";
import { membershipStatus } from "@/lib/logic/membership";
import { formatBytes } from "@/lib/logic/storage";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Organizaciones" };

export default async function SuperAdminHome() {
  const ctx = await requireSuperAdmin();
  const supabase = await createClient();

  const [{ data: orgs }, { data: usage }] = await Promise.all([
    supabase.from("organizations").select("id, name, slug, is_active, valid_until, max_auxiliares, storage_quota_mb").order("name"),
    supabase.rpc("org_usage"),
  ]);
  const usageByOrg = new Map(
    ((usage ?? []) as { organization_id: string; storage_bytes: number; users_count: number; tutors_count: number; patients_count: number }[]).map((u) => [u.organization_id, u])
  );

  return (
    <>
      <PageHeader
        title="Organizaciones"
        description="Cada consultorio es una organización. Aquí activas sus módulos, límites y membresía. No ves información clínica ni de sus tutores."
        actions={
          <Button asChild>
            <Link href="/superadmin/organizaciones/nueva">
              <Plus /> Nueva organización
            </Link>
          </Button>
        }
      />

      {(orgs ?? []).length === 0 ? (
        <EmptyState>Todavía no hay organizaciones. Crea la primera.</EmptyState>
      ) : (
        <DataTable>
          <thead>
            <tr>
              <th className={thClass}>Consultorio</th>
              <th className={thClass}>Estado</th>
              <th className={thClass}>Membresía</th>
              <th className={thClass}>Usuarios</th>
              <th className={thClass}>Tutores</th>
              <th className={thClass}>Pacientes</th>
              <th className={thClass}>Espacio</th>
            </tr>
          </thead>
          <tbody>
            {(orgs ?? []).map((o) => {
              const u = usageByOrg.get(o.id as string);
              const m = membershipStatus(o.valid_until as string | null, ctx.today);
              const quota = (o.storage_quota_mb as number) * 1024 * 1024;
              const used = Number(u?.storage_bytes ?? 0);
              return (
                <tr key={o.id as string} className="hover:bg-black/[0.02]">
                  <td className={tdClass}>
                    <Link href={`/superadmin/organizaciones/${o.id}`} className="font-medium text-brand-dark hover:underline">
                      {o.name as string}
                    </Link>
                    <p className="text-xs text-brand-muted">{o.slug as string}</p>
                  </td>
                  <td className={tdClass}>
                    <Badge variant={o.is_active ? "success" : "danger"}>{o.is_active ? "Activa" : "Desactivada"}</Badge>
                  </td>
                  <td className={tdClass}>
                    {o.valid_until ? (
                      <Badge variant={m.state === "expired" ? "danger" : m.state === "expiring" ? "warning" : "success"}>
                        {m.state === "expired" ? "Vencida" : "Hasta"} {formatDate(o.valid_until as string)}
                      </Badge>
                    ) : (
                      <Badge variant="muted">Sin vencimiento</Badge>
                    )}
                  </td>
                  <td className={tdClass}>{Number(u?.users_count ?? 0)}</td>
                  <td className={tdClass}>{Number(u?.tutors_count ?? 0)}</td>
                  <td className={tdClass}>{Number(u?.patients_count ?? 0)}</td>
                  <td className={tdClass}>
                    {formatBytes(used)} / {formatBytes(quota)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      )}
    </>
  );
}
