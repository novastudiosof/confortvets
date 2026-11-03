import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { CatalogSection } from "@/components/catalog-section";
import { DialogForm } from "@/components/dialog-form";
import { CheckboxField, TextAreaField, TextField } from "@/components/ui/fields";
import { Notice, PageHeader, Section } from "@/components/ui/misc";
import { removeLogo, saveReminderSettings, updateBranding, updateDataPolicy, uploadLogo } from "@/lib/actions/settings";
import { hasModule, requireAccess } from "@/lib/auth";
import { CATALOGS, CATALOG_ORDER } from "@/lib/catalogs";
import { TEMPLATE_VARIABLES } from "@/lib/logic/templates";
import { createClient } from "@/lib/supabase/server";

import { AgendaTab } from "./agenda-tab";

export const metadata = { title: "Configuración" };

const TABS = [
  { key: "marca", label: "Marca y datos" },
  { key: "catalogos", label: "Catálogos" },
  { key: "recordatorios", label: "Recordatorios" },
  { key: "agenda", label: "Agenda" },
  { key: "autorizaciones", label: "Textos de autorizaciones" },
  { key: "campos", label: "Campos personalizados" },
  { key: "datos", label: "Política de datos" },
] as const;

const GENERIC_CATALOGS = CATALOG_ORDER.filter((k) => k !== "consent_templates" && k !== "custom_field_defs");

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string; cat?: string }> }) {
  const ctx = await requireAccess("settings.write");
  const sp = await searchParams;
  const tabs = TABS.filter((t) => t.key !== "agenda" || hasModule(ctx, "agenda"));
  const tab = tabs.some((t) => t.key === sp.tab) ? (sp.tab as (typeof TABS)[number]["key"]) : "marca";
  const catKey = GENERIC_CATALOGS.includes(sp.cat ?? "") ? (sp.cat as string) : GENERIC_CATALOGS[0];
  const canEdit = !ctx.readOnly;
  const s = ctx.settings;

  return (
    <>
      <PageHeader title="Configuración" description="Todo se guarda en tu cuenta y lo puedes cambiar cuando quieras." />

      {ctx.readOnly && (
        <Notice tone="warning" className="mb-4">
          Tu membresía venció: puedes consultar la configuración pero no cambiarla.
        </Notice>
      )}

      <nav className="mb-6 flex flex-wrap gap-1 border-b border-brand-border" aria-label="Secciones de configuración">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/dashboard/configuracion?tab=${t.key}`}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              tab === t.key ? "border-brand text-brand-dark" : "border-transparent text-brand-muted hover:text-brand-ink"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "marca" && (
        <div className="flex flex-col gap-6">
          <Section title="Logo">
            <div className="flex flex-wrap items-center gap-4">
              {s.logo_file_id ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/files/${s.logo_file_id}`} alt="Logo actual" className="h-20 w-20 rounded-lg border border-brand-border object-contain" />
              ) : (
                <p className="text-sm text-brand-muted">Todavía no has subido un logo.</p>
              )}
              {canEdit && (
                <div className="flex flex-wrap gap-2">
                  <DialogForm
                    trigger={s.logo_file_id ? "Cambiar logo" : "Subir logo"}
                    triggerVariant="outline"
                    title="Logo del consultorio"
                    description="Se muestra en el menú y en tus documentos. Se reduce automáticamente a 512 px."
                    action={uploadLogo}
                    encType="multipart/form-data"
                  >
                    <input type="file" name="file" accept="image/png,image/jpeg,image/webp" required className="text-sm" />
                  </DialogForm>
                  {s.logo_file_id && (
                    <ActionForm action={removeLogo} submitLabel="Quitar logo" submitVariant="ghost" className="!gap-0" />
                  )}
                </div>
              )}
            </div>
          </Section>

          <Section title="Datos del consultorio">
            {canEdit ? (
              <ActionForm action={updateBranding} submitLabel="Guardar datos">
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField label="Nombre comercial" name="business_name" defaultValue={s.business_name} required />
                  <TextField label="Nombre del profesional" name="professional_name" defaultValue={s.professional_name ?? ""} />
                  <TextField label="Tarjeta profesional" name="professional_card" defaultValue={s.professional_card ?? ""} />
                  <TextField label="Teléfono" name="phone" type="tel" defaultValue={s.phone ?? ""} />
                  <TextField label="WhatsApp del consultorio" name="whatsapp" type="tel" defaultValue={s.whatsapp ?? ""} />
                  <TextField label="Correo" name="email" type="email" defaultValue={s.email ?? ""} />
                  <TextField label="Dirección" name="address" defaultValue={s.address ?? ""} />
                  <TextField label="Ciudad" name="city" defaultValue={s.city ?? ""} />
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="primary_color" className="text-sm font-medium text-brand-ink">
                      Color principal
                    </label>
                    <input id="primary_color" name="primary_color" type="color" defaultValue={s.primary_color} className="h-10 w-24 cursor-pointer rounded border border-brand-border bg-white p-1" />
                    <p className="text-xs text-brand-muted">Cambia el color de botones y del menú.</p>
                  </div>
                </div>
                <TextAreaField
                  label="Texto del membrete"
                  name="letterhead_text"
                  defaultValue={s.letterhead_text ?? ""}
                  rows={2}
                  hint="Aparece bajo tus datos en fórmulas, carnés y certificados (por ejemplo, horarios o servicios)."
                />
              </ActionForm>
            ) : (
              <p className="text-sm text-brand-muted">{s.business_name}</p>
            )}
          </Section>
        </div>
      )}

      {tab === "catalogos" && <CatalogsTab catKey={catKey} canEdit={canEdit} />}

      {tab === "recordatorios" && <RemindersTab canEdit={canEdit} />}

      {tab === "agenda" && <AgendaTab canEdit={canEdit} tz={ctx.tz} />}

      {tab === "autorizaciones" && <SingleCatalog catKey="consent_templates" canEdit={canEdit} />}

      {tab === "campos" && <SingleCatalog catKey="custom_field_defs" canEdit={canEdit} />}

      {tab === "datos" && (
        <Section title="Política de tratamiento de datos">
          <p className="mb-4 text-sm text-brand-muted">
            Es el texto que explica a tus tutores cómo usas sus datos personales. La plantilla es un ejemplo: debe ser
            revisada y ajustada por un abogado antes de usarse. Variables: {"{clinica}"} y {"{telefono_clinica}"}.
          </p>
          {canEdit ? (
            <ActionForm action={updateDataPolicy} submitLabel="Guardar política">
              <TextAreaField label="Texto de la política" name="data_policy_text" defaultValue={s.data_policy_text ?? ""} rows={12} />
            </ActionForm>
          ) : (
            <p className="whitespace-pre-wrap text-sm text-brand-ink">{s.data_policy_text}</p>
          )}
        </Section>
      )}
    </>
  );
}

async function loadRefs() {
  const supabase = await createClient();
  const { data } = await supabase.from("species").select("id, name").order("sort_order").order("name");
  return { species: (data ?? []).map((s) => ({ value: s.id as string, label: s.name as string })) };
}

async function CatalogsTab({ catKey, canEdit }: { catKey: string; canEdit: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <nav className="flex flex-wrap gap-2" aria-label="Catálogos">
        {GENERIC_CATALOGS.map((k) => (
          <Link
            key={k}
            href={`/dashboard/configuracion?tab=catalogos&cat=${k}`}
            className={`rounded-full px-3 py-1 text-sm ${catKey === k ? "bg-brand text-brand-on" : "border border-brand-border bg-white text-brand-ink hover:bg-black/5"}`}
          >
            {CATALOGS[k].title}
          </Link>
        ))}
      </nav>
      <SingleCatalog catKey={catKey} canEdit={canEdit} />
    </div>
  );
}

async function SingleCatalog({ catKey, canEdit }: { catKey: string; canEdit: boolean }) {
  const def = CATALOGS[catKey];
  const supabase = await createClient();
  const [{ data }, refs] = await Promise.all([
    supabase.from(def.table).select("*").order(def.orderBy).order("id"),
    loadRefs(),
  ]);
  return <CatalogSection def={def} rows={(data ?? []) as never[]} refs={refs} canEdit={canEdit} />;
}

async function RemindersTab({ canEdit }: { canEdit: boolean }) {
  const supabase = await createClient();
  const [{ data: rules }, { data: messages }] = await Promise.all([
    supabase.from("reminder_rules").select("kind, days_before, enabled"),
    supabase.from("message_templates").select("kind, body"),
  ]);
  const rule = new Map((rules ?? []).map((r) => [r.kind as string, r]));
  const message = new Map((messages ?? []).map((m) => [m.kind as string, m.body as string]));

  const kinds = [
    { key: "vacuna", label: "Vacunas" },
    { key: "desparasitante", label: "Desparasitación" },
    { key: "control", label: "Controles" },
  ];

  return (
    <Section title="Reglas y mensajes de recordatorio">
      <p className="mb-4 text-sm text-brand-muted">
        Un recordatorio aparece en «Recordatorios» los días de anticipación que indiques antes de la fecha. El mensaje se
        envía por WhatsApp con un clic. Variables: {TEMPLATE_VARIABLES.filter((v) => ["tutor", "paciente", "clinica", "fecha", "motivo"].includes(v)).map((v) => `{${v}}`).join(" ")}
      </p>
      <ActionForm action={saveReminderSettings} submitLabel="Guardar recordatorios">
        {kinds.map((k) => (
          <fieldset key={k.key} disabled={!canEdit} className="flex flex-col gap-3 rounded-[var(--radius-brand-sm)] border border-brand-border p-4">
            <legend className="px-1 text-sm font-semibold text-brand-ink">{k.label}</legend>
            <div className="flex flex-wrap items-end gap-4">
              <CheckboxField label="Activo" name={`enabled_${k.key}`} defaultChecked={(rule.get(k.key)?.enabled as boolean | undefined) ?? true} />
              <TextField
                label="Días de anticipación"
                name={`days_${k.key}`}
                inputMode="numeric"
                defaultValue={String((rule.get(k.key)?.days_before as number | undefined) ?? 7)}
                className="w-40"
              />
            </div>
            <TextAreaField label="Mensaje" name={`body_${k.key}`} defaultValue={message.get(k.key) ?? ""} rows={3} />
          </fieldset>
        ))}
      </ActionForm>
    </Section>
  );
}
