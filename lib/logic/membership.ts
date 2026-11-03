import { daysBetween } from "@/lib/logic/dates";

export type MembershipState = "active" | "expiring" | "expired";

export interface MembershipStatus {
  state: MembershipState;
  /** Días que faltan (0 = vence hoy). Nulo si no tiene vencimiento. */
  daysLeft: number | null;
}

export const EXPIRING_WINDOW_DAYS = 7;

/**
 * La membresía vale hasta el final del día `validUntil`. Vencida = solo
 * lectura (las políticas RLS lo aplican con is_membership_active()).
 */
export function membershipStatus(validUntil: string | null, today: string): MembershipStatus {
  if (!validUntil) return { state: "active", daysLeft: null };
  const daysLeft = daysBetween(today, validUntil);
  if (daysLeft < 0) return { state: "expired", daysLeft };
  if (daysLeft <= EXPIRING_WINDOW_DAYS) return { state: "expiring", daysLeft };
  return { state: "active", daysLeft };
}
