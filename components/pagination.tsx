import Link from "next/link";

import { Button } from "@/components/ui/button";

export const PAGE_SIZE = 30;

/** Paginación por enlaces (conserva el resto de parámetros de la URL). */
export function Pagination({
  basePath,
  page,
  total,
  params = {},
}: {
  basePath: string;
  page: number;
  total: number;
  params?: Record<string, string | undefined>;
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pages <= 1) return null;

  const href = (p: number) => {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) search.set(k, v);
    if (p > 1) search.set("page", String(p));
    const qs = search.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  return (
    <nav className="no-print mt-4 flex items-center justify-between text-sm text-brand-muted" aria-label="Paginación">
      <span>
        Página {page} de {pages} · {total} registros
      </span>
      <div className="flex gap-2">
        {page > 1 && (
          <Button asChild variant="outline" size="sm">
            <Link href={href(page - 1)}>Anterior</Link>
          </Button>
        )}
        {page < pages && (
          <Button asChild variant="outline" size="sm">
            <Link href={href(page + 1)}>Siguiente</Link>
          </Button>
        )}
      </div>
    </nav>
  );
}

export function pageFrom(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}
