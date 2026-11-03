import { describe, expect, it } from "vitest";

import { decryptBackup, encryptBackup } from "../scripts/lib/backup-crypto.mjs";
import { addMonths } from "@/lib/logic/dates";

describe("cifrado del respaldo", () => {
  const payload = Buffer.from(JSON.stringify({ tutors: [{ full_name: "Ñandú Pérez" }] }), "utf8");

  it("cifra y descifra con la misma clave", () => {
    const file = encryptBackup(payload, "una-clave-larga-de-prueba");
    expect(file.subarray(0, 4).toString()).toBe("CVB1");
    expect(file.includes(Buffer.from("Ñandú"))).toBe(false); // no queda texto legible
    expect(decryptBackup(file, "una-clave-larga-de-prueba").equals(payload)).toBe(true);
  });

  it("rechaza una clave incorrecta", () => {
    const file = encryptBackup(payload, "una-clave-larga-de-prueba");
    expect(() => decryptBackup(file, "otra-clave-distinta-xx")).toThrow();
  });

  it("detecta un archivo alterado", () => {
    const file = Buffer.from(encryptBackup(payload, "una-clave-larga-de-prueba"));
    file[file.length - 1] ^= 0xff;
    expect(() => decryptBackup(file, "una-clave-larga-de-prueba")).toThrow();
  });

  it("rechaza un archivo que no es un respaldo", () => {
    expect(() => decryptBackup(Buffer.from("hola"), "x")).toThrow(/no es un respaldo/);
  });

  it("dos cifrados del mismo contenido son distintos", () => {
    const a = encryptBackup(payload, "una-clave-larga-de-prueba");
    const b = encryptBackup(payload, "una-clave-larga-de-prueba");
    expect(a.equals(b)).toBe(false);
  });
});

describe("addMonths", () => {
  it("suma meses y ajusta el fin de mes", () => {
    expect(addMonths("2026-01-15", 1)).toBe("2026-02-15");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-11-30", 3)).toBe("2027-02-28");
    expect(addMonths("2026-10-31", 12)).toBe("2027-10-31");
  });
});
