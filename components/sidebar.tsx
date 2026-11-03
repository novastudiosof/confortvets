"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  CalendarDays,
  ClipboardList,
  Download,
  FileSignature,
  HeartPulse,
  Home,
  LogOut,
  Menu,
  Package,
  PawPrint,
  Receipt,
  Settings,
  ShieldCheck,
  User,
  UserCog,
  Users,
  Wallet,
  X,
  Building2,
} from "lucide-react";

import { LockedModuleItem, type LockedModule } from "@/components/locked-module";
import { cn } from "@/lib/utils";

export type NavIcon =
  | "inicio"
  | "agenda"
  | "inventario"
  | "ventas"
  | "caja"
  | "pendientes"
  | "tutores"
  | "pacientes"
  | "autorizaciones"
  | "equipo"
  | "configuracion"
  | "bitacora"
  | "exportar"
  | "cuenta"
  | "organizaciones";

const ICONS = {
  inicio: Home,
  agenda: CalendarDays,
  inventario: Package,
  ventas: Receipt,
  caja: Wallet,
  pendientes: Bell,
  tutores: Users,
  pacientes: PawPrint,
  autorizaciones: FileSignature,
  equipo: UserCog,
  configuracion: Settings,
  bitacora: ClipboardList,
  exportar: Download,
  cuenta: User,
  organizaciones: Building2,
};

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  badge?: number;
}

interface SidebarProps {
  businessName: string;
  subtitle: string;
  logoUrl: string | null;
  items: NavItem[];
  /** Módulos que el consultorio aún no tiene (se muestran con candado). */
  lockedModules?: LockedModule[];
  userName: string;
  superAdmin?: boolean;
}

function BrandMark({ businessName, logoUrl, superAdmin }: Pick<SidebarProps, "businessName" | "logoUrl" | "superAdmin">) {
  if (logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logoUrl} alt={businessName} className="h-10 w-10 shrink-0 rounded-lg bg-white object-contain" />;
  }
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-on">
      {superAdmin ? <ShieldCheck className="h-5 w-5" /> : <HeartPulse className="h-5 w-5" />}
    </span>
  );
}

export function Sidebar({ businessName, subtitle, logoUrl, items, lockedModules = [], userName, superAdmin }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  const content = (
    <div className="flex h-full flex-col bg-brand-navy text-white">
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-4">
        <BrandMark businessName={businessName} logoUrl={logoUrl} superAdmin={superAdmin} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">{businessName}</p>
          <p className="truncate text-xs text-white/60">{subtitle}</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active =
            item.href === "/dashboard" || item.href === "/superadmin"
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={cn(
                "flex items-center gap-3 rounded-[var(--radius-brand-sm)] px-3 py-2.5 text-sm transition-colors",
                active ? "bg-brand text-brand-on font-medium" : "text-white/80 hover:bg-white/10 hover:text-white"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{item.label}</span>
              {item.badge ? (
                <span className="ml-auto rounded-full bg-brand-danger px-2 py-0.5 text-xs font-semibold text-white">
                  {item.badge}
                </span>
              ) : null}
            </Link>
          );
        })}

        {lockedModules.length > 0 && (
          <div className="pt-4">
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-white/40">Más módulos</p>
            {lockedModules.map((m) => (
              <LockedModuleItem key={m.key} module={m} />
            ))}
          </div>
        )}
      </nav>

      <div className="shrink-0 border-t border-white/10 px-4 py-3">
        <p className="truncate text-sm font-medium">{userName}</p>
        <button
          onClick={handleLogout}
          className="mt-1 flex items-center gap-2 text-sm text-white/70 hover:text-white"
        >
          <LogOut className="h-4 w-4" />
          Cerrar sesión
        </button>
        <Image
          src="/brand/confortvets.png"
          alt="ConfortVets — Más tiempo para cuidar"
          width={640}
          height={640}
          className="mx-auto mt-2 h-auto w-20 opacity-90"
        />
      </div>
    </div>
  );

  return (
    <>
      <div className="no-print fixed inset-x-0 top-0 z-40 flex items-center justify-between bg-brand-navy px-4 py-3 text-white md:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <BrandMark businessName={businessName} logoUrl={logoUrl} superAdmin={superAdmin} />
          <span className="truncate text-sm font-semibold">{businessName}</span>
        </div>
        <button onClick={() => setOpen(true)} aria-label="Abrir menú">
          <Menu className="h-6 w-6" />
        </button>
      </div>

      <aside className="no-print hidden w-64 shrink-0 md:block">
        <div className="fixed inset-y-0 w-64">{content}</div>
      </aside>

      {open && (
        <div className="no-print fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72">
            <button onClick={() => setOpen(false)} className="absolute right-3 top-3 z-10 text-white" aria-label="Cerrar menú">
              <X className="h-5 w-5" />
            </button>
            {content}
          </div>
        </div>
      )}
    </>
  );
}
