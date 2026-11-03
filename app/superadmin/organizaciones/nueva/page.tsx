import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { ActionForm } from "@/components/action-form";
import { CheckboxField, TextField } from "@/components/ui/fields";
import { PageHeader, Section } from "@/components/ui/misc";
import { createOrganization } from "@/lib/actions/superadmin";
import { requireSuperAdmin } from "@/lib/auth";
import { PASSWORD_MIN_LENGTH, generateTempPassword } from "@/lib/logic/password";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Nueva organización" };

export default async function NewOrganizationPage() {
  await requireSuperAdmin();
  const supabase = await createClient();
  const { data: modules } = await supabase.from("modules").select("key, name, description, is_core, available").order("sort_order");

  return (
    <>
      <PageHeader
        back={
          <Link href="/superadmin" className="mb-2 inline-flex items-center gap-1 text-sm text-brand-muted hover:text-brand-ink">
            <ArrowLeft className="h-4 w-4" /> Organizaciones
          </Link>
        }
        title="Nueva organización"
        description="Se crea el consultorio con su usuario administrador y todos sus catálogos listos para editar."
      />

      <ActionForm action={createOrganization} submitLabel="Crear organización" className="gap-6">
        <Section title="Consultorio">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Nombre del consultorio" name="name" required className="sm:col-span-2" />
            <TextField label="Nombre del veterinario" name="owner_full_name" required />
            <TextField label="Usuario del administrador" name="owner_username" required autoCapitalize="none" hint="Minúsculas, números, punto o guion. Es único en todo el sistema." />
            <TextField
              label="Contraseña temporal"
              name="owner_password"
              defaultValue={generateTempPassword()}
              required
              hint={`Mínimo ${PASSWORD_MIN_LENGTH} caracteres. Entrégasela al veterinario: la cambiará al ingresar.`}
            />
          </div>
        </Section>

        <Section title="Membresía y límites">
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField label="Vence el" name="valid_until" type="date" hint="Déjalo vacío si no vence." />
            <TextField label="Auxiliares incluidos" name="max_auxiliares" inputMode="numeric" defaultValue="2" required />
            <TextField label="Espacio (MB)" name="storage_quota_mb" inputMode="numeric" defaultValue="100" required />
          </div>
        </Section>

        <Section title="Módulos">
          <div className="flex flex-col gap-3">
            {(modules ?? []).map((m) => (
              <CheckboxField
                key={m.key as string}
                label={m.name as string}
                name="modules"
                value={m.key as string}
                defaultChecked={Boolean(m.is_core)}
                disabled={Boolean(m.is_core) || !m.available}
                hint={m.is_core ? "Siempre activo." : (m.description as string)}
              />
            ))}
          </div>
        </Section>
      </ActionForm>
    </>
  );
}
