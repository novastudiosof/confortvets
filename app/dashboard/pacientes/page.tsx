import Link from "next/link";

import { PAGE_SIZE, Pagination, pageFrom } from "@/components/pagination";
import { SearchForm } from "@/components/search-form";
import { Badge } from "@/components/ui/badge";
import { DataTable, EmptyState, PageHeader, tdClass, thClass } from "@/components/ui/misc";
import { requireAccess } from "@/lib/auth";
import { calcAge } from "@/lib/logic/dates";
import { loadSpeciesAndBreeds, rowsById, safeSearch } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Pacientes" };

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; estado?: string }>;
}) {
  const ctx = await requireAccess("patients.read");
  const sp = await searchParams;
  const q = safeSearch(sp.q);
  const page = pageFrom(sp.page);
  const estado = sp.estado === "fallecido" ? "fallecido" : "activo";
  const supabase = await createClient();

  let tutorIds: string[] = [];
  if (q && ctx.permissions.has("tutors.read")) {
    const { data } = await supabase
      .from("tutors")
      .select("id")
      .or(`full_name.ilike.%${q}%,document_number.ilike.%${q}%`)
      .limit(100);
    tutorIds = (data ?? []).map((t) => t.id as string);
  }

  let query = supabase
    .from("patients")
    .select("id, name, tutor_id, species_id, breed_id, breed_text, birth_date, sex, status, microchip", { count: "exact" })
    .eq("status", estado)
    .order("name")
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (q) {
    const filters = [`name.ilike.%${q}%`, `microchip.ilike.%${q}%`];
    if (tutorIds.length) filters.push(`tutor_id.in.(${tutorIds.join(",")})`);
    query = query.or(filters.join(","));
  }
  const { data: patients, count } = await query;
  const rows = patients ?? [];

  const [tutors, { species, breeds }] = await Promise.all([
    rowsById<{ id: string; full_name: string }>("tutors", rows.map((p) => p.tutor_id as string), "id, full_name"),
    loadSpeciesAndBreeds(),
  ]);
  const speciesName = new Map(species.map((s) => [s.id, s.name]));
  const breedName = new Map(breeds.map((b) => [b.id, b.name]));

  return (
    <>
      <PageHeader
        title="Pacientes"
        description="Para crear un paciente, entra primero a la ficha de su tutor."
        actions={
          <div className="flex gap-2 text-sm">
            <Link
              href="/dashboard/pacientes"
              className={`rounded-full px-3 py-1 ${estado === "activo" ? "bg-brand text-brand-on" : "border border-brand-border text-brand-ink"}`}
            >
              Activos
            </Link>
            <Link
              href="/dashboard/pacientes?estado=fallecido"
              className={`rounded-full px-3 py-1 ${estado === "fallecido" ? "bg-brand text-brand-on" : "border border-brand-border text-brand-ink"}`}
            >
              Fallecidos
            </Link>
          </div>
        }
      />

      <SearchForm
        defaultValue={q}
        placeholder="Buscar por nombre, microchip o tutor"
        hidden={estado === "fallecido" ? { estado: "fallecido" } : {}}
      />

      {rows.length === 0 ? (
        <EmptyState>{q ? "No hay pacientes que coincidan con la búsqueda." : "Todavía no hay pacientes."}</EmptyState>
      ) : (
        <DataTable>
          <thead>
            <tr>
              <th className={thClass}>Nombre</th>
              <th className={thClass}>Especie y raza</th>
              <th className={thClass}>Edad</th>
              <th className={thClass}>Tutor</th>
              <th className={thClass}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id as string} className="hover:bg-black/[0.02]">
                <td className={tdClass}>
                  <Link href={`/dashboard/pacientes/${p.id}`} className="font-medium text-brand-dark hover:underline">
                    {p.name as string}
                  </Link>
                </td>
                <td className={tdClass}>
                  {speciesName.get(p.species_id as string) ?? "—"}
                  {((p.breed_id && breedName.get(p.breed_id as string)) || p.breed_text) && (
                    <span className="text-brand-muted"> · {(p.breed_id && breedName.get(p.breed_id as string)) || (p.breed_text as string)}</span>
                  )}
                </td>
                <td className={tdClass}>{calcAge(p.birth_date as string | null, ctx.today) ?? "—"}</td>
                <td className={tdClass}>
                  {ctx.permissions.has("tutors.read") ? (
                    <Link href={`/dashboard/tutores/${p.tutor_id}`} className="text-brand-dark hover:underline">
                      {tutors.get(p.tutor_id as string)?.full_name ?? "—"}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className={tdClass}>
                  {p.status === "fallecido" ? <Badge variant="muted">Fallecido</Badge> : <Badge variant="success">Activo</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}

      <Pagination
        basePath="/dashboard/pacientes"
        page={page}
        total={count ?? 0}
        params={{ q: q || undefined, estado: estado === "fallecido" ? "fallecido" : undefined }}
      />
    </>
  );
}
