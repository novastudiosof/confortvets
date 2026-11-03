import * as React from "react";

import { PRODUCT_NAME, PRODUCT_SLOGAN } from "@/lib/brand";
import type { OrgSettings } from "@/lib/types";

/** Hoja imprimible con el membrete del veterinario (logo, datos y tarjeta profesional). */
export function PrintSheet({
  settings,
  title,
  subtitle,
  children,
}: {
  settings: OrgSettings;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const contact = [settings.address, settings.city, settings.phone ? `Tel. ${settings.phone}` : null, settings.email]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className="print-sheet mx-auto max-w-3xl rounded-[var(--radius-brand-md)] border border-brand-border bg-white p-4 shadow-sm sm:p-8">
      <header className="flex items-start gap-4 border-b-2 border-brand pb-4">
        {settings.logo_file_id && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/files/${settings.logo_file_id}`} alt="" className="h-16 w-16 shrink-0 object-contain" />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold text-brand-ink">{settings.business_name}</h2>
          {settings.professional_name && (
            <p className="text-sm text-brand-ink">
              {settings.professional_name}
              {settings.professional_card ? ` · T.P. ${settings.professional_card}` : ""}
            </p>
          )}
          {contact && <p className="text-xs text-brand-muted">{contact}</p>}
          {settings.letterhead_text && <p className="mt-1 text-xs text-brand-muted">{settings.letterhead_text}</p>}
        </div>
      </header>

      <div className="my-5 text-center">
        <h1 className="text-lg font-bold uppercase tracking-wide text-brand-ink">{title}</h1>
        {subtitle && <p className="text-sm text-brand-muted">{subtitle}</p>}
      </div>

      <div className="text-sm text-brand-ink">{children}</div>

      <footer className="mt-10 border-t border-brand-border pt-3 text-center text-[10px] text-brand-muted">
        Generado con {PRODUCT_NAME} · {PRODUCT_SLOGAN}
      </footer>
    </article>
  );
}

/** Línea de firma del profesional. */
export function ProfessionalSignature({ settings, name }: { settings: OrgSettings; name?: string }) {
  return (
    <div className="mt-14 w-64 border-t border-brand-ink pt-1 text-xs">
      <p className="font-medium">{name ?? settings.professional_name ?? settings.business_name}</p>
      {settings.professional_card && <p>T.P. {settings.professional_card}</p>}
    </div>
  );
}
