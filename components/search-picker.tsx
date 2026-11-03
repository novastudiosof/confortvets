"use client";

import * as React from "react";
import { Search } from "lucide-react";

import { fieldControlClass } from "@/components/ui/fields";

export interface PickerItem {
  id: string;
  label: string;
  /** Texto secundario (por ejemplo, la existencia). */
  hint?: string;
}

/**
 * Buscador con lista desplegable. Al elegir un elemento llama a `onPick` y se
 * limpia, para poder agregar varios seguidos (líneas de una compra o venta).
 */
export function SearchPicker({
  items,
  onPick,
  placeholder = "Buscar...",
  id,
}: {
  items: PickerItem[];
  onPick: (item: PickerItem) => void;
  placeholder?: string;
  id?: string;
}) {
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);

  const matches = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? items.filter((i) => i.label.toLowerCase().includes(q)) : items;
    return list.slice(0, 8);
  }, [items, query]);

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-brand-muted" />
      <input
        id={id}
        type="search"
        autoComplete="off"
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className={`${fieldControlClass} h-10 pl-9`}
      />
      {open && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-[var(--radius-brand-sm)] border border-brand-border bg-white shadow-lg">
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-sm text-brand-muted">Sin coincidencias.</li>
          ) : (
            matches.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-black/5"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onPick(item);
                    setQuery("");
                    setOpen(false);
                  }}
                >
                  <span className="truncate">{item.label}</span>
                  {item.hint && <span className="shrink-0 text-xs text-brand-muted">{item.hint}</span>}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
