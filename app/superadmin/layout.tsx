import { redirect } from "next/navigation";

import { BrandFooter } from "@/components/brand-footer";
import { Sidebar, type NavItem } from "@/components/sidebar";
import { requireSuperAdmin } from "@/lib/auth";

export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireSuperAdmin();
  if (ctx.profile.must_change_password) redirect("/cambiar-clave");

  const items: NavItem[] = [
    { href: "/superadmin", label: "Organizaciones", icon: "organizaciones" },
    { href: "/superadmin/cuenta", label: "Mi cuenta", icon: "cuenta" },
  ];

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar businessName="ConfortVets" subtitle="Super administrador" logoUrl={null} items={items} userName={ctx.profile.full_name} superAdmin />
      <main className="flex min-w-0 flex-1 flex-col px-4 py-6 pt-20 md:px-8 md:py-8 md:pt-8">
        <div className="mx-auto w-full max-w-6xl flex-1">{children}</div>
        <BrandFooter />
      </main>
    </div>
  );
}
