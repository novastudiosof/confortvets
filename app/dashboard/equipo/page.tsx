import { KeyRound, Plus, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";

import { ActionForm } from "@/components/action-form";
import { DialogForm } from "@/components/dialog-form";
import { PermissionCheckboxes } from "@/components/permission-checkboxes";
import { Badge } from "@/components/ui/badge";
import { TextField } from "@/components/ui/fields";
import { DataTable, EmptyState, Notice, PageHeader, Section, tdClass, thClass } from "@/components/ui/misc";
import { createAuxiliar, resetAuxiliarPassword, setAuxiliarActive, updateAuxiliarPermissions } from "@/lib/actions/team";
import { requireOrgContext } from "@/lib/auth";
import { formatDateTime } from "@/lib/logic/dates";
import { PASSWORD_MIN_LENGTH, generateTempPassword } from "@/lib/logic/password";
import { permissionsByModule } from "@/lib/logic/permissions";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Equipo" };

export default async function TeamPage() {
  const ctx = await requireOrgContext();
  if (ctx.profile.role !== "owner") redirect("/dashboard?sin_acceso=1");
  const supabase = await createClient();

  const [{ data: members }, { data: grants }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, username, full_name, role, is_active, last_login_at, must_change_password")
      .eq("organization_id", ctx.org.id)
      .order("role")
      .order("full_name"),
    supabase.from("auxiliary_permissions").select("profile_id, permission_key").eq("organization_id", ctx.org.id),
  ]);

  const grantsByUser = new Map<string, string[]>();
  for (const g of grants ?? []) {
    const list = grantsByUser.get(g.profile_id as string) ?? [];
    list.push(g.permission_key as string);
    grantsByUser.set(g.profile_id as string, list);
  }

  const groups = permissionsByModule(ctx.enabledModules, ctx.restricted);
  const auxiliaries = (members ?? []).filter((m) => m.role === "auxiliar");
  const owner = (members ?? []).find((m) => m.role === "owner");
  const limitReached = auxiliaries.length >= ctx.org.max_auxiliares;
  const canWrite = !ctx.readOnly;

  return (
    <>
      <PageHeader
        title="Equipo"
        description={`Auxiliares: ${auxiliaries.length} de ${ctx.org.max_auxiliares} incluidos en tu plan.`}
        actions={
          canWrite && (
            <DialogForm
              trigger={
                <>
                  <Plus /> Nuevo auxiliar
                </>
              }
              title="Nuevo auxiliar"
              description="El auxiliar solo podrá hacer lo que le actives. Al ingresar por primera vez deberá crear su propia contraseña."
              action={createAuxiliar}
              submitLabel="Crear auxiliar"
              wide
              disabled={limitReached}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label="Nombre completo" name="full_name" required />
                <TextField label="Usuario" name="username" required autoCapitalize="none" hint="Minúsculas, números, punto o guion." />
                <TextField
                  label="Contraseña temporal"
                  name="password"
                  defaultValue={generateTempPassword()}
                  required
                  hint={`Mínimo ${PASSWORD_MIN_LENGTH} caracteres. Anótala y entrégasela al auxiliar.`}
                />
              </div>
              <PermissionCheckboxes groups={groups} />
            </DialogForm>
          )
        }
      />

      {limitReached && (
        <Notice tone="warning" className="mb-4">
          Alcanzaste el límite de auxiliares de tu plan. Contacta a tu proveedor para ampliarlo.
        </Notice>
      )}

      {owner && (
        <Section title="Administrador" className="mb-6">
          <p className="flex items-center gap-2 text-sm text-brand-ink">
            <ShieldCheck className="h-4 w-4 text-brand-success" />
            {owner.full_name as string} · usuario <strong>{owner.username as string}</strong>. Tiene acceso a todo. Cambia tu
            contraseña en «Mi cuenta».
          </p>
        </Section>
      )}

      <Section title="Auxiliares">
        {auxiliaries.length === 0 ? (
          <EmptyState>Todavía no tienes auxiliares.</EmptyState>
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th className={thClass}>Nombre</th>
                <th className={thClass}>Usuario</th>
                <th className={thClass}>Permisos</th>
                <th className={thClass}>Último ingreso</th>
                <th className={thClass}>Estado</th>
                <th className={thClass} />
              </tr>
            </thead>
            <tbody>
              {auxiliaries.map((a) => {
                const id = a.id as string;
                const selected = grantsByUser.get(id) ?? [];
                return (
                  <tr key={id} className={a.is_active ? "" : "text-brand-muted"}>
                    <td className={tdClass}>{a.full_name as string}</td>
                    <td className={tdClass}>{a.username as string}</td>
                    <td className={tdClass}>{selected.length}</td>
                    <td className={tdClass}>{a.last_login_at ? formatDateTime(a.last_login_at as string, ctx.tz) : a.must_change_password ? "Aún no ingresa" : "—"}</td>
                    <td className={tdClass}>
                      <Badge variant={a.is_active ? "success" : "muted"}>{a.is_active ? "Activo" : "Desactivado"}</Badge>
                    </td>
                    <td className={`${tdClass} text-right`}>
                      {canWrite && (
                        <div className="flex flex-wrap justify-end gap-1">
                          <DialogForm
                            trigger="Permisos"
                            triggerVariant="outline"
                            triggerSize="sm"
                            title={`Permisos de ${a.full_name}`}
                            action={updateAuxiliarPermissions.bind(null, id)}
                            wide
                          >
                            <PermissionCheckboxes groups={groups} selected={selected} />
                          </DialogForm>
                          <DialogForm
                            trigger={
                              <>
                                <KeyRound /> Contraseña
                              </>
                            }
                            triggerVariant="outline"
                            triggerSize="sm"
                            title={`Nueva contraseña para ${a.full_name}`}
                            description="No necesitas la contraseña anterior. El auxiliar tendrá que crear una propia al ingresar."
                            action={resetAuxiliarPassword.bind(null, id)}
                            submitLabel="Cambiar contraseña"
                          >
                            <TextField label="Contraseña temporal" name="password" defaultValue={generateTempPassword()} required hint="Anótala y entrégasela al auxiliar." />
                          </DialogForm>
                          <ActionForm
                            action={setAuxiliarActive.bind(null, id, !a.is_active)}
                            submitLabel={a.is_active ? "Desactivar" : "Activar"}
                            submitVariant="ghost"
                            submitSize="sm"
                            className="!gap-0"
                          />
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        )}
      </Section>
    </>
  );
}
