import type {
  NotificationCandidateCategory,
  NotificationCandidates,
  NotificationImportance,
} from './notification-candidates';

/**
 * Notification plan — pure, deterministic selection over engine candidates,
 * honoring the user's Notifications & Guidance settings:
 * frequency caps, category toggles, quiet hours, preferred times, and Rahu Kāla
 * suppression of action-oriented alerts. The plan lists what to send (with final
 * send times) AND what was dropped with a reason, so selection is inspectable.
 *
 * Delivery layers (Flutter local scheduler primarily — no Firebase required —
 * and backend FCM fallback) schedule exactly `plan.scheduled`, nothing else.
 */

export type NotificationFrequency =
  | 'off'
  | 'important_only'
  | 'one_per_day'
  | 'two_per_day'
  | 'advanced';

export interface NotificationPlanSettings {
  /** Settings-screen category toggles (dailyGuidance, career, money, … bestTime, avoidTime). */
  categories: Record<string, boolean>;
  frequency: NotificationFrequency;
  /** Local 'HH:mm' anchors for the daily-guidance slots. */
  preferredTimes: { morning: string; evening: string };
  quietHours: { enabled: boolean; start: string; end: string };
}

export interface PlannedNotification {
  candidateId: string;
  category: NotificationCandidateCategory;
  importance: NotificationImportance;
  /** Final local wall-clock 'HH:mm' send time (after quiet-hour shifts). */
  sendAt: string;
  title: string;
  titleSi: string;
  body: string;
  bodySi: string;
  deepLink: string;
  /** Peak/caution alerts interrupt; guidance stays gentle. */
  sound: boolean;
  /** Why this was selected, e.g. `morning_guidance`, `best_window_alert`. */
  reason: string;
}

export interface DroppedNotification {
  candidateId: string;
  reason:
    | 'frequency_off'
    | 'frequency_cap'
    | 'category_disabled'
    | 'rahu_kalam'
    | 'quiet_hours';
}

export interface NotificationPlan {
  version: 1;
  frequency: NotificationFrequency;
  scheduled: PlannedNotification[];
  dropped: DroppedNotification[];
}

export interface BuildNotificationPlanInput {
  candidates: NotificationCandidates;
  settings: NotificationPlanSettings;
  /** Power hours converted to LOCAL 'HH:mm' send times by the caller (advanced mode only). */
  powerHoursLocal?: { id: string; sendAt: string }[];
}

/** Lead time for avoid-time alerts: notify before the caution window begins. */
const AVOID_ALERT_LEAD_MIN = 10;
const ADVANCED_MAX_PER_DAY = 5;

/** Candidate category → settings-screen toggle key. */
const CATEGORY_TOGGLE: Record<NotificationCandidateCategory, string> = {
  daily_guidance: 'dailyGuidance',
  career: 'career',
  education: 'career', // settings label is "Career & study"
  money: 'money',
  business: 'career',
  relationship: 'relationship',
  health: 'health',
  travel: 'travel',
  spiritual: 'dailyGuidance',
  best_time: 'bestTime',
  avoid_time: 'avoidTime',
};

const IMPORTANCE_RANK: Record<NotificationImportance, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

interface PoolItem extends PlannedNotification {
  /** Start of the window this alert refers to (for quiet-hour shift validity). */
  windowStart?: string;
}

export function buildNotificationPlan(input: BuildNotificationPlanInput): NotificationPlan {
  const { candidates, settings } = input;
  const dropped: DroppedNotification[] = [];

  const pool = buildPool(input);

  if (settings.frequency === 'off') {
    return {
      version: 1,
      frequency: 'off',
      scheduled: [],
      dropped: pool.map((p) => ({ candidateId: p.candidateId, reason: 'frequency_off' as const })),
    };
  }

  // 1. Category toggles.
  let remaining: PoolItem[] = [];
  for (const item of pool) {
    const toggle = CATEGORY_TOGGLE[item.category];
    if (settings.categories[toggle] === false) {
      dropped.push({ candidateId: item.candidateId, reason: 'category_disabled' });
    } else {
      remaining.push(item);
    }
  }

  // 2. Rahu Kāla: no action-oriented (best_time) alerts inside it — caution,
  //    reflection, and avoid-time messages remain allowed.
  const rahu = candidates.rahuKalam;
  if (rahu) {
    const next: PoolItem[] = [];
    for (const item of remaining) {
      const actionable = item.category === 'best_time';
      const sendInRahu = hmWithin(item.sendAt, rahu.start, rahu.end);
      const windowInRahu = item.windowStart ? hmWithin(item.windowStart, rahu.start, rahu.end) : false;
      if (actionable && (sendInRahu || windowInRahu)) {
        dropped.push({ candidateId: item.candidateId, reason: 'rahu_kalam' });
      } else {
        next.push(item);
      }
    }
    remaining = next;
  }

  // 3. Quiet hours: shift guidance to the quiet end; shift alerts only while the
  //    shifted time still lands before their window starts, otherwise drop.
  if (settings.quietHours.enabled) {
    const { start, end } = settings.quietHours;
    const next: PoolItem[] = [];
    for (const item of remaining) {
      if (!hmWithin(item.sendAt, start, end)) {
        next.push(item);
        continue;
      }
      if (item.category === 'daily_guidance') {
        next.push({ ...item, sendAt: end, reason: `${item.reason}+quiet_shift` });
        continue;
      }
      if (item.windowStart && hmToMin(end) <= hmToMin(item.windowStart) && !hmWithin(item.windowStart, start, end)) {
        next.push({ ...item, sendAt: end, reason: `${item.reason}+quiet_shift` });
      } else {
        dropped.push({ candidateId: item.candidateId, reason: 'quiet_hours' });
      }
    }
    remaining = next;
  }

  // 4. Frequency caps.
  const scheduled = applyFrequency(settings.frequency, remaining, dropped);
  scheduled.sort((a, b) => hmToMin(a.sendAt) - hmToMin(b.sendAt));

  return {
    version: 1,
    frequency: settings.frequency,
    scheduled: scheduled.map(({ windowStart: _ws, ...rest }) => rest),
    dropped,
  };
}

// ── Pool construction ────────────────────────────────────────────────────────

function buildPool(input: BuildNotificationPlanInput): PoolItem[] {
  const { candidates, settings } = input;
  const pool: PoolItem[] = [];

  for (const g of candidates.guidance ?? []) {
    pool.push({
      candidateId: g.id,
      category: g.category,
      importance: g.importance,
      sendAt: g.slot === 'morning' ? settings.preferredTimes.morning : settings.preferredTimes.evening,
      title: g.title,
      titleSi: g.titleSi,
      body: g.body,
      bodySi: g.bodySi,
      deepLink: g.deepLink,
      sound: false,
      reason: g.slot === 'morning' ? 'morning_guidance' : 'evening_guidance',
    });
  }

  const bw = candidates.bestWindow;
  if (bw) {
    const peakBlock = candidates.blocks.find((b) => b.id === bw.blockId);
    pool.push({
      candidateId: bw.id ?? 'best-window',
      category: bw.category ?? 'best_time',
      importance: bw.importance ?? 'high',
      sendAt: bw.sendAt,
      title: bw.title,
      titleSi: bw.titleSi,
      body: bw.body,
      bodySi: bw.bodySi,
      deepLink: bw.deepLink,
      sound: true,
      reason: 'best_window_alert',
      windowStart: peakBlock?.startTime,
    });
  }

  const caution = candidates.blocks.find((b) => b.type === 'caution' && b.priority === 3);
  if (caution) {
    pool.push({
      candidateId: caution.id,
      category: 'avoid_time',
      importance: caution.importance ?? 'high',
      sendAt: hmMinusMinutes(caution.startTime, AVOID_ALERT_LEAD_MIN),
      title: caution.title,
      titleSi: caution.titleSi,
      body: caution.body,
      bodySi: caution.bodySi,
      deepLink: caution.deepLink,
      sound: false,
      reason: 'avoid_time_alert',
      windowStart: caution.startTime,
    });
  }

  // Power hours join the pool only in advanced mode and only when the caller
  // supplied local send times (they are stored as UTC instants).
  if (settings.frequency === 'advanced') {
    const byId = new Map(candidates.powerHours.map((p) => [p.id, p]));
    for (const local of (input.powerHoursLocal ?? []).slice(0, 2)) {
      const ph = byId.get(local.id);
      if (!ph || !/^([01]?\d|2[0-3]):[0-5]\d$/.test(local.sendAt)) continue;
      pool.push({
        candidateId: ph.id,
        category: ph.category ?? 'best_time',
        importance: ph.importance ?? 'medium',
        sendAt: local.sendAt,
        title: ph.title,
        titleSi: ph.titleSi,
        body: ph.body,
        bodySi: ph.bodySi,
        deepLink: ph.deepLink,
        sound: false,
        reason: 'power_hour',
      });
    }
  }

  return pool;
}

// ── Frequency ────────────────────────────────────────────────────────────────

function applyFrequency(
  frequency: NotificationFrequency,
  pool: PoolItem[],
  dropped: DroppedNotification[],
): PoolItem[] {
  const byRank = (a: PoolItem, b: PoolItem) =>
    IMPORTANCE_RANK[a.importance] - IMPORTANCE_RANK[b.importance] ||
    hmToMin(a.sendAt) - hmToMin(b.sendAt);

  const morning = pool.find((p) => p.candidateId === 'daily-morning');
  const evening = pool.find((p) => p.candidateId === 'daily-evening');
  const alerts = pool
    .filter((p) => p.category === 'best_time' || p.category === 'avoid_time')
    .sort(byRank);

  let keep: PoolItem[];
  switch (frequency) {
    case 'important_only': {
      // Max 2/day: the morning anchor + one HIGH/CRITICAL alert.
      const alert = alerts.find((a) => IMPORTANCE_RANK[a.importance] <= IMPORTANCE_RANK.high);
      keep = [morning, alert].filter((x): x is PoolItem => x != null);
      break;
    }
    case 'one_per_day': {
      const best = morning ?? alerts[0] ?? evening;
      keep = best ? [best] : [];
      break;
    }
    case 'two_per_day': {
      const alert = alerts[0] ?? evening;
      keep = [morning, alert].filter((x): x is PoolItem => x != null).slice(0, 2);
      break;
    }
    case 'advanced': {
      keep = [...pool].sort(byRank).slice(0, ADVANCED_MAX_PER_DAY);
      break;
    }
    default:
      keep = [];
  }

  const keptIds = new Set(keep.map((k) => k.candidateId));
  for (const item of pool) {
    if (!keptIds.has(item.candidateId)) {
      dropped.push({ candidateId: item.candidateId, reason: 'frequency_cap' });
    }
  }
  return keep;
}

// ── Time helpers (wrap-aware) ────────────────────────────────────────────────

function hmToMin(hm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return 0;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/** True when `hm` falls inside [start, end), handling ranges that wrap midnight. */
function hmWithin(hm: string, start: string, end: string): boolean {
  const v = hmToMin(hm);
  const s = hmToMin(start);
  const e = hmToMin(end);
  if (s === e) return false;
  return s < e ? v >= s && v < e : v >= s || v < e;
}

function hmMinusMinutes(hm: string, minutes: number): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return hm;
  const total = Math.max(0, parseInt(m[1], 10) * 60 + parseInt(m[2], 10) - minutes);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
