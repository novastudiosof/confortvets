import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Notice, PageHeader, Section } from "@/components/ui/misc";
import { requireAccess } from "@/lib/auth";

export const metadata = { title: "Exportar datos" };

export default async function ExportPage() {
  const ctx = await requireAccess("data.export");

  return (
    <>
      <PageHeader title="Exportar datos" description="Descarga una copia de la información de tu consultorio." />

      {ctx.readOnly && (
        <Notice tone="info" className="mb-4">
          Aunque tu membresía venció, siempre puedes descargar tu información.
        </Notice>
      )}

      <Section title="Copia de tus datos">
        <p className="mb-4 text-sm text-brand-muted">
          Incluye tutores, pacientes, pesos, consultas, notas aclaratorias, fórmulas, vacunas, desparasitaciones,
          recordatorios y autorizaciones (según los permisos de tu usuario). Las fotos y los PDF de exámenes no van en la
          descarga: se conservan en tu cuenta.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <a href="/api/export?format=xlsx">
              <Download /> Descargar en Excel
            </a>
          </Button>
          <Button asChild variant="outline">
            <a href="/api/export?format=json">
              <Download /> Descargar en JSON
            </a>
          </Button>
        </div>
        <p className="mt-4 text-xs text-brand-muted">
          Guarda la descarga en un lugar seguro: contiene datos personales de tus tutores.
        </p>
      </Section>
    </>
  );
}
