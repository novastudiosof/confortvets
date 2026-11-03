import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/ui/fields";

interface CatalogItem {
  id: string;
  name: string;
  default_booster_days: number | null;
  kind?: string;
}

function VitalsFields() {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <TextField label="Peso (kg)" name="weight_kg" inputMode="decimal" />
      <TextField label="Temperatura (°C)" name="temperature_c" inputMode="decimal" />
      <TextField label="Estado general" name="general_state" />
    </div>
  );
}

export function VaccinationFields({ vaccines, today }: { vaccines: CatalogItem[]; today: string }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Vacuna"
          name="vaccine_id"
          placeholder="Otra (escribir el nombre)"
          options={vaccines.map((v) => ({
            value: v.id,
            label: v.default_booster_days ? `${v.name} · refuerzo a ${v.default_booster_days} días` : v.name,
          }))}
          hint="Si eliges una vacuna con días de refuerzo, la próxima fecha se calcula sola."
        />
        <TextField label="Nombre (si no está en la lista)" name="vaccine_name" />
        <TextField label="Fecha de aplicación" name="applied_at" type="date" defaultValue={today} max={today} required />
        <TextField label="Lote" name="lot" />
        <TextField label="Fecha de vencimiento del producto" name="expires_at" type="date" />
        <TextField label="Próxima aplicación" name="next_due_at" type="date" min={today} />
      </div>
      <CheckboxField label="No programar refuerzo ni recordatorio" name="no_next" />
      <VitalsFields />
      <TextAreaField label="Notas" name="notes" rows={2} />
    </>
  );
}

export function DewormingFields({ products, today }: { products: CatalogItem[]; today: string }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Tipo"
          name="kind"
          required
          options={[
            { value: "interna", label: "Interna" },
            { value: "externa", label: "Externa" },
          ]}
        />
        <SelectField
          label="Producto"
          name="product_id"
          placeholder="Otro (escribir el nombre)"
          options={products.map((p) => ({
            value: p.id,
            label: p.default_booster_days ? `${p.name} · refuerzo a ${p.default_booster_days} días` : p.name,
          }))}
        />
        <TextField label="Nombre (si no está en la lista)" name="product_name" />
        <TextField label="Fecha de aplicación" name="applied_at" type="date" defaultValue={today} max={today} required />
        <TextField label="Lote" name="lot" />
        <TextField label="Fecha de vencimiento del producto" name="expires_at" type="date" />
        <TextField label="Fecha de refuerzo" name="next_due_at" type="date" min={today} />
      </div>
      <CheckboxField label="No programar refuerzo ni recordatorio" name="no_next" />
      <VitalsFields />
      <TextAreaField label="Notas" name="notes" rows={2} />
    </>
  );
}
