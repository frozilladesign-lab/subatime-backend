import type { AccuracyMetadata } from '../types/chart';
import type { DoshaFlags } from './types';

const MANGLIK_HOUSES = new Set([1, 4, 7, 8, 12]);

/** Manglik (Mars dosha) houses: 1, 4, 7, 8, 12 from lagna. */
export function detectDosha(a: { marsHouse: number }, b: { marsHouse: number }): DoshaFlags {
  const aManglik = MANGLIK_HOUSES.has(a.marsHouse);
  const bManglik = MANGLIK_HOUSES.has(b.marsHouse);
  return {
    aManglik,
    bManglik,
    hasManglikMismatch: aManglik !== bManglik,
  };
}

export type ManglikAnalysisInput = {
  /** Mars house counted from the ascendant (lagna), 1–12. Always required. */
  marsHouseFromLagna: number;
  /** Mars house counted from natal Moon, 1–12. Optional secondary check. */
  marsHouseFromMoon?: number;
  /** Mars house counted from natal Venus, 1–12. Optional secondary check (less common). */
  marsHouseFromVenus?: number;
};

export type ManglikAnalysisResult = {
  manglikFromLagna: boolean;
  manglikFromMoon?: boolean;
  manglikFromVenus?: boolean;
  marsHouseFromLagna: number;
  marsHouseFromMoon?: number;
  marsHouseFromVenus?: number;
  rulesUsed: string[];
  notes: string[];
  /** This is a deterministic classical-rule application, not an astronomical or heuristic claim. */
  accuracy: AccuracyMetadata;
};

/**
 * Transparent single-profile Manglik (Mars doṣa) analysis.
 * Default rule: Mars in houses 1, 4, 7, 8, or 12 from the ascendant. Moon- and Venus-based
 * variants are classical but regionally inconsistent — they are reported only when their
 * input house is supplied, and are always clearly labeled as optional/secondary checks.
 */
export function analyzeManglikDosha(input: ManglikAnalysisInput): ManglikAnalysisResult {
  const rulesUsed: string[] = ['mars-houses-1-4-7-8-12-from-lagna'];
  const notes: string[] = [
    'Default rule checks Mars in houses 1, 4, 7, 8, or 12 from the ascendant (lagna).',
  ];

  const manglikFromLagna = MANGLIK_HOUSES.has(input.marsHouseFromLagna);

  const result: ManglikAnalysisResult = {
    manglikFromLagna,
    marsHouseFromLagna: input.marsHouseFromLagna,
    rulesUsed,
    notes,
    accuracy: {
      tier: 'classical-rule',
      degraded: false,
      notes: ['Deterministic classical Manglik house rule, applied exactly as documented.'],
    },
  };

  if (input.marsHouseFromMoon !== undefined) {
    result.manglikFromMoon = MANGLIK_HOUSES.has(input.marsHouseFromMoon);
    result.marsHouseFromMoon = input.marsHouseFromMoon;
    rulesUsed.push('mars-houses-1-4-7-8-12-from-moon');
    notes.push(
      'Moon-based check is an optional, regionally-variable secondary rule — not all traditions apply it.',
    );
  }

  if (input.marsHouseFromVenus !== undefined) {
    result.manglikFromVenus = MANGLIK_HOUSES.has(input.marsHouseFromVenus);
    result.marsHouseFromVenus = input.marsHouseFromVenus;
    rulesUsed.push('mars-houses-1-4-7-8-12-from-venus');
    notes.push(
      'Venus-based check is an optional, less-common secondary rule — included for transparency only.',
    );
  }

  return result;
}
