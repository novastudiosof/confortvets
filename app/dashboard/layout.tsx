import { redirect } from "next/navigation";

import { BrandFooter } from "@/components/brand-footer";
import { MembershipBanner } from "@/components/membership-banner";
import { Sidebar, type NavItem } from "@/components/sidebar";
import { can, hasModule, requireOrgContext } from "@/lib/auth";
import { dayRange } from "@/lib/logic/agenda";
import { moduleInfoMessage, developerWhatsAppLink } from "@/lib/brand";
import { isHexColor, readableTextColor } from "@/lib/logic/colors";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireOrgContext();
  if (ctx.profile.must_change_password) redirect("/cambiar-clave");

  const supabase = await createClient();

  // Recordatorios que ya toca avisar (insignia del menú)
  let pendingCount = 0;
  if (hasModule(ctx, "preventive") && can(ctx, "preventive.read")) {
    const { count } = await supabase
      .from("reminders")
      .select("id", { count: "exact", head: true })
      .eq("status", "pendiente")
      .lte("remind_from", ctx.today);
    pendingCount = count ?? 0;
  }

  // Citas que quedan por atender hoy (insignia del menú)
  let todayAppointments = 0;
  if (hasModule(ctx, "agenda") && can(ctx, "agenda.read")) {
    const range = dayRange(ctx.today, ctx.tz);
    const { count } = await supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .in("status", ["programada", "confirmada", "en_sala"])
      .gte("starts_at", range.from.toISOString())
      .lt("starts_at", range.to.toISOString());
    todayAppointments = count ?? 0;
  }

  // Productos con poca existencia (insignia del menú)
  let lowStock = 0;
  if (hasModule(ctx, "inventory") && can(ctx, "inventory.read")) {
    const { data: stockRows } = await supabase
      .from("products")
      .select("stock, min_stock")
      .eq("is_active", true)
      .eq("is_service", false)
      .gt("min_stock", 0)
      .limit(3000);
    lowStock = (stockRows ?? []).filter((p) => Number(p.stock) <= Number(p.min_stock)).length;
  }

  const items: NavItem[] = [{ href: "/dashboard", label: "Inicio", icon: "inicio" }];
  if (can(ctx, "agenda.read")) {
    items.push({ href: "/dashboard/agenda", label: "Agenda", icon: "agenda", badge: todayAppointments });
  }
  if (can(ctx, "inventory.read")) {
    items.push({ href: "/dashboard/inventario", label: "Inventario", icon: "inventario", badge: lowStock });
  }
  if (can(ctx, "sales.read") || can(ctx, "sales.write")) {
    items.push({ href: "/dashboard/ventas", label: "Ventas", icon: "ventas" });
  }
  if (can(ctx, "sales.read") || can(ctx, "sales.write") || can(ctx, "cash.manage")) {
    items.push({ href: "/dashboard/caja", label: "Caja", icon: "caja" });
  }
  if (can(ctx, "preventive.read")) {
    items.push({ href: "/dashboard/pendientes", label: "Recordatorios", icon: "pendientes", badge: pendingCount });
  }
  if (can(ctx, "tutors.read")) items.push({ href: "/dashboard/tutores", label: "Tutores", icon: "tutores" });
  if (can(ctx, "patients.read")) items.push({ href: "/dashboard/pacientes", label: "Pacientes", icon: "pacientes" });
  if (can(ctx, "consents.read")) {
    items.push({ href: "/dashboard/autorizaciones", label: "Autorizaciones", icon: "autorizaciones" });
  }
  if (ctx.profile.role === "owner") {
    items.push({ href: "/dashboard/equipo", label: "Equipo", icon: "equipo" });
  }
  if (can(ctx, "settings.write")) {
    items.push({ href: "/dashboard/configuracion", label: "Configuración", icon: "configuracion" });
  }
  if (ctx.profile.role === "owner") {
    items.push({ href: "/dashboard/bitacora", label: "Bitácora", icon: "bitacora" });
  }
  if (can(ctx, "data.export")) items.push({ href: "/dashboard/exportar", label: "Exportar datos", icon: "exportar" });
  items.push({ href: "/dashboard/cuenta", label: "Mi cuenta", icon: "cuenta" });

  // Módulos que todavía no tiene: se muestran con candado y ofrecen pedir información.
  const { data: moduleRows } = await supabase
    .from("modules")
    .select("key, name, description, is_core, available, sort_order")
    .order("sort_order");
  const lockedModules = (moduleRows ?? [])
    .filter((m) => !m.is_core && !ctx.enabledModules.has(m.key as string))
    .map((m) => ({
      key: m.key as string,
      name: m.name as string,
      description: (m.description as string | null) ?? "",
      available: Boolean(m.available),
      whatsappUrl: developerWhatsAppLink(moduleInfoMessage(ctx.settings.business_name, ctx.settings.professional_name, m.name as string)),
    }));

  const primary = isHexColor(ctx.settings.primary_color) ? ctx.settings.primary_color : "#3B82F6";
  const logoUrl = ctx.settings.logo_file_id ? `/api/files/${ctx.settings.logo_file_id}` : null;

  return (
    <div className="flex min-h-screen bg-background">
      {/* La marca del veterinario: global para que también alcance a los diálogos. */}
      <style>{`:root{--color-primary:${primary};--color-on-primary:${readableTextColor(primary)};}`}</style>
      <Sidebar
        businessName={ctx.settings.business_name}
        subtitle={ctx.profile.role === "owner" ? "Administrador" : "Auxiliar"}
        logoUrl={logoUrl}
        items={items}
        lockedModules={lockedModules}
        userName={ctx.profile.full_name}
      />
      <main className="flex min-w-0 flex-1 flex-col px-4 py-6 pt-20 md:px-8 md:py-8 md:pt-8">
        <div className="mx-auto w-full max-w-6xl flex-1">
          <MembershipBanner
            status={ctx.membership}
            validUntil={ctx.org.valid_until}
            canRenew={ctx.profile.role === "owner"}
          />
          {children}
        </div>
        <BrandFooter />
      </main>
    </div>
  );
}
