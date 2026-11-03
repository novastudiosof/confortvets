import Link from "next/link";
import { Plus } from "lucide-react";

import { DialogForm } from "@/components/dialog-form";
import { PAGE_SIZE, Pagination, pageFrom } from "@/components/pagination";
import { SearchForm } from "@/components/search-form";
import { TutorFields } from "@/components/tutor-fields";
import { Badge } from "@/components/ui/badge";
import { DataTable, EmptyState, PageHeader, tdClass, thClass } from "@/components/ui/misc";
import { createTutor } from "@/lib/actions/tutors";
import { can, requireAccess } from "@/lib/auth";
import { loadCustomFieldDefs } from "@/lib/custom-fields-server";
import { safeSearch } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Tutores" };

export default async function TutorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; nuevo?: string }>;
}) {
  const ctx = await requireAccess("tutors.read");
  const sp = await searchParams;
  const q = safeSearch(sp.q);
  const page = pageFrom(sp.page);
  const supabase = await createClient();

  let query = supabase
    .from("tutors")
    .select("id, full_name, document_number, phone, whatsapp, is_active, data_consent", { count: "exact" })
    .order("full_name")
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (q) query = query.or(`full_name.ilike.%${q}%,document_number.ilike.%${q}%,phone.ilike.%${q}%,whatsapp.ilike.%${q}%`);
  const { data: tutors, count } = await query;

  const ids = (tutors ?? []).map((t) => t.id as string);
  const patientCounts = new Map<string, number>();
  if (ids.length && can(ctx, "patients.read")) {
    const { data: patients } = await supabase.from("patients").select("tutor_id").in("tutor_id", ids);
    for (const p of patients ?? []) patientCounts.set(p.tutor_id as string, (patientCounts.get(p.tutor_id as string) ?? 0) + 1);
  }

  const canWrite = can(ctx, "tutors.write") && !ctx.readOnly;
  const customDefs = canWrite ? await loadCustomFieldDefs("tutor") : [];

  return (
    <>
      <PageHeader
        title="Tutores"
        description="Los dueños de tus pacientes."
        actions={
          canWrite && (
            <DialogForm
              trigger={
                <>
                  <Plus /> Nuevo tutor
                </>
              }
              title="Nuevo tutor"
              action={createTutor}
              submitLabel="Crear tutor"
              wide
              defaultOpen={sp.nuevo === "1"}
            >
              <TutorFields customDefs={customDefs} />
            </DialogForm>
          )
        }
      />

      <SearchForm defaultValue={q} placeholder="Buscar por nombre, cédula o teléfono" />

      {(tutors ?? []).length === 0 ? (
        <EmptyState>{q ? "No hay tutores que coincidan con la búsqueda." : "Todavía no hay tutores. Crea el primero."}</EmptyState>
      ) : (
        <DataTable>
          <thead>
            <tr>
              <th className={thClass}>Nombre</th>
              <th className={thClass}>Cédula</th>
              <th className={thClass}>Teléfono</th>
              <th className={thClass}>Pacientes</th>
              <th className={thClass}>Datos</th>
            </tr>
          </thead>
          <tbody>
            {(tutors ?? []).map((t) => (
              <tr key={t.id as string} className="hover:bg-black/[0.02]">
                <td className={tdClass}>
                  <Link href={`/dashboard/tutores/${t.id}`} className="font-medium text-brand-dark hover:underline">
                    {t.full_name as string}
                  </Link>
                  {!t.is_active && <Badge variant="muted" className="ml-2">Inactivo</Badge>}
                </td>
                <td className={tdClass}>{(t.document_number as string | null) ?? "—"}</td>
                <td className={tdClass}>{(t.phone as string | null) ?? (t.whatsapp as string | null) ?? "—"}</td>
                <td className={tdClass}>{patientCounts.get(t.id as string) ?? 0}</td>
                <td className={tdClass}>
                  {t.data_consent ? <Badge variant="success">Autorizó</Badge> : <Badge variant="warning">Sin autorización</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}

      <Pagination basePath="/dashboard/tutores" page={page} total={count ?? 0} params={{ q: q || undefined }} />
    </>
  );
}
