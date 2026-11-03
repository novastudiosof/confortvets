"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

export function PrintButton({ label = "Imprimir o guardar como PDF" }: { label?: string }) {
  return (
    <Button type="button" onClick={() => window.print()} className="no-print">
      <Printer /> {label}
    </Button>
  );
}
