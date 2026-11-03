import { CustomFieldInputs } from "@/components/custom-field-inputs";
import { CheckboxField, TextAreaField, TextField } from "@/components/ui/fields";
import type { CustomFieldDef } from "@/lib/logic/custom-fields";
import type { Tutor } from "@/lib/types";

export function TutorFields({ tutor, customDefs }: { tutor?: Tutor; customDefs: CustomFieldDef[] }) {
  return (
    <>
      <p className="rounded-[var(--radius-brand-sm)] bg-brand/10 px-3 py-2 text-sm text-brand-ink">
        Solo el nombre es necesario. Los demás datos son opcionales: si faltan, el sistema te avisa pero te deja guardar.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Nombre completo" name="full_name" defaultValue={tutor?.full_name} required className="sm:col-span-2" />
        <TextField label="Cédula" name="document_number" defaultValue={tutor?.document_number ?? ""} />
        <TextField label="Teléfono" name="phone" type="tel" defaultValue={tutor?.phone ?? ""} />
        <TextField
          label="WhatsApp"
          name="whatsapp"
          type="tel"
          defaultValue={tutor?.whatsapp ?? ""}
          hint="Con este número se envían los recordatorios. Ej.: 3001234567"
        />
        <TextField label="Correo" name="email" type="email" defaultValue={tutor?.email ?? ""} />
        <TextField label="Dirección" name="address" defaultValue={tutor?.address ?? ""} className="sm:col-span-2" />
        <TextField label="Barrio" name="neighborhood" defaultValue={tutor?.neighborhood ?? ""} />
        <TextField label="Ciudad" name="city" defaultValue={tutor?.city ?? ""} />
      </div>
      <CustomFieldInputs defs={customDefs} values={tutor?.custom_fields} />
      <TextAreaField label="Notas" name="notes" defaultValue={tutor?.notes ?? ""} rows={2} />
      <div className="flex flex-col gap-2 rounded-[var(--radius-brand-sm)] bg-black/[0.03] p-3">
        <CheckboxField
          label="Autoriza que lo contactemos por WhatsApp o llamada"
          name="contact_consent"
          defaultChecked={tutor?.contact_consent}
        />
      </div>
    </>
  );
}
