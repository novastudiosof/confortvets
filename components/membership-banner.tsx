import { MessageCircle } from "lucide-react";

import { RENEW_MEMBERSHIP_MESSAGE, developerWhatsAppLink } from "@/lib/brand";
import { formatDate } from "@/lib/logic/dates";
import type { MembershipStatus } from "@/lib/logic/membership";
import { cn } from "@/lib/utils";

/** Aviso de membresía por vencer o vencida (modo solo lectura). */
export function MembershipBanner({
  status,
  validUntil,
  canRenew,
}: {
  status: MembershipStatus;
  validUntil: string | null;
  canRenew: boolean;
}) {
  if (status.state === "active") return null;
  const expired = status.state === "expired";

  return (
    <div
      role={expired ? "alert" : "status"}
      className={cn(
        "no-print mb-6 flex flex-col gap-3 rounded-[var(--radius-brand-md)] border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between",
        expired ? "border-brand-danger/40 bg-brand-danger/10" : "border-brand-warning/40 bg-brand-warning/10"
      )}
    >
      <p className="text-brand-ink">
        {expired ? (
          <>
            <strong>Tu membresía ha vencido.</strong> Puedes consultar, imprimir y exportar tu información, pero no
            registrar cambios. Actualiza tu membresía para seguir trabajando.
          </>
        ) : (
          <>
            <strong>
              Tu membresía vence {status.daysLeft === 0 ? "hoy" : `en ${status.daysLeft} día${status.daysLeft === 1 ? "" : "s"}`}
            </strong>{" "}
            ({formatDate(validUntil)}). Renuévala para no perder la posibilidad de registrar información.
          </>
        )}
      </p>
      {canRenew && (
        <a
          href={developerWhatsAppLink(RENEW_MEMBERSHIP_MESSAGE)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-[var(--radius-brand-sm)] bg-brand-whatsapp px-4 text-sm font-medium text-white hover:opacity-90"
        >
          <MessageCircle className="h-4 w-4" />
          Actualizar membresía
        </a>
      )}
    </div>
  );
}
