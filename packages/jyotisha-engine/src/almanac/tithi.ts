import type { AccuracyMetadata } from '../types/chart';
import { norm360 } from './util';

const TITHI_ORDINAL = [
  'Pratipada',
  'Dwitiya',
  'Tritiya',
  'Chaturthi',
  'Panchami',
  'Shashthi',
  'Saptami',
  'Ashtami',
  'Navami',
  'Dashami',
  'Ekadashi',
  'Dwadashi',
  'Trayodashi',
  'Chaturdashi',
] as const;

export type TithiResult = {
  /** 1–30 (15 shukla + 15 krishna). */
  index1To30: number;
  paksha: 'shukla' | 'krishna';
  ordinalName: string;
  /** Sidereal Moon − Sun elongation (degrees, 0–360) the tithi was derived from. */
  elongationDeg: number;
  /** Sixth-part of a tithi (1/60 of the synodic rotation). */
  karana: { index0To59: number };
  accuracy: AccuracyMetadata;
};

/**
 * Tithi (lunar day): sidereal Moon−Sun elongation in 12° steps (30 tithis per synodic month),
 * plus the karaṇa (half-tithi, 6° steps). Karaṇa *names* vary by tradition — only the stable
 * 0–59 index is returned, not a name, to avoid asserting a single "correct" naming convention.
 */
export function computeTithi(moonSiderealLon: number, sunSiderealLon: number): TithiResult {
  const elong = norm360(moonSiderealLon - sunSiderealLon);
  const tithiIndex = Math.min(29, Math.floor(elong / 12));
  const paksha: 'shukla' | 'krishna' = tithiIndex < 15 ? 'shukla' : 'krishna';
  const ordinalIndex = tithiIndex % 15;
  const ordinalName =
    ordinalIndex === 14 ? (paksha === 'shukla' ? 'Purnima' : 'Amavasya') : TITHI_ORDINAL[ordinalIndex];
  const halfTithiIndex0To59 = Math.min(59, Math.floor(elong / 6));

  return {
    index1To30: tithiIndex + 1,
    paksha,
    ordinalName,
    elongationDeg: Number(elong.toFixed(4)),
    karana: { index0To59: halfTithiIndex0To59 },
    accuracy: {
      tier: 'ephemeris',
      degraded: false,
      notes: [
        'Tithi index is deterministic arithmetic on real Swiss Ephemeris sidereal Moon/Sun longitudes.',
        'Karaṇa names vary by tradition; only the stable 0–59 index is returned, not a name.',
      ],
    },
  };
}
