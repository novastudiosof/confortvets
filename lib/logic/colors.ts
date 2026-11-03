const HEX = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: string): boolean {
  return HEX.test(value);
}

function channel(hex: string, start: number): number {
  return parseInt(hex.slice(start, start + 2), 16) / 255;
}

function linear(c: number): number {
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Blanco o casi negro, el que mejor se lea sobre el color de la marca. */
export function readableTextColor(hex: string): string {
  if (!isHexColor(hex)) return "#FFFFFF";
  const l =
    0.2126 * linear(channel(hex, 1)) +
    0.7152 * linear(channel(hex, 3)) +
    0.0722 * linear(channel(hex, 5));
  return l > 0.4 ? "#0B1020" : "#FFFFFF";
}
