export const PASSWORD_MIN_LENGTH = 10;

/** Devuelve un mensaje de error o null si la contraseña es aceptable. */
export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`;
  }
  if (password.length > 72) return "La contraseña no puede superar 72 caracteres";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "La contraseña debe incluir letras y números";
  }
  return null;
}

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";

function randomInt(max: number): number {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0] % max;
}

function pick(alphabet: string): string {
  return alphabet[randomInt(alphabet.length)];
}

/** Contraseña temporal legible (sin caracteres ambiguos), siempre válida. */
export function generateTempPassword(length = 12): string {
  const size = Math.max(length, PASSWORD_MIN_LENGTH);
  const chars = [pick(LETTERS), pick(DIGITS)];
  while (chars.length < size) chars.push(pick(LETTERS + DIGITS));
  // Mezcla Fisher-Yates con aleatoriedad criptográfica.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
