import { dateToJulianDay } from '@swisseph/node';
import { DateTime } from 'luxon';
import type { AccuracyMetadata } from '../types/chart';
import { AlmanacCalculationError } from './errors';
import { computeHoraTimeline, type HoraSegment } from './hora';
import { computeNakshatraSnapshot } from './nakshatra-timeline';
import { computeRahuKalam, type DaySegment } from './rahu-kalam';
import { computeSunriseSunset, type SunriseSunsetResult } from './sunrise-sunset';
import { computeTithi } from './tithi';
import { isValidIanaZone, jdToUtcDate } from './util';
import { computeYoga } from './yoga';
import { resolveLagnaEnglishKey } from '../calendar/hora-lagna';

export { AlmanacCalculationError } from './errors';
export { computeSunriseSunset, type SunriseSunsetResult } from './sunrise-sunset';
export { computeTithi, type TithiResult } from './tithi';
export { computeYoga, type YogaResult } from './yoga';
export { computeNakshatraSnapshot, type NakshatraSnapshot } from './nakshatra-timeline';
export { computeHoraTimeline, CHALDEAN_LORDS, type HoraSegment, type HoraTimelineResult } from './hora';
export { computeRahuKalam, type DaySegment, type RahuKalamResult } from './rahu-kalam';

/** Minimal sidereal-longitude surface the pañcāṅga assembly needs (satisfied by `JyotishaChartEngine`). */
export interface PanchangaChartSource {
  moonSiderealLongitudeUtc(dateUtc: Date, ayanamsaMode?: string): number;
  sunSiderealLongitudeUtc(dateUtc: Date, ayanamsaMode?: string): number;
}

export type PanchangaInput = {
  /** Civil date, `YYYY-MM-DD`, interpreted in `timezone`. */
  date: string;
  /** IANA timezone id. */
  timezone: string;
  latitude: number;
  longitude: number;
  /** Optional whole-sign lagna (Sanskrit or English) for horā `personalStatus`. */
  lagna?: string;
  ayanamsaMode?: string;
};

export type PanchangaResult = {
  date: string;
  timezone: string;
  latitude: number;
  longitude: number;
  reference: { label: 'sunrise'; instantUtc: string };
  sun: { siderealLongitudeDeg: number };
  moon: { siderealLongitudeDeg: number };
  tithi: { index1To30: number; paksha: 'shukla' | 'krishna'; ordinalName: string };
  halfTithi: { index0To59: number; elongationDeg: number };
  yoga: { index0To26: number; name: string; sumSiderealDeg: number };
  nakshatra: { name: string; index0To26: number; pada1To4: number };
  sunrise: { instantUtc: string; julianDay: number };
  sunset: { instantUtc: string; julianDay: number };
  abhijitStart: string;
  abhijitEnd: string;
  maruDirection: string;
  nextSunrise?: { instantUtc: string; julianDay: number };
  rahuKala: DaySegment;
  yamagandha: DaySegment;
  gulika: DaySegment;
  dayHoras: HoraSegment[];
  nightHoras: HoraSegment[];
  personalization?: { lagna: string; lagnaMatrixKey: string | null };
  methodology: Record<string, string>;
  accuracy: AccuracyMetadata;
};

/**
 * Full daily pañcāṅga assembly: tithi, yoga, nakṣatra, sunrise/sunset, Abhijit muhūrta, Rāhu
 * kāla/Yamagaṇḍa/Gulika, Maru diśā, and day/night horā timelines, for one civil day at a
 * location. Pure given `(date, timezone, latitude, longitude, lagna?)` plus a sidereal
 * longitude source — no NestJS, DB, HTTP, or Firebase. Throws `AlmanacCalculationError` for an
 * invalid timezone, an invalid calendar date in that timezone, or an unrecoverable sunrise/
 * sunset failure (e.g. polar day/night).
 */
export function computePanchanga(input: PanchangaInput, chartSource: PanchangaChartSource): PanchangaResult {
  const tz = input.timezone.trim();
  if (!isValidIanaZone(tz)) {
    throw new AlmanacCalculationError('Invalid or unsupported IANA timezone.', 'INVALID_TIMEZONE');
  }

  const localMidnight = DateTime.fromISO(`${input.date}T00:00:00`, { zone: tz });
  if (!localMidnight.isValid) {
    throw new AlmanacCalculationError('Invalid calendar date for the given timezone.', 'INVALID_DATE');
  }

  const jdMidnight = dateToJulianDay(localMidnight.toUTC().toJSDate());
  const sunDiv: SunriseSunsetResult = computeSunriseSunset(jdMidnight, input.latitude, input.longitude);
  const { sunriseJd, sunsetJd, nextSunriseJd } = sunDiv;
  const sunriseUtcDate = jdToUtcDate(sunriseJd);
  const sunsetUtcDate = jdToUtcDate(sunsetJd);

  /** Apparent solar midpoint (JD); used for the Abhijit window (±24 min). */
  const solarMidpointJd = (sunriseJd + sunsetJd) / 2;
  const abhijitHalfDayFrac = 24 / (24 * 60);
  const abhijitStart = jdToUtcDate(solarMidpointJd - abhijitHalfDayFrac).toISOString();
  const abhijitEnd = jdToUtcDate(solarMidpointJd + abhijitHalfDayFrac).toISOString();

  const luxWd = DateTime.fromJSDate(sunriseUtcDate, { zone: 'utc' }).setZone(tz).weekday;
  const jsWeekday = luxWd === 7 ? 0 : luxWd;

  const ayanamsaMode = input.ayanamsaMode ?? 'lahiri';
  const moonLon = chartSource.moonSiderealLongitudeUtc(sunriseUtcDate, ayanamsaMode);
  const sunLon = chartSource.sunSiderealLongitudeUtc(sunriseUtcDate, ayanamsaMode);

  const tithi = computeTithi(moonLon, sunLon);
  const yoga = computeYoga(sunLon, moonLon);
  const nakshatra = computeNakshatraSnapshot(moonLon);
  const rahuKalam = computeRahuKalam(jsWeekday, sunriseJd, sunsetJd);

  const lagnaOpt = input.lagna?.trim();
  const lagnaForMatrix = lagnaOpt && lagnaOpt.length > 0 ? lagnaOpt : undefined;
  const horas = computeHoraTimeline({ jsWeekday, sunriseJd, sunsetJd, nextSunriseJd, lagna: lagnaForMatrix });

  return {
    date: input.date,
    timezone: tz,
    latitude: input.latitude,
    longitude: input.longitude,
    reference: { label: 'sunrise', instantUtc: sunriseUtcDate.toISOString() },
    sun: { siderealLongitudeDeg: Number(sunLon.toFixed(6)) },
    moon: { siderealLongitudeDeg: Number(moonLon.toFixed(6)) },
    tithi: { index1To30: tithi.index1To30, paksha: tithi.paksha, ordinalName: tithi.ordinalName },
    halfTithi: { index0To59: tithi.karana.index0To59, elongationDeg: tithi.elongationDeg },
    yoga: { index0To26: yoga.index0To26, name: yoga.name, sumSiderealDeg: yoga.sumSiderealDeg },
    nakshatra: { name: nakshatra.name, index0To26: nakshatra.index0To26, pada1To4: nakshatra.pada1To4 },
    sunrise: { instantUtc: sunriseUtcDate.toISOString(), julianDay: sunriseJd },
    sunset: { instantUtc: sunsetUtcDate.toISOString(), julianDay: sunsetJd },
    abhijitStart,
    abhijitEnd,
    maruDirection: rahuKalam.maruDirection,
    ...(nextSunriseJd != null
      ? { nextSunrise: { instantUtc: jdToUtcDate(nextSunriseJd).toISOString(), julianDay: nextSunriseJd } }
      : {}),
    rahuKala: rahuKalam.rahuKala,
    yamagandha: rahuKalam.yamagandha,
    gulika: rahuKalam.gulika,
    dayHoras: horas.dayHoras,
    nightHoras: horas.nightHoras,
    ...(lagnaForMatrix
      ? {
          personalization: {
            lagna: lagnaForMatrix,
            lagnaMatrixKey: resolveLagnaEnglishKey(lagnaForMatrix) ?? null,
          },
        }
      : {}),
    methodology: {
      ephemeris: 'swiss-ephemeris',
      siderealMode: 'lahiri',
      rahuKalaRule: 'eight-equal-parts-of-solar-day-from-sunrise',
      yamagandhaRule: 'eight-equal-parts-of-solar-day-from-sunrise',
      gulikaRule: 'eight-equal-parts-of-solar-day-from-sunrise',
      dayHoraRule: 'twelve-equal-parts-sunrise-to-sunset-chaldean-sequence-from-weekday',
      nightHoraRule:
        'twelve-equal-parts-sunset-to-next-sunrise-chaldean-sequence-continues-after-twelfth-day-hora',
      abhijitRule:
        'forty-eight-minutes-centered-on-apparent-solar-midpoint-jd-mean-of-sunrise-and-sunset-twenty-four-minutes-each-side',
      maruDirectionRule: 'weekday-from-sunrise-local-time-maps-to-fixed-compass-key',
      horaPersonalStatusRule:
        'optional-query-lagna-whole-sign-benefic-malefic-style-matrix-on-chaldean-hora-lord',
      yogaRule: 'sum-of-sidereal-sun-and-moon-longitudes-mod-360-in-27-parts',
      tithiRule: 'sidereal-lunar-solar-elongation-in-twelve-degree-steps',
      disclaimer:
        'Computed almanac-style timings (Litha-like). Not a specific print Litha edition; regional publishers may differ slightly.',
    },
    accuracy: {
      tier: 'ephemeris',
      degraded: false,
      verifiedAgainst: ['Swiss Ephemeris (swisseph) sunrise/sunset + sidereal Sun/Moon longitudes'],
      notes: [
        'Sun/Moon sidereal longitudes and sunrise/sunset/next-sunrise instants are direct Swiss Ephemeris results.',
        'Tithi, yoga, and nakṣatra indices are deterministic arithmetic on those longitudes — see each sub-result for its own accuracy metadata.',
        'Rāhu kāla/Yamagaṇḍa/Gulika and horā lord sequencing are classical-rule weekday lookups layered on top of the real sunrise/sunset window, not independently-derived astronomical facts — see computeRahuKalam/computeHoraTimeline.',
        'Horā personalStatus (favorable/tense/neutral) is a heuristic lagna benefic/malefic table.',
        'This is a computed almanac-style assembly (Litha-like), not a specific print Litha edition; regional publishers may differ slightly.',
        'No prediction or almanac result here should be marketed as "100% accurate" — see ACCURACY.md.',
      ],
    },
  };
}
