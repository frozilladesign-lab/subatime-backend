/**
 * Whole-sign Lagna → horā lord favorability (classical benefic/malefic style matrix).
 * Lords match CHALDEAN horā output: Sun, Moon, Mars, Mercury, Jupiter, Venus, Saturn.
 */

const LAGNA_FAVORABILITY_MAP: Record<string, { favorable: string[]; tense: string[] }> = {
  Aries: { favorable: ['Sun', 'Moon', 'Mars', 'Jupiter'], tense: ['Mercury', 'Venus', 'Saturn'] },
  Taurus: { favorable: ['Sun', 'Mercury', 'Venus', 'Saturn'], tense: ['Moon', 'Jupiter'] },
  Gemini: { favorable: ['Venus', 'Saturn'], tense: ['Sun', 'Mars', 'Jupiter'] },
  Cancer: { favorable: ['Moon', 'Mars', 'Jupiter'], tense: ['Mercury', 'Venus'] },
  Leo: { favorable: ['Sun', 'Mars', 'Jupiter'], tense: ['Mercury', 'Venus', 'Saturn'] },
  Virgo: { favorable: ['Mercury', 'Venus'], tense: ['Moon', 'Mars', 'Jupiter'] },
  Libra: { favorable: ['Mercury', 'Venus', 'Saturn'], tense: ['Sun', 'Mars', 'Jupiter'] },
  Scorpio: { favorable: ['Sun', 'Moon', 'Mars', 'Jupiter'], tense: ['Mercury', 'Venus', 'Saturn'] },
  Sagittarius: { favorable: ['Sun', 'Mars', 'Jupiter'], tense: ['Mercury', 'Venus', 'Saturn'] },
  Capricorn: { favorable: ['Mercury', 'Venus', 'Saturn'], tense: ['Moon', 'Mars', 'Jupiter'] },
  Aquarius: { favorable: ['Sun', 'Mars', 'Venus', 'Saturn'], tense: ['Moon', 'Jupiter'] },
  Pisces: { favorable: ['Moon', 'Mars', 'Jupiter'], tense: ['Sun', 'Venus', 'Saturn'] },
};

/** API / chart `lagna` uses Sanskrit rāśi names (see ChartService.SIDEREAL_SIGNS). */
const SANSKRIT_LAGNA_TO_ENGLISH: Record<string, string> = {
  Mesha: 'Aries',
  Vrishabha: 'Taurus',
  Mithuna: 'Gemini',
  Karka: 'Cancer',
  Simha: 'Leo',
  Kanya: 'Virgo',
  Tula: 'Libra',
  Vrischika: 'Scorpio',
  Dhanu: 'Sagittarius',
  Makara: 'Capricorn',
  Kumbha: 'Aquarius',
  Meena: 'Pisces',
};

export function resolveLagnaEnglishKey(rawLagna: string | undefined | null): string | undefined {
  if (rawLagna == null) return undefined;
  const t = rawLagna.trim();
  if (!t) return undefined;
  if (LAGNA_FAVORABILITY_MAP[t]) return t;
  const fromSanskrit = SANSKRIT_LAGNA_TO_ENGLISH[t];
  if (fromSanskrit) return fromSanskrit;
  return undefined;
}

/** Litha-style auspicious direction opposite Maru (compass keys). */
const MARU_TO_SUBHA: Record<string, string> = {
  North: 'South',
  NorthWest: 'SouthEast',
  West: 'East',
  SouthWest: 'NorthEast',
  South: 'North',
  SouthEast: 'NorthWest',
  East: 'West',
};

export function subhaDirectionOppositeMaru(maruDirectionKey: string): string | undefined {
  const k = maruDirectionKey.trim();
  return MARU_TO_SUBHA[k];
}

export function getHoraFavorability(lord: string, lagna?: string): 'favorable' | 'tense' | 'neutral' {
  const key = resolveLagnaEnglishKey(lagna);
  if (!key || !LAGNA_FAVORABILITY_MAP[key]) return 'neutral';
  const L = lord.trim();
  const rules = LAGNA_FAVORABILITY_MAP[key];
  if (rules.favorable.includes(L)) return 'favorable';
  if (rules.tense.includes(L)) return 'tense';
  return 'neutral';
}
