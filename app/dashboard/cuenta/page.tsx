import { PasswordForm } from "@/components/password-form";
import { DefinitionList, PageHeader, Section } from "@/components/ui/misc";
import { requireOrgContext } from "@/lib/auth";
import { formatDateTime } from "@/lib/logic/dates";

export const metadata = { title: "Mi cuenta" };

export default async function AccountPage() {
  const ctx = await requireOrgContext();

  return (
    <>
      <PageHeader title="Mi cuenta" />
      <div className="flex flex-col gap-6">
        <Section title="Mis datos">
          <DefinitionList
            items={[
              { label: "Nombre", value: ctx.profile.full_name },
              { label: "Usuario", value: ctx.profile.username },
              { label: "Rol", value: ctx.profile.role === "owner" ? "Administrador" : "Auxiliar" },
              { label: "Último ingreso", value: ctx.profile.last_login_at ? formatDateTime(ctx.profile.last_login_at, ctx.tz) : "—" },
            ]}
          />
        </Section>
        <Section title="Cambiar mi contraseña">
          <PasswordForm />
        </Section>
      </div>
    </>
  );
}
