"use client";

import * as React from "react";
import { Paperclip } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Selector de archivo con un botón grande y visible (el campo nativo de
 * archivo pasa desapercibido). Muestra el nombre del archivo elegido.
 */
export function FilePicker({
  name = "file",
  accept,
  required,
  label = "Elegir archivo",
  hint,
}: {
  name?: string;
  accept: string;
  required?: boolean;
  label?: string;
  hint?: string;
}) {
  const [fileName, setFileName] = React.useState("");

  return (
    <div className="flex flex-col gap-2">
      <label
        className={cn(
          "flex min-h-14 cursor-pointer flex-col items-center justify-center gap-1 rounded-[var(--radius-brand-md)] border-2 border-dashed px-4 py-3 text-center transition-colors",
          fileName ? "border-brand-success bg-brand-success/5" : "border-brand bg-brand/5 hover:bg-brand/10"
        )}
      >
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-brand-dark">
          <Paperclip className="h-4 w-4" />
          {fileName ? "Cambiar archivo" : label}
        </span>
        <span className="max-w-full truncate text-xs text-brand-muted">{fileName || "Toca aquí para buscar en tu equipo"}</span>
        <input
          type="file"
          name={name}
          accept={accept}
          required={required}
          className="sr-only"
          onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
        />
      </label>
      {hint && <p className="text-xs text-brand-muted">{hint}</p>}
    </div>
  );
}
