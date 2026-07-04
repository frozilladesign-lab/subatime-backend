import { detectDosha } from './dosha';
import type {
  CompatibilityResult,
  NormalizedCompatibilityProfile,
  RawCompatibilityProfile,
} from './types';
import { MatchProfileError } from './types';

function pickStr(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

/**
 * Requires explicit identifiers — no silent default lagna/nakshatra (avoids fake scores).
 * Throws `MatchProfileError` (plain Error, no NestJS) when data is insufficient.
 */
export function normalizeProfileStrict(profile: RawCompatibilityProfile): NormalizedCompatibilityProfile {
  const lagna = pickStr(profile.lagna, profile.ascendant, profile.zodiacSign);
  const nakshatra = pickStr(profile.nakshatra, profile.moonSign, profile.zodiacSign);
  if (!lagna || !nakshatra) {
    throw new MatchProfileError(
      'Insufficient birth-chart data for compatibility. Provide lagna/ascendant or zodiac sign, and nakshatra or moon sign.',
      'MATCH_INSUFFICIENT_DATA',
    );
  }
  const moonSign = pickStr(profile.moonSign, profile.zodiacSign, lagna)!;
  const marsHouse = Number(profile.marsHouse ?? 0);
  return { lagna, nakshatra, moonSign, marsHouse };
}

function scoreCommunication(
  a: { moonSign: string; nakshatra: string },
  b: { moonSign: string; nakshatra: string },
): number {
  let score = 62;
  if (a.moonSign === b.moonSign) score += 12;
  if (a.nakshatra[0] === b.nakshatra[0]) score += 8;
  return Math.min(95, score);
}

function scoreIntimacy(a: { nakshatra: string }, b: { nakshatra: string }): number {
  const diff = Math.abs(a.nakshatra.length - b.nakshatra.length);
  return Math.max(55, 88 - diff * 2);
}

const LONG_TERM_COMPATIBLE_PAIRS = new Set([
  'Mesha-Dhanu',
  'Vrishabha-Kanya',
  'Mithuna-Kumbha',
  'Karka-Meena',
  'Simha-Dhanu',
  'Makara-Vrishabha',
]);

function scoreLongTerm(a: { lagna: string }, b: { lagna: string }): number {
  const key = `${a.lagna}-${b.lagna}`;
  const reverse = `${b.lagna}-${a.lagna}`;
  return LONG_TERM_COMPATIBLE_PAIRS.has(key) || LONG_TERM_COMPATIBLE_PAIRS.has(reverse) ? 86 : 66;
}

function scoreEmotional(a: { moonSign: string }, b: { moonSign: string }): number {
  return a.moonSign === b.moonSign ? 90 : 72;
}

/** Pure compatibility comparison: normalization, scoring, dosha detection, recommendations. */
export function compareCompatibility(
  profileA: RawCompatibilityProfile,
  profileB: RawCompatibilityProfile,
): CompatibilityResult {
  const a = normalizeProfileStrict(profileA);
  const b = normalizeProfileStrict(profileB);
  const communication = scoreCommunication(a, b);
  const intimacy = scoreIntimacy(a, b);
  const longTerm = scoreLongTerm(a, b);
  const emotional = scoreEmotional(a, b);
  const overall = Math.round((communication + intimacy + longTerm + emotional) / 4);
  const dosha = detectDosha(a, b);

  return {
    method: 'heuristic',
    score: overall,
    summary:
      overall >= 75
        ? 'Strong compatibility with aligned growth patterns.'
        : overall >= 60
          ? 'Moderate compatibility with areas to strengthen.'
          : 'Compatibility requires careful communication and expectation setting.',
    breakdown: {
      communication,
      intimacy,
      longTerm,
      emotional,
    },
    doshaFlags: dosha,
    recommendations: [
      communication < 70
        ? 'Prioritize weekly check-ins to improve communication quality.'
        : 'Maintain transparent communication habits.',
      longTerm < 70
        ? 'Align long-term goals before major commitments.'
        : 'Your long-term direction appears naturally aligned.',
      dosha.hasManglikMismatch
        ? 'Consider guided counseling for Mars-driven conflict patterns.'
        : 'No critical dosha clash detected in current profile inputs.',
    ],
  };
}

/**
 * Alias for `compareCompatibility` — product/heuristic compatibility scoring (communication,
 * intimacy, long-term, emotional sub-scores). Not classical Aṣṭakūṭa guṇa matching; see
 * `compareAshtakootaCompatibility` in `./ashtakoota` for that.
 */
export const compareHeuristicCompatibility = compareCompatibility;
