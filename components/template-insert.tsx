"use client";

import * as React from "react";

import { fieldControlClass } from "@/components/ui/fields";
import { cn } from "@/lib/utils";

interface TemplateItem {
  id: string;
  title: string;
  body: string;
}

/** Inserta una plantilla de texto al final de un campo de la historia. */
export function TemplateInsert({ target, templates }: { target: string; templates: TemplateItem[] }) {
  if (templates.length === 0) return null;
  return (
    <select
      aria-label="Insertar plantilla"
      defaultValue=""
      className={cn(fieldControlClass, "h-8 max-w-56 py-0 text-xs")}
      onChange={(event) => {
        const template = templates.find((t) => t.id === event.target.value);
        event.target.value = "";
        if (!template) return;
        const el = document.querySelector<HTMLTextAreaElement>(`textarea[name="${target}"]`);
        if (!el) return;
        el.value = el.value.trim() ? `${el.value.trimEnd()}\n${template.body}` : template.body;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.focus();
      }}
    >
      <option value="">Insertar plantilla…</option>
      {templates.map((t) => (
        <option key={t.id} value={t.id}>
          {t.title}
        </option>
      ))}
    </select>
  );
}
