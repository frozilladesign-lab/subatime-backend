/**
 * Notifications & Guidance settings — storage shape, defaults, sanitizing, and the
 * migration from the legacy single/multi onboarding intent (`BirthProfile.onboardingIntent`,
 * ids: love|career|growth|dreams) to the new multi-select `focusAreas`.
 *
 * The settings live under `users.preferences.notificationSettings` and are the single
 * source of truth for notification personalization. `dominantContext` used by the
 * prediction engine is derived FROM `focusAreas` (see `personalizationIntentFromFocusAreas`),
 * not from the legacy intent field.
 *
 * Pure module: no NestJS/Prisma — unit-tested directly.
 */

export const NOTIFICATION_CATEGORY_KEYS = [
  'dailyGuidance',
  'career',
  'money',
  'relationship',
  'health',
  'travel',
  'bestTime',
  'avoidTime',
  'weekly',
  'monthly',
] as const;
export type NotificationCategoryKey = (typeof NOTIFICATION_CATEGORY_KEYS)[number];

export const FOCUS_AREA_KEYS = [
  'career',
  'education',
  'money',
  'relationship',
  'travel',
  'business',
  'health',
  'spiritual',
] as const;
export type FocusAreaKey = (typeof FOCUS_AREA_KEYS)[number];

export const NOTIFICATION_FREQUENCY_KEYS = [
  'off',
  'important_only',
  'one_per_day',
  'two_per_day',
  'advanced',
] as const;
export type NotificationFrequencyKey = (typeof NOTIFICATION_FREQUENCY_KEYS)[number];

export const NOTIFICATION_TONE_KEYS = [
  'simple',
  'spiritual',
  'practical',
  'detailed',
  'positive',
  'balanced',
] as const;
export type NotificationToneKey = (typeof NOTIFICATION_TONE_KEYS)[number];

export interface NotificationSettings {
  version: 1;
  /** Per-category opt-in; delivery layers must not send a category that is off. */
  categories: Record<NotificationCategoryKey, boolean>;
  frequency: NotificationFrequencyKey;
  /** Local wall-clock 'HH:mm' anchors for the two daily guidance slots. */
  preferredTimes: { morning: string; evening: string };
  quietHours: { enabled: boolean; start: string; end: string };
  focusAreas: FocusAreaKey[];
  /** 1–2 tone styles blended by the copy builder (Phase B). */
  tones: NotificationToneKey[];
  /** True when focusAreas were seeded from the legacy onboarding intent. */
  migratedFromIntent?: boolean;
}

/** Product defaults: morning guidance + important alerts only, quiet nights, practical+balanced voice. */
export function defaultNotificationSettings(): NotificationSettings {
  return {
    version: 1,
    categories: {
      dailyGuidance: true,
      career: true,
      money: true,
      relationship: true,
      health: true,
      travel: true,
      bestTime: true,
      avoidTime: true,
      weekly: true,
      monthly: true,
    },
    frequency: 'important_only',
    preferredTimes: { morning: '07:00', evening: '18:30' },
    quietHours: { enabled: true, start: '22:00', end: '06:00' },
    focusAreas: [],
    tones: ['practical', 'balanced'],
  };
}

/** Legacy onboarding intent ids → new focus areas (love|career|growth|dreams, comma-separated). */
export function focusAreasFromLegacyIntent(intent?: string | null): FocusAreaKey[] {
  const map: Record<string, FocusAreaKey> = {
    love: 'relationship',
    career: 'career',
    growth: 'education',
    dreams: 'spiritual',
  };
  const out: FocusAreaKey[] = [];
  for (const part of (intent ?? '').split(/[,]+/)) {
    const mapped = map[part.trim().toLowerCase()];
    if (mapped && !out.includes(mapped)) out.push(mapped);
  }
  return out;
}

/**
 * Focus areas → the personalization intent tokens `buildPersonalization` bumps on.
 * This is how `dominantContext` derives from the settings instead of the legacy field.
 */
export function personalizationIntentFromFocusAreas(areas: FocusAreaKey[]): string {
  const map: Record<FocusAreaKey, string> = {
    career: 'career',
    education: 'career',
    money: 'career',
    business: 'career',
    relationship: 'love',
    health: 'health',
    travel: 'overall',
    spiritual: 'overall',
  };
  const tokens: string[] = [];
  for (const a of areas) {
    const t = map[a];
    if (t && !tokens.includes(t)) tokens.push(t);
  }
  return tokens.join(',');
}

/**
 * Effective settings for a user: stored value sanitized, or defaults seeded from the
 * legacy onboarding intent when nothing is stored yet (lazy migration).
 */
export function resolveNotificationSettings(
  preferencesJson: unknown,
  legacyOnboardingIntent?: string | null,
): { settings: NotificationSettings; migrated: boolean } {
  const root =
    preferencesJson != null && typeof preferencesJson === 'object' && !Array.isArray(preferencesJson)
      ? (preferencesJson as Record<string, unknown>)
      : {};
  const stored = root.notificationSettings;
  if (stored != null && typeof stored === 'object' && !Array.isArray(stored)) {
    return { settings: sanitizeNotificationSettings(stored), migrated: false };
  }
  const settings = defaultNotificationSettings();
  const seeded = focusAreasFromLegacyIntent(legacyOnboardingIntent);
  if (seeded.length) {
    settings.focusAreas = seeded;
    settings.migratedFromIntent = true;
  }
  return { settings, migrated: true };
}

/** Clamps arbitrary JSON into a valid NotificationSettings (unknown keys dropped, bad values → defaults). */
export function sanitizeNotificationSettings(raw: unknown): NotificationSettings {
  const d = defaultNotificationSettings();
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return d;
  const o = raw as Record<string, unknown>;

  const categories = { ...d.categories };
  if (o.categories != null && typeof o.categories === 'object' && !Array.isArray(o.categories)) {
    const c = o.categories as Record<string, unknown>;
    for (const key of NOTIFICATION_CATEGORY_KEYS) {
      if (typeof c[key] === 'boolean') categories[key] = c[key] as boolean;
    }
  }

  const frequency = (NOTIFICATION_FREQUENCY_KEYS as readonly string[]).includes(String(o.frequency))
    ? (o.frequency as NotificationFrequencyKey)
    : d.frequency;

  const times = (o.preferredTimes ?? {}) as Record<string, unknown>;
  const preferredTimes = {
    morning: hmOr(times.morning, d.preferredTimes.morning),
    evening: hmOr(times.evening, d.preferredTimes.evening),
  };

  const q = (o.quietHours ?? {}) as Record<string, unknown>;
  const quietHours = {
    enabled: typeof q.enabled === 'boolean' ? q.enabled : d.quietHours.enabled,
    start: hmOr(q.start, d.quietHours.start),
    end: hmOr(q.end, d.quietHours.end),
  };

  const focusAreas: FocusAreaKey[] = [];
  if (Array.isArray(o.focusAreas)) {
    for (const item of o.focusAreas) {
      const v = String(item).trim().toLowerCase();
      if ((FOCUS_AREA_KEYS as readonly string[]).includes(v) && !focusAreas.includes(v as FocusAreaKey)) {
        focusAreas.push(v as FocusAreaKey);
      }
    }
  }

  let tones: NotificationToneKey[] = [];
  if (Array.isArray(o.tones)) {
    for (const item of o.tones) {
      const v = String(item).trim().toLowerCase();
      if ((NOTIFICATION_TONE_KEYS as readonly string[]).includes(v) && !tones.includes(v as NotificationToneKey)) {
        tones.push(v as NotificationToneKey);
      }
    }
  }
  tones = tones.slice(0, 2);
  if (!tones.length) tones = [...d.tones];

  return {
    version: 1,
    categories,
    frequency,
    preferredTimes,
    quietHours,
    focusAreas,
    tones,
    ...(o.migratedFromIntent === true ? { migratedFromIntent: true } : {}),
  };
}

function hmOr(v: unknown, fallback: string): string {
  const s = String(v ?? '').trim();
  return /^([01]?\d|2[0-3]):[0-5]\d$/.test(s) ? s.padStart(5, '0') : fallback;
}
