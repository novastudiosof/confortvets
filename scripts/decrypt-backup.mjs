// Abre un respaldo cifrado por scripts/backup.mjs y lo guarda como JSON.
//
//   BACKUP_PASSWORD="la clave" node scripts/decrypt-backup.mjs respaldo.json.enc salida.json

import { readFileSync, writeFileSync } from "node:fs";

import { decryptBackup } from "./lib/backup-crypto.mjs";

const [, , input, output] = process.argv;
const password = process.env.BACKUP_PASSWORD;
if (!input || !output || !password) {
  console.error('Uso: BACKUP_PASSWORD="la clave" node scripts/decrypt-backup.mjs <respaldo.json.enc> <salida.json>');
  process.exit(1);
}

try {
  writeFileSync(output, decryptBackup(readFileSync(input), password));
  console.log(`Respaldo abierto: ${output}`);
} catch (error) {
  console.error(
    error instanceof Error && error.message.startsWith("El archivo")
      ? error.message
      : "No se pudo abrir: la clave es incorrecta o el archivo está dañado."
  );
  process.exit(1);
}
