import { ActionForm } from "@/components/action-form";
import { RemoveButton } from "@/components/agenda-config-actions";
import { CatalogSection } from "@/components/catalog-section";
import { DialogForm } from "@/components/dialog-form";
import { CheckboxField, TextAreaField, TextField } from "@/components/ui/fields";
import { Section } from "@/components/ui/misc";
import { addAgendaBlock, addAgendaHours, saveAgendaSettings } from "@/lib/actions/agenda-settings";
import { CATALOGS } from "@/lib/catalogs";
import { WEEKDAY_LABEL, formatTime12, localParts, trimTime } from "@/lib/logic/agenda";
import { formatDate } from "@/lib/logic/dates";
import { createClient } from "@/lib/supabase/server";

// De lunes a domingo
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Pestaña «Agenda» de Configuración: ajustes, horario, bloqueos y tipos de cita. */
export async function AgendaTab({ canEdit, tz }: { canEdit: boolean; tz: string }) {
  const supabase = await createClient();
  const [{ data: settings }, { data: hours }, { data: blocks }, { data: types }] = await Promise.all([
    supabase.from("agenda_settings").select("slot_minutes, allow_overlap, reminder_template").maybeSingle(),
    supabase.from("agenda_hours").select("id, weekday, starts_at, ends_at").order("starts_at"),
    supabase.from("agenda_blocks").select("id, starts_at, ends_at, reason").gte("ends_at", new Date().toISOString()).order("starts_at"),
    supabase.from("appointment_types").select("*").order("sort_order").order("name"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <Section title="Ajustes de la agenda">
        <ActionForm action={saveAgendaSettings} submitLabel="Guardar ajustes">
          <fieldset disabled={!canEdit} className="flex flex-col gap-4">
            <TextField
              label="Tamaño de cada espacio (minutos)"
              name="slot_minutes"
              type="number"
              min={5}
              max={240}
              step={5}
              defaultValue={String(settings?.slot_minutes ?? 30)}
              className="max-w-xs"
              hint="Los espacios libres de la agenda se muestran de este tamaño."
            />
            <CheckboxField
              label="Permitir varias citas al mismo tiempo"
              name="allow_overlap"
              defaultChecked={Boolean(settings?.allow_overlap)}
              hint="Actívalo si atienden varios profesionales a la vez. Si no, el sistema no deja cruzar citas."
            />
            <TextAreaField
              label="Mensaje de recordatorio de cita (WhatsApp)"
              name="reminder_template"
              defaultValue={(settings?.reminder_template as string | undefined) ?? ""}
              rows={3}
              hint="Variables: {tutor} {paciente} {clinica} {fecha} {hora} {motivo} {profesional} {telefono_clinica}"
            />
          </fieldset>
        </ActionForm>
      </Section>

      <Section
        title="Horario de atención"
        actions={
          canEdit && (
            <DialogForm
              trigger="Agregar franja"
              triggerVariant="outline"
              triggerSize="sm"
              title="Agregar franja de atención"
              description="Elige los días y la hora. Puedes agregar varias franjas el mismo día (por ejemplo, mañana y tarde)."
              action={addAgendaHours}
            >
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {DAY_ORDER.map((d) => (
                  <CheckboxField key={d} label={WEEKDAY_LABEL[d]} name="days" value={String(d)} defaultChecked={d >= 1 && d <= 5} />
                ))}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label="Desde" name="starts_at" type="time" defaultValue="08:00" required />
                <TextField label="Hasta" name="ends_at" type="time" defaultValue="12:00" required />
              </div>
            </DialogForm>
          )
        }
      >
        <ul className="divide-y divide-brand-border">
          {DAY_ORDER.map((d) => {
            const list = (hours ?? []).filter((h) => h.weekday === d);
            return (
              <li key={d} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                <span className="w-28 font-medium">{WEEKDAY_LABEL[d]}</span>
                <span className="flex flex-1 flex-wrap items-center gap-2">
                  {list.length === 0 ? (
                    <span className="text-brand-muted">No se atiende</span>
                  ) : (
                    list.map((h) => (
                      <span key={h.id as string} className="inline-flex items-center gap-1 rounded-full bg-black/5 py-0.5 pl-3 pr-1">
                        {formatTime12(trimTime(h.starts_at as string))} – {formatTime12(trimTime(h.ends_at as string))}
                        {canEdit && <RemoveButton kind="hours" id={h.id as string} label="franja" />}
                      </span>
                    ))
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section
        title="Bloqueos (festivos, vacaciones, ausencias)"
        actions={
          canEdit && (
            <DialogForm
              trigger="Bloquear un periodo"
              triggerVariant="outline"
              triggerSize="sm"
              title="Bloquear un periodo"
              description="En ese tiempo no se podrán agendar citas."
              action={addAgendaBlock}
            >
              <TextField label="Motivo" name="reason" required placeholder="Ej.: festivo, vacaciones, congreso" />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label="Desde (fecha)" name="from_date" type="date" required />
                <TextField label="Hasta (fecha)" name="to_date" type="date" hint="Si es un solo día, déjala vacía." />
              </div>
              <CheckboxField label="Todo el día" name="all_day" defaultChecked />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label="Hora de inicio" name="from_time" type="time" hint="Solo si no es todo el día." />
                <TextField label="Hora de fin" name="to_time" type="time" />
              </div>
            </DialogForm>
          )
        }
      >
        {(blocks ?? []).length === 0 ? (
          <p className="text-sm text-brand-muted">No hay bloqueos próximos.</p>
        ) : (
          <ul className="divide-y divide-brand-border">
            {(blocks ?? []).map((b) => {
              const from = localParts(b.starts_at as string, tz);
              const to = localParts(b.ends_at as string, tz);
              return (
                <li key={b.id as string} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <span>
                    <strong>{b.reason as string}</strong>
                    <span className="text-brand-muted">
                      {" "}
                      · {formatDate(from.date)} {formatTime12(from.time)} → {formatDate(to.date)} {formatTime12(to.time)}
                    </span>
                  </span>
                  {canEdit && <RemoveButton kind="block" id={b.id as string} label="bloqueo" />}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <CatalogSection def={CATALOGS.appointment_types} rows={(types ?? []) as never[]} refs={{}} canEdit={canEdit} />
    </div>
  );
}
