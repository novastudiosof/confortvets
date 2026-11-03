import Image from "next/image";

import { BrandFooter } from "@/components/brand-footer";
import { LoginForm } from "@/components/login-form";
import { PRODUCT_NAME, PRODUCT_SLOGAN } from "@/lib/brand";

export const metadata = { title: "Ingresar" };

/**
 * Pantalla de inicio de sesión: solo marca de ConfortVets (todavía no se sabe
 * quién entra). Al ingresar, el sistema ya muestra la marca del veterinario.
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ inactiva?: string }> }) {
  const { inactiva } = await searchParams;

  return (
    <main className="flex min-h-screen flex-col bg-brand-navy">
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <Image
            src="/brand/confortvets.png"
            alt={`${PRODUCT_NAME} — ${PRODUCT_SLOGAN}`}
            width={640}
            height={640}
            priority
            className="mx-auto h-auto w-64"
          />
          <LoginForm inactive={Boolean(inactiva)} />
        </div>
      </div>
      <BrandFooter dark />
    </main>
  );
}
