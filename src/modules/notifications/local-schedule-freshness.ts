/**
 * Freshness rule for local-vs-FCM block-notification dedup (Phase 3).
 *
 * The app schedules local block notifications for today + tomorrow and reports that
 * state to the backend. When any of a user's devices has a FRESH local schedule, the
 * hourly FCM block push is skipped for that user — local delivery is primary and FCM
 * is the fallback for users who haven't opened the app recently.
 *
 * Pure module: no NestJS, no Prisma — unit-tested directly.
 */

export interface LocalScheduleState {
  lastLocalScheduleAt: Date;
  /** yyyy-MM-dd in `deviceTimezone`. */
  localScheduleThroughDate: string | null;
  deviceTimezone: string | null;
  /** granted | denied | unknown */
  notificationPermissionStatus: string | null;
}

/** A schedule older than this is stale even if its through-date still looks valid. */
export const LOCAL_SCHEDULE_MAX_AGE_MS = 36 * 60 * 60 * 1000;

/**
 * FRESH ⇔ permission granted AND lastLocalScheduleAt within 36h AND the local schedule
 * covers at least tomorrow (device timezone). Anything else — missing state, denied or
 * unknown permission, expired through-date — is STALE and FCM fallback is allowed.
 */
export function isLocalScheduleFresh(
  state: LocalScheduleState | null | undefined,
  now: Date,
): boolean {
  if (!state) return false;
  if (state.notificationPermissionStatus !== 'granted') return false;

  const ageMs = now.getTime() - state.lastLocalScheduleAt.getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > LOCAL_SCHEDULE_MAX_AGE_MS) return false;

  const through = (state.localScheduleThroughDate ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(through)) return false;

  const tomorrow = localDateKey(addDays(now, 1), state.deviceTimezone ?? 'UTC');
  // yyyy-MM-dd compares correctly as a string.
  return through >= tomorrow;
}

/** True when any of the user's device schedules is fresh (skip the user's FCM block push). */
export function anyLocalScheduleFresh(
  states: LocalScheduleState[],
  now: Date,
): boolean {
  return states.some((s) => isLocalScheduleFresh(s, now));
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

function localDateKey(utc: Date, tz: string): string {
  try {
    return utc.toLocaleDateString('en-CA', { timeZone: tz });
  } catch {
    return utc.toISOString().slice(0, 10);
  }
}
