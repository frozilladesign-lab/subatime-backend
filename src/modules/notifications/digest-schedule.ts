/**
 * Digest scheduling rules (Phase C) — pure, deterministic, unit-tested.
 *
 * Encodes the product timing spec:
 *  - Weekly digest: Sunday 19:00 local (a preview for the coming week), max 1 per ISO week.
 *  - Monthly digest: 1st of month 07:30 local (a clean start), max 1 per calendar month.
 *  - Quiet hours: a digest landing inside quiet hours moves to the quiet-window end.
 *  - Same day: monthly goes first; weekly is pushed to at least 4h after monthly, and if
 *    that isn't a safe evening it moves to the next evening.
 *  - Frequency `off` schedules nothing; other modes allow digests when their toggle is on
 *    (digests are low-frequency, so they aren't counted against the daily cap).
 *  - Category toggle off (`weekly` / `monthly`) → that digest is not scheduled.
 *  - Already-sent period keys are never rescheduled (no duplicates).
 *
 * The caller computes each slot's default local date + time (Sunday / 1st) with a
 * timezone-aware date library; this module only applies the gating, quiet-hour shift, and
 * same-day spacing — so it's trivially testable.
 */

const WEEKLY_MIN_GAP_MIN = 4 * 60;
/** A "safe evening" fallback time for a bumped weekly digest. */
const WEEKLY_EVENING_HM = '19:00';

export interface DigestSlot {
  kind: 'weekly' | 'monthly';
  /** Dedup key: ISO week ("2026-W28") or month ("2026-08"). */
  periodKey: string;
  /** Local send day, yyyy-MM-dd. */
  date: string;
  /** Default local send time, "HH:mm". */
  hm: string;
}

export interface DigestScheduleSettings {
  categories: Record<string, boolean>;
  frequency: string;
  quietHours: { enabled: boolean; start: string; end: string };
}

export interface ScheduledDigest {
  kind: 'weekly' | 'monthly';
  periodKey: string;
  date: string;
  /** Final local send time after quiet-hour + spacing adjustments. */
  sendAt: string;
  reason: string;
}

export interface DroppedDigest {
  kind: 'weekly' | 'monthly';
  periodKey: string;
  reason: 'frequency_off' | 'category_disabled' | 'already_sent';
}

export interface BuildDigestScheduleInput {
  weekly?: DigestSlot;
  monthly?: DigestSlot;
  settings: DigestScheduleSettings;
  /** Period keys already scheduled/sent for this user (dedup). */
  alreadySent?: Set<string>;
}

export interface DigestSchedule {
  scheduled: ScheduledDigest[];
  dropped: DroppedDigest[];
}

const CATEGORY_TOGGLE: Record<'weekly' | 'monthly', string> = {
  weekly: 'weekly',
  monthly: 'monthly',
};

export function buildDigestSchedule(input: BuildDigestScheduleInput): DigestSchedule {
  const { settings } = input;
  const alreadySent = input.alreadySent ?? new Set<string>();
  const dropped: DroppedDigest[] = [];

  const slots: DigestSlot[] = [input.monthly, input.weekly].filter((s): s is DigestSlot => !!s);

  if (settings.frequency === 'off') {
    return { scheduled: [], dropped: slots.map((s) => ({ kind: s.kind, periodKey: s.periodKey, reason: 'frequency_off' as const })) };
  }

  // Gate by category toggle + dedup.
  const eligible: DigestSlot[] = [];
  for (const slot of slots) {
    if (settings.categories[CATEGORY_TOGGLE[slot.kind]] === false) {
      dropped.push({ kind: slot.kind, periodKey: slot.periodKey, reason: 'category_disabled' });
    } else if (alreadySent.has(slot.periodKey)) {
      dropped.push({ kind: slot.kind, periodKey: slot.periodKey, reason: 'already_sent' });
    } else {
      eligible.push(slot);
    }
  }

  // Quiet-hour shift each surviving slot.
  const scheduled: ScheduledDigest[] = eligible.map((slot) => {
    const q = settings.quietHours;
    let sendAt = slot.hm;
    let reason = slot.kind === 'weekly' ? 'weekly_sunday_evening' : 'monthly_first_morning';
    if (q.enabled && hmWithin(sendAt, q.start, q.end)) {
      sendAt = q.end;
      reason += '+quiet_shift';
    }
    return { kind: slot.kind, periodKey: slot.periodKey, date: slot.date, sendAt, reason };
  });

  // Same-day spacing: monthly first, weekly ≥ 4h later; else weekly → next evening.
  const monthly = scheduled.find((s) => s.kind === 'monthly');
  const weekly = scheduled.find((s) => s.kind === 'weekly');
  if (monthly && weekly && monthly.date === weekly.date) {
    const minWeekly = hmToMin(monthly.sendAt) + WEEKLY_MIN_GAP_MIN;
    if (hmToMin(weekly.sendAt) < minWeekly) {
      if (minWeekly <= hmToMin('21:00') && !insideQuiet(minToHm(minWeekly), settings.quietHours)) {
        weekly.sendAt = minToHm(minWeekly);
        weekly.reason += '+spaced_after_monthly';
      } else {
        // No safe slot today — move the weekly digest to the next evening.
        weekly.date = nextDay(weekly.date);
        weekly.sendAt = adjustForQuiet(WEEKLY_EVENING_HM, settings.quietHours);
        weekly.reason += '+bumped_next_evening';
      }
    }
  }

  return { scheduled, dropped };
}

// ── Time helpers (wrap-aware quiet windows) ──────────────────────────────────

function hmToMin(hm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 0;
}

function minToHm(total: number): string {
  const t = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

function hmWithin(hm: string, start: string, end: string): boolean {
  const v = hmToMin(hm);
  const s = hmToMin(start);
  const e = hmToMin(end);
  if (s === e) return false;
  return s < e ? v >= s && v < e : v >= s || v < e;
}

function insideQuiet(hm: string, q: { enabled: boolean; start: string; end: string }): boolean {
  return q.enabled && hmWithin(hm, q.start, q.end);
}

function adjustForQuiet(hm: string, q: { enabled: boolean; start: string; end: string }): string {
  return insideQuiet(hm, q) ? q.end : hm;
}

/** yyyy-MM-dd + 1 day (UTC-safe date arithmetic on the calendar date). */
function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
