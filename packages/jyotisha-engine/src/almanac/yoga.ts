import type { AccuracyMetadata } from '../types/chart';
import { norm360 } from './util';

/** 27 yogas from sidereal Sun+Moon sum (each 13°20'). */
const YOGA_NAMES = [
  'Vishkambha',
  'Priti',
  'Ayushman',
  'Saubhagya',
  'Shobhana',
  'Atiganda',
  'Sukarma',
  'Dhriti',
  'Shoola',
  'Ganda',
  'Vriddhi',
  'Dhruva',
  'Vyaghata',
  'Harshana',
  'Vajra',
  'Siddhi',
  'Vyatipata',
  'Variyan',
  'Parigha',
  'Shiva',
  'Siddha',
  'Sadhya',
  'Shubha',
  'Shukla',
  'Brahma',
  'Indra',
  'Vaidhriti',
] as const;

export type YogaResult = {
  index0To26: number;
  name: string;
  sumSiderealDeg: number;
  accuracy: AccuracyMetadata;
};

/** Yoga: sum of sidereal Sun + Moon longitudes, mod 360, in 27 equal (13°20') parts. */
export function computeYoga(sunSiderealLon: number, moonSiderealLon: number): YogaResult {
  const sum = norm360(sunSiderealLon + moonSiderealLon);
  const idx = Math.floor(sum / (360 / 27));
  return {
    index0To26: idx,
    name: YOGA_NAMES[idx] ?? YOGA_NAMES[0],
    sumSiderealDeg: Number(sum.toFixed(6)),
    accuracy: {
      tier: 'ephemeris',
      degraded: false,
      notes: ['Yoga index is deterministic arithmetic on real Swiss Ephemeris sidereal Sun/Moon longitudes.'],
    },
  };
}
