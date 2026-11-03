import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { fieldControlClass } from "@/components/ui/fields";
import { cn } from "@/lib/utils";

/** Búsqueda por GET: funciona sin JavaScript y deja la búsqueda en la URL. */
export function SearchForm({
  defaultValue,
  placeholder,
  hidden = {},
}: {
  defaultValue?: string;
  placeholder: string;
  hidden?: Record<string, string>;
}) {
  return (
    <form method="get" className="no-print mb-4 flex gap-2">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <input
        name="q"
        defaultValue={defaultValue}
        placeholder={placeholder}
        className={cn(fieldControlClass, "h-10 max-w-md")}
        aria-label={placeholder}
      />
      <Button type="submit" variant="outline">
        <Search /> Buscar
      </Button>
    </form>
  );
}
