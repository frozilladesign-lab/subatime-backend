/** Canonical Western sun signs accepted for compatibility profiles (matches compare payload). */
export const WESTERN_SUN_SIGNS = [
  'Aries',
  'Taurus',
  'Gemini',
  'Cancer',
  'Leo',
  'Virgo',
  'Libra',
  'Scorpio',
  'Sagittarius',
  'Capricorn',
  'Aquarius',
  'Pisces',
] as const;

export type WesternSunSign = (typeof WESTERN_SUN_SIGNS)[number];

export function normalizeWesternZodiacSign(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  const lower = s.toLowerCase();
  const hit = WESTERN_SUN_SIGNS.find((x) => x.toLowerCase() === lower);
  if (hit) return hit;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
