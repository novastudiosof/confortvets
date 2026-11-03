import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, KeyRound } from "lucide-react";

import { ActionForm } from "@/components/action-form";
import { DialogForm } from "@/components/dialog-form";
import { Badge } from "@/components/ui/badge";
import { CheckboxField, TextField } from "@/components/ui/fields";
import { DataTable, DefinitionList, PageHeader, Section, tdClass, thClass } from "@/components/ui/misc";
import {
  extendMembership,
  resetOwnerPassword,
  setPermissionAllowed,
  setUserActive,
  toggleModule,
  updateOrganization,
} from "@/lib/actions/superadmin";
import { requireSuperAdmin } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/logic/dates";
import { membershipStatus } from "@/lib/logic/membership";
import { generateTempPassword } from "@/lib/logic/password";
import { MODULE_LABELS, PERMISSIONS } from "@/lib/logic/permissions";
import { formatBytes } from "@/lib/logic/storage";
import { createClient } from "@/lib/supabase/server";

export default async function OrganizationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireSuperAdmin();
  const { id } = await params;
  const supabase = await createClient();

  const { data: org } = await supabase.from("organizations").select("*").eq("id", id).maybeSingle();
  if (!org) notFound();

  const [{ data: modules }, { data: orgModules }, { data: restrictions }, { data: profiles }, { data: activity }, { data: usage }] = await Promise.all([
    supabase.from("modules").select("key, name, description, is_core, available").order("sort_order"),
    supabase.from("organization_modules").select("module_key, enabled").eq("organization_id", id),
    supabase.from("organization_permissions").select("permission_key").eq("organization_id", id).eq("enabled", false),
    supabase.from("profiles").select("id, username, full_name, role, is_active, last_login_at, must_change_password").eq("organization_id", id).order("role").order("full_name"),
    supabase.from("activity_log").select("id, user_name, action, detail, created_at").eq("organization_id", id).order("created_at", { ascending: false }).limit(25),
    supabase.rpc("org_usage"),
  ]);

  const enabled = new Set((orgModules ?? []).filter((m) => m.enabled).map((m) => m.module_key as string));
  const restricted = new Set((restrictions ?? []).map((r) => r.permission_key as string));
  const u = ((usage ?? []) as { organization_id: string; storage_bytes: number; tutors_count: number; patients_count: number }[]).find((x) => x.organization_id === id);
  const m = membershipStatus(org.valid_until as string | null, ctx.today);
  const quota = (org.storage_quota_mb as number) * 1024 * 1024;

  const permissionGroups = new Map<string, typeof PERMISSIONS>();
  for (const p of PERMISSIONS) {
    if (!permissionGroups.has(p.module)) permissionGroups.set(p.module, []);
    permissionGroups.get(p.module)!.push(p);
  }

  return (
    <>
      <PageHeader
        back={
          <Link href="/superadmin" className="mb-2 inline-flex items-center gap-1 text-sm text-brand-muted hover:text-brand-ink">
            <ArrowLeft className="h-4 w-4" /> Organizaciones
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            {org.name as string}
            <Badge variant={org.is_active ? "success" : "danger"}>{org.is_active ? "Activa" : "Desactivada"}</Badge>
            {m.state === "expired" && <Badge variant="danger">Membresía vencida</Badge>}
            {m.state === "expiring" && <Badge variant="warning">Vence pronto</Badge>}
          </span>
        }
        description={`Identificador: ${org.slug as string}`}
      />

      <div className="flex flex-col gap-6">
        <Section title="Uso">
          <DefinitionList
            items={[
              { label: "Espacio usado", value: `${formatBytes(Number(u?.storage_bytes ?? 0))} de ${formatBytes(quota)}` },
              { label: "Tutores", value: Number(u?.tutors_count ?? 0) },
              { label: "Pacientes", value: Number(u?.patients_count ?? 0) },
              { label: "Membresía hasta", value: org.valid_until ? formatDate(org.valid_until as string) : "Sin vencimiento" },
            ]}
          />
        </Section>

        <Section title="Datos, límites y membresía">
          <ActionForm action={updateOrganization.bind(null, id)} submitLabel="Guardar cambios">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Nombre del consultorio" name="name" defaultValue={org.name as string} required className="sm:col-span-2" />
              <TextField label="Vence el" name="valid_until" type="date" defaultValue={(org.valid_until as string | null) ?? ""} hint="Vacío = sin vencimiento. Vencida: solo lectura con aviso de renovación." />
              <TextField label="Auxiliares incluidos" name="max_auxiliares" inputMode="numeric" defaultValue={String(org.max_auxiliares)} required />
              <TextField label="Espacio (MB)" name="storage_quota_mb" inputMode="numeric" defaultValue={String(org.storage_quota_mb)} required />
              <CheckboxField
                label="Organización activa"
                name="is_active"
                defaultChecked={Boolean(org.is_active)}
                hint="Si la desactivas, nadie de este consultorio podrá ingresar."
                className="self-end"
              />
            </div>
          </ActionForm>
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-brand-border pt-4">
            <span className="text-sm text-brand-muted">Extender membresía:</span>
            {[1, 3, 6, 12].map((months) => (
              <ActionForm
                key={months}
                action={extendMembership.bind(null, id, months)}
                submitLabel={`+${months} ${months === 1 ? "mes" : "meses"}`}
                submitVariant="outline"
                submitSize="sm"
                className="!gap-0"
              />
            ))}
          </div>
        </Section>

        <Section title="Módulos">
          <ul className="divide-y divide-brand-border">
            {(modules ?? []).map((mod) => {
              const key = mod.key as string;
              const on = Boolean(mod.is_core) || enabled.has(key);
              return (
                <li key={key} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-brand-ink">{mod.name as string}</p>
                    <p className="text-xs text-brand-muted">{mod.description as string}</p>
                  </div>
                  {mod.is_core ? (
                    <Badge variant="muted">Siempre activo</Badge>
                  ) : !mod.available ? (
                    <Badge variant="muted">No disponible aún</Badge>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Badge variant={on ? "success" : "muted"}>{on ? "Activo" : "Apagado"}</Badge>
                      <ActionForm
                        action={toggleModule.bind(null, id, key, !on)}
                        submitLabel={on ? "Desactivar" : "Activar"}
                        submitVariant="outline"
                        submitSize="sm"
                        className="!gap-0"
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Section>

        <Section title="Permisos disponibles para esta organización">
          <p className="mb-4 text-sm text-brand-muted">
            Por defecto todos están permitidos. Si restringes uno, nadie de este consultorio (ni su administrador) podrá usarlo.
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            {[...permissionGroups.entries()].map(([moduleKey, perms]) => (
              <div key={moduleKey} className="rounded-[var(--radius-brand-sm)] border border-brand-border p-3">
                <p className="mb-2 text-sm font-semibold text-brand-ink">{MODULE_LABELS[moduleKey] ?? moduleKey}</p>
                <ul className="flex flex-col gap-1.5">
                  {perms.map((p) => {
                    const allowed = !restricted.has(p.key);
                    return (
                      <li key={p.key} className="flex items-center justify-between gap-2 text-sm">
                        <span className={allowed ? "text-brand-ink" : "text-brand-muted line-through"}>{p.label}</span>
                        <ActionForm
                          action={setPermissionAllowed.bind(null, id, p.key, !allowed)}
                          submitLabel={allowed ? "Restringir" : "Permitir"}
                          submitVariant="ghost"
                          submitSize="sm"
                          className="!gap-0"
                        />
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </Section>

        <Section
          title="Usuarios"
          actions={
            <DialogForm
              trigger={
                <>
                  <KeyRound /> Contraseña del administrador
                </>
              }
              triggerVariant="outline"
              triggerSize="sm"
              title="Nueva contraseña para el administrador"
              description="Se cambia sin pedir la anterior. El veterinario deberá crear una propia al ingresar."
              action={resetOwnerPassword.bind(null, id)}
              submitLabel="Cambiar contraseña"
            >
              <TextField label="Contraseña temporal" name="password" defaultValue={generateTempPassword()} required hint="Anótala y entrégasela al veterinario." />
            </DialogForm>
          }
        >
          <DataTable>
            <thead>
              <tr>
                <th className={thClass}>Nombre</th>
                <th className={thClass}>Usuario</th>
                <th className={thClass}>Rol</th>
                <th className={thClass}>Último ingreso</th>
                <th className={thClass}>Estado</th>
                <th className={thClass} />
              </tr>
            </thead>
            <tbody>
              {(profiles ?? []).map((p) => (
                <tr key={p.id as string}>
                  <td className={tdClass}>{p.full_name as string}</td>
                  <td className={tdClass}>{p.username as string}</td>
                  <td className={tdClass}>{p.role === "owner" ? "Administrador" : "Auxiliar"}</td>
                  <td className={tdClass}>{p.last_login_at ? formatDateTime(p.last_login_at as string) : "—"}</td>
                  <td className={tdClass}>
                    <Badge variant={p.is_active ? "success" : "muted"}>{p.is_active ? "Activo" : "Desactivado"}</Badge>
                  </td>
                  <td className={`${tdClass} text-right`}>
                    <ActionForm
                      action={setUserActive.bind(null, id, p.id as string, !p.is_active)}
                      submitLabel={p.is_active ? "Desactivar" : "Activar"}
                      submitVariant="ghost"
                      submitSize="sm"
                      className="!gap-0"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Section>

        <Section title="Actividad reciente">
          {(activity ?? []).length === 0 ? (
            <p className="text-sm text-brand-muted">Sin actividad registrada.</p>
          ) : (
            <DataTable>
              <thead>
                <tr>
                  <th className={thClass}>Fecha</th>
                  <th className={thClass}>Usuario</th>
                  <th className={thClass}>Acción</th>
                </tr>
              </thead>
              <tbody>
                {(activity ?? []).map((a) => (
                  <tr key={a.id as number}>
                    <td className={`${tdClass} whitespace-nowrap`}>{formatDateTime(a.created_at as string)}</td>
                    <td className={tdClass}>{(a.user_name as string | null) ?? "—"}</td>
                    <td className={tdClass}>
                      {a.action as string}
                      {a.detail ? <span className="text-brand-muted"> · {a.detail as string}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </Section>
      </div>
    </>
  );
}
