import type { MonthlyDigest, WeeklyDigest } from '@subatime/jyotisha-engine';
import type { DigestLocale, MonthlyAiContent, WeeklyAiContent } from './digest-ai.types';

/**
 * Overlay AI wording onto a deterministic `WeeklyDigest`, in the requested locale only.
 *
 * Only human-facing copy is replaced. Every engine-owned fact — weekStart/weekEnd, the
 * dominant theme, which dates are best/caution, and the audit — is preserved untouched. For
 * `si` we overwrite the `*Si` fields and keep the English ones as deterministic (and vice
 * versa), so a language switch regenerates only the side the user actually reads.
 */
export function mergeWeeklyAiContent(
  base: WeeklyDigest,
  ai: WeeklyAiContent,
  locale: DigestLocale,
): WeeklyDigest {
  const merged: WeeklyDigest = {
    ...base,
    bestDay: { ...base.bestDay, reason: ai.bestDayReason },
    cautionDay: { ...base.cautionDay, reason: ai.cautionDayReason },
  };

  if (locale === 'si') {
    merged.titleSi = ai.title;
    merged.bodySi = ai.body;
    merged.actionSi = ai.action;
    if (base.focusHighlight && ai.focusLine) {
      merged.focusHighlight = { ...base.focusHighlight, lineSi: ai.focusLine };
    }
  } else {
    merged.title = ai.title;
    merged.body = ai.body;
    merged.action = ai.action;
    if (base.focusHighlight && ai.focusLine) {
      merged.focusHighlight = { ...base.focusHighlight, line: ai.focusLine };
    }
  }

  return merged;
}

/** Overlay AI wording onto a deterministic `MonthlyDigest`, in the requested locale only. */
export function mergeMonthlyAiContent(
  base: MonthlyDigest,
  ai: MonthlyAiContent,
  locale: DigestLocale,
): MonthlyDigest {
  const merged: MonthlyDigest = {
    ...base,
    standoutDates: base.standoutDates.map((d) => ({ ...d, reason: ai.standoutReason })),
  };

  if (locale === 'si') {
    merged.titleSi = ai.title;
    merged.bodySi = ai.body;
    merged.actionSi = ai.action;
  } else {
    merged.title = ai.title;
    merged.body = ai.body;
    merged.action = ai.action;
  }

  return merged;
}
