import Image from "next/image";
import { redirect } from "next/navigation";

import { BrandFooter } from "@/components/brand-footer";
import { PasswordForm } from "@/components/password-form";
import { requireContext } from "@/lib/auth";

export const metadata = { title: "Cambiar contraseña" };

export default async function ForcePasswordPage() {
  const ctx = await requireContext();
  if (!ctx.profile.must_change_password) {
    redirect(ctx.profile.role === "super_admin" ? "/superadmin" : "/dashboard");
  }

  return (
    <main className="flex min-h-screen flex-col bg-brand-navy">
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-10">
        <Image src="/brand/confortvets.png" alt="ConfortVets" width={640} height={640} className="h-auto w-48" priority />
        <div className="w-full max-w-md rounded-[var(--radius-brand-lg)] bg-white p-6 shadow-lg">
          <h1 className="text-lg font-semibold text-brand-ink">Crea tu contraseña</h1>
          <p className="mb-4 mt-1 text-sm text-brand-muted">
            Por seguridad, cambia la contraseña temporal que recibiste antes de continuar.
          </p>
          <PasswordForm forced />
        </div>
      </div>
      <BrandFooter dark />
    </main>
  );
}
