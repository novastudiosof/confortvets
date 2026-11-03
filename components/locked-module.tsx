"use client";

import * as React from "react";
import { Lock, MessageCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export interface LockedModule {
  key: string;
  name: string;
  description: string;
  /** false = todavía en desarrollo. */
  available: boolean;
  /** Enlace de WhatsApp a NovaStudio con el consultorio y el módulo. */
  whatsappUrl: string;
}

/**
 * Módulo que el consultorio todavía no tiene: aparece en el menú con un
 * candado. Al pasar el mouse o dar clic ofrece pedir información por WhatsApp.
 */
export function LockedModuleItem({ module, onNavigate }: { module: LockedModule; onNavigate?: () => void }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          title={`${module.name}: módulo bloqueado. Haz clic para más información.`}
          className="group flex w-full items-start gap-3 rounded-[var(--radius-brand-sm)] px-3 py-2.5 text-left text-sm text-white/45 transition-colors hover:bg-white/5 hover:text-white/90 focus-visible:bg-white/5 focus-visible:text-white/90"
        >
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0">
            <span className="block truncate">{module.name}</span>
            <span className="hidden text-xs font-medium text-brand-soft group-hover:block group-focus-visible:block">
              ¿Quieres adquirir este módulo?
            </span>
          </span>
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-brand-muted" /> ¿Quieres adquirir este módulo?
          </DialogTitle>
          <DialogDescription>
            <strong className="text-brand-ink">{module.name}</strong>
            {module.description ? ` · ${module.description.replace(/\s*Próximamente\.?$/, "")}` : ""}
          </DialogDescription>
        </DialogHeader>
        <p className="rounded-[var(--radius-brand-sm)] bg-brand-soft px-3 py-2 text-sm text-brand-ink">
          Este módulo todavía no está activo en tu consultorio. Si quieres adquirirlo, te escribimos por WhatsApp con la información.
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button asChild variant="whatsapp">
            <a href={module.whatsappUrl} target="_blank" rel="noopener noreferrer" onClick={onNavigate}>
              <MessageCircle /> Sí, quiero adquirirlo
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
