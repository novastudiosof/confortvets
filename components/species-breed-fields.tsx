"use client";

import * as React from "react";

import { Field, TextField, fieldControlClass } from "@/components/ui/fields";
import { cn } from "@/lib/utils";
import type { Breed, Species } from "@/lib/types";

/**
 * Especie y raza: la raza se elige de la lista de la especie o, si no está,
 * se escribe a mano.
 */
export function SpeciesBreedFields({
  species,
  breeds,
  defaultSpeciesId,
  defaultBreedId,
  defaultBreedText,
}: {
  species: Species[];
  breeds: Breed[];
  defaultSpeciesId?: string;
  defaultBreedId?: string | null;
  defaultBreedText?: string | null;
}) {
  const [speciesId, setSpeciesId] = React.useState(defaultSpeciesId ?? "");
  const [breedId, setBreedId] = React.useState(defaultBreedId ?? "");

  const options = React.useMemo(
    () => breeds.filter((b) => b.species_id === speciesId && (b.is_active || b.id === defaultBreedId)),
    [breeds, speciesId, defaultBreedId]
  );

  return (
    <>
      <Field label="Especie" htmlFor="species_id" required>
        <select
          id="species_id"
          name="species_id"
          required
          value={speciesId}
          onChange={(e) => {
            setSpeciesId(e.target.value);
            setBreedId("");
          }}
          className={cn(fieldControlClass, "h-10")}
        >
          <option value="">Elegir...</option>
          {species
            .filter((s) => s.is_active || s.id === defaultSpeciesId)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </select>
      </Field>

      <Field label="Raza" htmlFor="breed_id">
        <select
          id="breed_id"
          name="breed_id"
          value={breedId}
          onChange={(e) => setBreedId(e.target.value)}
          disabled={!speciesId}
          className={cn(fieldControlClass, "h-10")}
        >
          <option value="">{speciesId ? "Otra / escribir a mano" : "Elige primero la especie"}</option>
          {options.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </Field>

      {!breedId && (
        <TextField
          label="Raza (escrita)"
          name="breed_text"
          defaultValue={defaultBreedText ?? ""}
          className="sm:col-span-2"
          hint="Úsala si la raza no está en la lista."
        />
      )}
    </>
  );
}
