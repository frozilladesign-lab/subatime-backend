import type { LifeTheme } from '@subatime/jyotisha-engine';

/**
 * AI-first digest content layer.
 *
 * The deterministic engine (`buildWeeklyDigest`/`buildMonthlyDigest`) remains the source of
 * every FACT — the week/month dates, the dominant theme, which day is best/caution, and the
 * audit reasoning. Gemini only rewrites the human-facing WORDING for those facts, in the
 * user's language. If Gemini is unavailable or returns anything invalid, the deterministic
 * wording is used unchanged. This is why the AI can never invent a sign, a date, or a claim
 * the chart did not produce.
 */

export type DigestLocale = 'en' | 'si';

/** Bump when the prompt or output contract changes so stored packs are recognized as stale. */
export const DIGEST_AI_PROMPT_VERSION = 'digest-ai-v1';

/** Where a stored digest's copy came from. */
export type DigestContentProvider = 'gemini' | 'template';

/** Outcome of an AI enrichment attempt (persisted for audit). */
export type DigestContentStatus = 'generated' | 'fallback' | 'failed';

/** Coarse day quality derived from the engine confidence score (never AI-decided). */
export type DigestRating = 'good' | 'mixed' | 'caution';

/**
 * Per-day wording for one day of the week, in the requested locale. This is the copy the daily
 * activation overlay applies to that day's Guide screen + notification. Dates and rating are
 * engine-owned and carried through unchanged; the AI only writes the five copy fields.
 */
export interface WeeklyDayAiContent {
  /** yyyy-MM-dd — must match an engine-provided day (never invented by the AI). */
  date: string;
  /** Headline. Max 12 words. */
  headline: string;
  /** 1–2 sentence summary. Max 35 words. */
  summary: string;
  /** One thing to do. Max 20 words. */
  do: string;
  /** One thing to avoid. Max 20 words. */
  avoid: string;
  /** Notification message copy (timing stays engine-controlled). Max 18 words. */
  notification: string;
}

/**
 * Wording-only fields Gemini returns for a weekly digest, in the requested locale.
 * These overlay the matching localized fields of the deterministic `WeeklyDigest`; all
 * dates, themes and audit stay engine-owned. `days` carries the per-day copy the daily
 * activation overlay consumes.
 */
export interface WeeklyAiContent {
  /** Headline. Max 12 words. */
  title: string;
  /** 2–3 sentence overview. Max 35 words. */
  body: string;
  /** One concrete, gentle suggestion. Max 20 words. */
  action: string;
  /** Why the best day is best. Max 20 words. */
  bestDayReason: string;
  /** How to treat the caution day. Max 20 words. */
  cautionDayReason: string;
  /** Optional focus-area highlight line. Max 20 words. */
  focusLine?: string;
  /** Per-day copy, one entry per engine-provided day, same dates in the same order. */
  days: WeeklyDayAiContent[];
}

/** Wording-only fields Gemini returns for a monthly overview, in the requested locale. */
export interface MonthlyAiContent {
  /** Headline. Max 12 words. */
  title: string;
  /** 2–3 sentence overview. Max 35 words. */
  body: string;
  /** One concrete, gentle suggestion. Max 20 words. */
  action: string;
  /** Why the standout dates stand out. Max 20 words. */
  standoutReason: string;
}

/**
 * Compact, privacy-safe fact pack sent to Gemini. Contains only derived astrology facts —
 * never name, email, phone, exact birth date/time/place, or user id.
 */
export interface WeeklyFactPack {
  lang: DigestLocale;
  tones: string[];
  focusAreas: string[];
  profile: { lagna: string };
  dominantTheme: LifeTheme;
  weekStart: string;
  weekEnd: string;
  bestDay: { date: string; theme: LifeTheme };
  cautionDay: { date: string };
  /** Deterministic engine reasons — authoritative context for the wording. */
  reasons: string[];
  /** Per-day facts (theme + rating) Gemini writes per-day copy from — never invents. */
  days: { date: string; theme: LifeTheme; rating: DigestRating }[];
}

export interface MonthlyFactPack {
  lang: DigestLocale;
  tones: string[];
  focusAreas: string[];
  profile: { lagna: string };
  dominantTheme: LifeTheme;
  monthStart: string;
  bestPeriod: { start: string; end: string };
  cautionPeriod: { start: string; end: string };
  standoutDates: string[];
  reasons: string[];
}

/** Provenance recorded on the stored digest so we can dedup + audit + regenerate correctly. */
export interface DigestContentProvenance {
  provider: DigestContentProvider;
  status: DigestContentStatus;
  promptVersion: string;
  locale: DigestLocale;
  focusHash: string;
  chartHash: string;
}

export type WeeklyValidationResult =
  | { ok: true; value: WeeklyAiContent }
  | { ok: false; reason: string };

export type MonthlyValidationResult =
  | { ok: true; value: MonthlyAiContent }
  | { ok: false; reason: string };
