import { DateTime } from 'luxon';

/** Julian Day (UT) → JS `Date` (UTC instant). */
export function jdToUtcDate(jd: number): Date {
  return new Date((jd - 2440587.5) * 86400000);
}

export function norm360(value: number): number {
  const n = value % 360;
  return n < 0 ? n + 360 : n;
}

export function isValidIanaZone(zone: string): boolean {
  const z = zone.trim();
  if (!z) return false;
  return DateTime.now().setZone(z).isValid;
}
