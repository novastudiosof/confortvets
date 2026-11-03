import { PasswordForm } from "@/components/password-form";
import { DefinitionList, PageHeader, Section } from "@/components/ui/misc";
import { requireSuperAdmin } from "@/lib/auth";

export const metadata = { title: "Mi cuenta" };

export default async function SuperAdminAccountPage() {
  const ctx = await requireSuperAdmin();
  return (
    <>
      <PageHeader title="Mi cuenta" />
      <div className="flex flex-col gap-6">
        <Section title="Mis datos">
          <DefinitionList
            items={[
              { label: "Nombre", value: ctx.profile.full_name },
              { label: "Usuario", value: ctx.profile.username },
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
