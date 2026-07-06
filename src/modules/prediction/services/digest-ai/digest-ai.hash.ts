import type { DigestLocale } from './digest-ai.types';

/**
 * Deterministic short hash of any JSON-serializable value (FNV-1a, hex). Matches the hashing
 * used elsewhere in the prediction module for cache keys — stable across runs and machines.
 */
export function stableHash(value: unknown): string {
  const s = JSON.stringify(value) ?? '';
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Hash of everything that should force AI regeneration when the *user's settings* change:
 * focus areas, tones and language. Order-independent (sorted) so re-ordering the same
 * selections does not invalidate the pack.
 */
export function buildFocusHash(args: {
  focusAreas: string[];
  tones: string[];
  locale: DigestLocale;
}): string {
  return stableHash({
    focusAreas: [...args.focusAreas].map((s) => s.toLowerCase()).sort(),
    tones: [...args.tones].map((s) => s.toLowerCase()).sort(),
    locale: args.locale,
  });
}

/**
 * Hash of the astrology facts that should force regeneration when the *chart* changes
 * (i.e. when birth details are edited). Derived only — never the raw birth data.
 */
export function buildChartHash(args: {
  lagna: string;
  nakshatra?: string | null;
  dasha?: string | null;
}): string {
  return stableHash({
    lagna: (args.lagna ?? '').trim().toLowerCase(),
    nakshatra: (args.nakshatra ?? '').trim().toLowerCase(),
    dasha: (args.dasha ?? '').trim().toLowerCase(),
  });
}
