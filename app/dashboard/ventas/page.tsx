import Link from "next/link";
import { Plus, Receipt } from "lucide-react";

import { PAGE_SIZE, Pagination, pageFrom } from "@/components/pagination";
import { SearchForm } from "@/components/search-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, EmptyState, Notice, PageHeader, Stat, tdClass, thClass } from "@/components/ui/misc";
import { can, requireOrgContext } from "@/lib/auth";
import { redirect } from "next/navigation";
import { dayRange } from "@/lib/logic/agenda";
import { formatDateTime } from "@/lib/logic/dates";
import { SALE_STATUS, formatMoney } from "@/lib/logic/inventory";
import { safeSearch } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Ventas" };

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ q?: string; estado?: string; page?: string }> }) {
  const ctx = await requireOrgContext();
  if (!can(ctx, "sales.read") && !can(ctx, "sales.write")) redirect("/dashboard?sin_acceso=1");
  const sp = await searchParams;
  const q = safeSearch(sp.q);
  const page = pageFrom(sp.page);
  const estado = ["pendiente", "pagada", "anulada"].includes(sp.estado ?? "") ? sp.estado! : "todas";
  const supabase = await createClient();
  const currency = ctx.settings.currency;

  let query = supabase
    .from("sales")
    .select("id, full_number, sold_at, customer_name, total, paid_total, balance, status", { count: "exact" })
    .order("sold_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (estado !== "todas") query = query.eq("status", estado);
  if (q) query = query.or(`customer_name.ilike.%${q}%,full_number.ilike.%${q}%`);

  const today = dayRange(ctx.today, ctx.tz);
  const [{ data: rows, count }, { data: pending }, { data: todaySales }] = await Promise.all([
    query,
    supabase.from("sales").select("balance").eq("status", "pendiente").limit(2000),
    supabase
      .from("sales")
      .select("total")
      .neq("status", "anulada")
      .gte("sold_at", today.from.toISOString())
      .lt("sold_at", today.to.toISOString())
      .limit(2000),
  ]);
  const receivable = (pending ?? []).reduce((s, r) => s + Number(r.balance), 0);
  const soldToday = (todaySales ?? []).reduce((s, r) => s + Number(r.total), 0);

  const filters = [
    { key: "todas", label: "Todas" },
    { key: "pendiente", label: "Por cobrar" },
    { key: "pagada", label: "Pagadas" },
    { key: "anulada", label: "Anuladas" },
  ];

  return (
    <>
      <PageHeader
        title="Ventas"
        description="Documentos internos de venta. No son factura electrónica."
        actions={
          can(ctx, "sales.write") &&
          !ctx.readOnly && (
            <Button asChild>
              <Link href="/dashboard/ventas/nueva">
                <Plus /> Nueva venta
              </Link>
            </Button>
          )
        }
      />
      {ctx.readOnly && (
        <Notice tone="warning" className="mb-4">
          Tu membresía venció: puedes consultar las ventas pero no registrar otras.
        </Notice>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Vendido hoy" value={formatMoney(soldToday, currency)} />
        <Stat label="Por cobrar" value={formatMoney(receivable, currency)} hint={`${(pending ?? []).length} ventas con saldo`} />
        <Stat label="Ventas encontradas" value={count ?? 0} />
      </div>

      <div className="mb-3 flex flex-wrap gap-2 text-sm">
        {filters.map((f) => (
          <Link
            key={f.key}
            href={`/dashboard/ventas?estado=${f.key}`}
            className={`rounded-full px-3 py-1 ${estado === f.key ? "bg-brand text-brand-on" : "border border-brand-border text-brand-ink hover:bg-black/5"}`}
          >
            {f.label}
          </Link>
        ))}
      </div>
      <SearchForm defaultValue={q} placeholder="Buscar por cliente o número" hidden={{ estado }} />

      {(rows ?? []).length === 0 ? (
        <EmptyState>
          <Receipt className="mx-auto mb-2 h-5 w-5" />
          No hay ventas con ese filtro.
        </EmptyState>
      ) : (
        <DataTable>
          <thead>
            <tr>
              <th className={thClass}>Número</th>
              <th className={thClass}>Fecha</th>
              <th className={thClass}>Cliente</th>
              <th className={thClass}>Total</th>
              <th className={thClass}>Saldo</th>
              <th className={thClass}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((s) => {
              const st = SALE_STATUS[s.status as keyof typeof SALE_STATUS];
              return (
                <tr key={s.id as string} className="hover:bg-black/[0.02]">
                  <td className={tdClass}>
                    <Link href={`/dashboard/ventas/${s.id}`} className="font-medium text-brand-dark hover:underline">
                      {s.full_number as string}
                    </Link>
                  </td>
                  <td className={tdClass}>{formatDateTime(s.sold_at as string, ctx.tz)}</td>
                  <td className={tdClass}>{(s.customer_name as string | null) ?? "Mostrador"}</td>
                  <td className={tdClass}>{formatMoney(s.total as number, currency)}</td>
                  <td className={tdClass}>{Number(s.balance) > 0 ? formatMoney(s.balance as number, currency) : "—"}</td>
                  <td className={tdClass}>
                    <Badge variant={st.variant}>{st.label}</Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      )}
      <Pagination basePath="/dashboard/ventas" page={page} total={count ?? 0} params={{ estado, q: q || undefined }} />
    </>
  );
}
