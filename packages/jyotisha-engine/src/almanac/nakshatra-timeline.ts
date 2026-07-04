import { NAKSHATRA_LIST } from '../chart/chart-engine';
import type { AccuracyMetadata } from '../types/chart';
import { norm360 } from './util';

export type NakshatraSnapshot = {
  name: string;
  index0To26: number;
  pada1To4: number;
  accuracy: AccuracyMetadata;
};

/**
 * Nakṣatra snapshot for a given sidereal Moon longitude (e.g. at sunrise, for the daily
 * pañcāṅga). This is a single-instant snapshot, not a full intra-day nakṣatra-change timeline —
 * the underlying calculation only needs one Moon longitude per civil day in the current almanac
 * use case. A true timeline (nakṣatra start/end instants within the day) can be derived by
 * calling this at multiple instants if a future feature needs it.
 */
export function computeNakshatraSnapshot(moonSiderealLon: number): NakshatraSnapshot {
  const moonNorm = norm360(moonSiderealLon);
  const nakArc = 360 / 27;
  const index0To26 = Math.floor(moonNorm / nakArc);
  const posInNak = moonNorm % nakArc;
  const pada1To4 = Math.min(4, Math.floor(posInNak / (nakArc / 4)) + 1);

  return {
    name: NAKSHATRA_LIST[index0To26] ?? NAKSHATRA_LIST[0],
    index0To26,
    pada1To4,
    accuracy: {
      tier: 'ephemeris',
      degraded: false,
      notes: ['Nakṣatra/pada index is deterministic arithmetic on the real Swiss Ephemeris sidereal Moon longitude.'],
    },
  };
}
