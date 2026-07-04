/**
 * Pure feedback → scoring-weight math. Callers own the DB reads (prediction feedback rows,
 * user accuracy) and pass in plain counts; this module has no knowledge of Prisma or users.
 */

export type FeedbackContextCounts = Record<string, { good: number; total: number }>;

export const DEFAULT_CONTEXT_WEIGHTS: Record<string, number> = {
  overall: 0.7,
  career: 0.5,
  love: 0.5,
  health: 0.5,
};

/** Bound per-context weight ratios so one context can't dominate too aggressively. */
export function contextWeightsFromCounts(
  counts: FeedbackContextCounts,
  defaults: Record<string, number> = DEFAULT_CONTEXT_WEIGHTS,
): Record<string, number> {
  const weights = { ...defaults };
  for (const context of Object.keys(weights)) {
    const bucket = counts[context];
    if (!bucket || bucket.total === 0) continue;
    const ratio = bucket.good / bucket.total;
    weights[context] = Number(Math.min(0.95, Math.max(0.2, ratio)).toFixed(4));
  }
  return weights;
}

/** Net good/bad feedback ratio normalized to a 0.2–0.8 accuracy score (0.5 = no data). */
export function accuracyScoreFromCounts(goodCount: number, badCount: number): number {
  const total = goodCount + badCount;
  if (total === 0) return 0.5;
  const raw = (goodCount - badCount) / total;
  const normalized = 0.5 + raw * 0.5;
  return Number(Math.min(0.8, Math.max(0.2, normalized)).toFixed(4));
}

/**
 * Score multiplier from a user's accuracy score. Feedback influence grows up to ±15% as data
 * accumulates; the scoring engine clamps further, but this ceiling lets heavy users see
 * personalisation.
 */
export function weightAdjustmentFromAccuracy(accuracyScore: number): number {
  return Number((1 + (accuracyScore - 0.5) * 0.3).toFixed(4));
}
