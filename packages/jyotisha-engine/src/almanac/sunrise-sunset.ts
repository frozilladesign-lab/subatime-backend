import {
  CalculationFlag,
  Planet,
  RiseTransitFlag,
  calculateRiseTransitSet,
} from '@swisseph/node';
import type { AccuracyMetadata } from '../types/chart';
import { AlmanacCalculationError } from './errors';
import { jdToUtcDate } from './util';

export type SunriseSunsetResult = {
  sunriseJd: number;
  sunsetJd: number;
  /** Next sunrise after `sunsetJd` at the same location, when computable (null near poles). */
  nextSunriseJd: number | null;
  sunriseUtc: string;
  sunsetUtc: string;
  nextSunriseUtc?: string;
  accuracy: AccuracyMetadata;
};

/**
 * Real Swiss-Ephemeris sunrise/sunset/next-sunrise for a given UT Julian Day "search start"
 * and location — the day-division reference point every other pañcāṅga calculation anchors to.
 */
export function computeSunriseSunset(
  jdMidnight: number,
  latitude: number,
  longitude: number,
): SunriseSunsetResult {
  const altM = 0;
  let sunriseJd: number;
  let sunsetJd: number;
  try {
    const rise = calculateRiseTransitSet(
      jdMidnight,
      Planet.Sun,
      RiseTransitFlag.Rise,
      longitude,
      latitude,
      altM,
      CalculationFlag.SwissEphemeris,
    );
    sunriseJd = rise.time;
    if (!Number.isFinite(sunriseJd)) {
      throw new Error('non-finite sunrise');
    }
    const set = calculateRiseTransitSet(
      sunriseJd + 1e-6,
      Planet.Sun,
      RiseTransitFlag.Set,
      longitude,
      latitude,
      altM,
      CalculationFlag.SwissEphemeris,
    );
    sunsetJd = set.time;
    if (!Number.isFinite(sunsetJd) || sunsetJd <= sunriseJd) {
      throw new Error('invalid sunset');
    }
  } catch {
    throw new AlmanacCalculationError(
      'Could not compute sunrise/sunset for this date and location (polar day/night or ephemeris error).',
      'SUNRISE_SUNSET_FAILED',
    );
  }

  let nextSunriseJd: number | null = null;
  try {
    const nextRise = calculateRiseTransitSet(
      sunsetJd + 1e-6,
      Planet.Sun,
      RiseTransitFlag.Rise,
      longitude,
      latitude,
      altM,
      CalculationFlag.SwissEphemeris,
    );
    if (Number.isFinite(nextRise.time) && nextRise.time > sunsetJd + 1e-8) {
      nextSunriseJd = nextRise.time;
    }
  } catch {
    nextSunriseJd = null;
  }

  const sunriseUtcDate = jdToUtcDate(sunriseJd);
  const sunsetUtcDate = jdToUtcDate(sunsetJd);

  return {
    sunriseJd,
    sunsetJd,
    nextSunriseJd,
    sunriseUtc: sunriseUtcDate.toISOString(),
    sunsetUtc: sunsetUtcDate.toISOString(),
    ...(nextSunriseJd != null ? { nextSunriseUtc: jdToUtcDate(nextSunriseJd).toISOString() } : {}),
    accuracy: {
      tier: 'ephemeris',
      degraded: false,
      verifiedAgainst: ['Swiss Ephemeris (swisseph) rise/transit/set'],
    },
  };
}
