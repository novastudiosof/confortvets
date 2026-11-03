import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const MAGIC = "CVB1";

/** Cifra con AES-256-GCM. Formato: "CVB1" | salt(16) | iv(12) | tag(16) | datos. */
export function encryptBackup(payload, password) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", scryptSync(password, salt, 32), iv);
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  return Buffer.concat([Buffer.from(MAGIC), salt, iv, cipher.getAuthTag(), encrypted]);
}

/** Descifra; lanza un error si la clave es incorrecta o el archivo fue alterado. */
export function decryptBackup(file, password) {
  if (file.length < 48 || file.subarray(0, 4).toString() !== MAGIC) {
    throw new Error("El archivo no es un respaldo de ConfortVets.");
  }
  const salt = file.subarray(4, 20);
  const iv = file.subarray(20, 32);
  const tag = file.subarray(32, 48);
  const decipher = createDecipheriv("aes-256-gcm", scryptSync(password, salt, 32), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(file.subarray(48)), decipher.final()]);
}
