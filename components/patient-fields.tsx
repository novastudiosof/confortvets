import { CustomFieldInputs } from "@/components/custom-field-inputs";
import { SpeciesBreedFields } from "@/components/species-breed-fields";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/ui/fields";
import type { CustomFieldDef } from "@/lib/logic/custom-fields";
import type { Breed, Patient, Species } from "@/lib/types";

export function PatientFields({
  patient,
  species,
  breeds,
  customDefs,
  askWeight = false,
}: {
  patient?: Patient;
  species: Species[];
  breeds: Breed[];
  customDefs: CustomFieldDef[];
  /** Pide el peso inicial (solo al crear). */
  askWeight?: boolean;
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Nombre" name="name" defaultValue={patient?.name} required className="sm:col-span-2" />
        <SpeciesBreedFields
          species={species}
          breeds={breeds}
          defaultSpeciesId={patient?.species_id}
          defaultBreedId={patient?.breed_id}
          defaultBreedText={patient?.breed_text}
        />
        <SelectField
          label="Sexo"
          name="sex"
          defaultValue={patient?.sex ?? "indeterminado"}
          options={[
            { value: "macho", label: "Macho" },
            { value: "hembra", label: "Hembra" },
            { value: "indeterminado", label: "No definido" },
          ]}
        />
        <TextField label="Color" name="color" defaultValue={patient?.color ?? ""} />
        <TextField label="Fecha de nacimiento" name="birth_date" type="date" defaultValue={patient?.birth_date ?? ""} />
        <CheckboxField
          label="La fecha de nacimiento es aproximada"
          name="birth_date_approx"
          defaultChecked={patient?.birth_date_approx}
          className="self-end pb-2"
        />
        <TextField label="Microchip" name="microchip" defaultValue={patient?.microchip ?? ""} />
        <SelectField
          label="Esterilizado"
          name="sterilized"
          defaultValue={patient?.sterilized === true ? "si" : patient?.sterilized === false ? "no" : ""}
          options={[
            { value: "", label: "No se sabe" },
            { value: "si", label: "Sí" },
            { value: "no", label: "No" },
          ]}
        />
        {askWeight && <TextField label="Peso actual (kg)" name="weight_kg" inputMode="decimal" />}
      </div>
      <TextAreaField label="Alergias" name="allergies" defaultValue={patient?.allergies ?? ""} rows={2} />
      <TextAreaField label="Antecedentes" name="background" defaultValue={patient?.background ?? ""} rows={2} />
      <CustomFieldInputs defs={customDefs} values={patient?.custom_fields} />
    </>
  );
}
