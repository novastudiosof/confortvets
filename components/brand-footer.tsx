import {
  DEVELOPER_CONTACT_MESSAGE,
  DEVELOPER_NAME,
  PRODUCT_NAME,
  PRODUCT_SLOGAN,
  developerWhatsAppLink,
} from "@/lib/brand";
import { cn } from "@/lib/utils";

export function BrandFooter({ className, dark = false }: { className?: string; dark?: boolean }) {
  return (
    <footer
      className={cn(
        "no-print py-4 text-center text-xs",
        dark ? "text-white/60" : "text-brand-muted",
        className
      )}
    >
      <p>
        {PRODUCT_NAME} · {PRODUCT_SLOGAN}
      </p>
      <p className="mt-0.5">
        Desarrollado por{" "}
        <a
          href={developerWhatsAppLink(DEVELOPER_CONTACT_MESSAGE)}
          target="_blank"
          rel="noopener noreferrer"
          className={cn("font-medium hover:underline", dark ? "text-white" : "text-brand-ink")}
        >
          {DEVELOPER_NAME}
        </a>
      </p>
    </footer>
  );
}
