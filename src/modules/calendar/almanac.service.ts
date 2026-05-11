import { BadRequestException, Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import {
  CalculationFlag,
  Planet,
  RiseTransitFlag,
  calculateRiseTransitSet,
  dateToJulianDay,
} from '@swisseph/node';
import { okResponse } from '../../common/utils/response.util';
import { ChartService } from '../astrology/services/chart.service';
import { CalendarDayQueryDto } from './dto/calendar-day-query.dto';
import { getHoraFavorability, resolveLagnaEnglishKey } from './jyotisha-hora-lagna';

/** 1-based Rāhu-kāla segment index (of 8) for JS weekday Sun=0 … Sat=6 (common Vedic table). */
const RAHU_SLOT_BY_JS_WEEKDAY = [8, 2, 7, 5, 4, 6, 3] as const;

/** Yamagaṇḍa — segment 1–8 within sunrise→sunset (Sun=0 … Sat=6). */
const YAMA_SLOT_BY_JS_WEEKDAY = [5, 4, 3, 2, 1, 7, 6] as const;

/** Gulika — segment 1–8 within sunrise→sunset (Sun=0 … Sat=6). */
const GULI_SLOT_BY_JS_WEEKDAY = [6, 5, 4, 3, 2, 1, 7] as const;

/** First daytime horā lord (Chaldean sequence index 0…6) for JS weekday Sun=0 … Sat=6. */
const FIRST_DAY_HORA_LORD_IDX: readonly number[] = [0, 3, 6, 2, 5, 1, 4];

const CHALDEAN_LORDS = ['Sun', 'Venus', 'Mercury', 'Moon', 'Saturn', 'Jupiter', 'Mars'] as const;

/** Maru direction (English key) by JS weekday Sun=0 … Sat=6 — Litha-style table. */
const MARU_DIRECTION_BY_JS_WEEKDAY = [
  'North',
  'NorthWest',
  'West',
  'SouthWest',
  'South',
  'SouthEast',
  'East',
] as const;

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

type CachedEnvelope = ReturnType<typeof okResponse>;

@Injectable()
export class AlmanacService {
  private readonly cache = new Map<string, { expiresAt: number; payload: CachedEnvelope }>();
  private readonly cacheTtlMs = 6 * 60 * 60 * 1000;
  private readonly cacheMaxEntries = 512;

  constructor(private readonly chartService: ChartService) {}

  computeDay(dto: CalendarDayQueryDto) {
    const key = this.cacheKey(dto);
    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > now) {
      return hit.payload;
    }

    const payload = this.computeDayUncached(dto);
    this.pruneCache(now);
    if (this.cache.size >= this.cacheMaxEntries) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(key, { expiresAt: now + this.cacheTtlMs, payload });
    return payload;
  }

  private computeDayUncached(dto: CalendarDayQueryDto) {
    const tz = dto.timezone.trim();
    if (!this.isValidIanaZone(tz)) {
      throw new BadRequestException('Invalid or unsupported IANA timezone.');
    }

    const localMidnight = DateTime.fromISO(`${dto.date}T00:00:00`, { zone: tz });
    if (!localMidnight.isValid) {
      throw new BadRequestException('Invalid calendar date for the given timezone.');
    }

    const jdMidnight = dateToJulianDay(localMidnight.toUTC().toJSDate());
    const lat = dto.latitude;
    const lon = dto.longitude;
    const altM = 0;

    let sunriseJd: number;
    let sunsetJd: number;
    let nextSunriseJd: number | null = null;
    try {
      const rise = calculateRiseTransitSet(
        jdMidnight,
        Planet.Sun,
        RiseTransitFlag.Rise,
        lon,
        lat,
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
        lon,
        lat,
        altM,
        CalculationFlag.SwissEphemeris,
      );
      sunsetJd = set.time;
      if (!Number.isFinite(sunsetJd) || sunsetJd <= sunriseJd) {
        throw new Error('invalid sunset');
      }
      try {
        const nextRise = calculateRiseTransitSet(
          sunsetJd + 1e-6,
          Planet.Sun,
          RiseTransitFlag.Rise,
          lon,
          lat,
          altM,
          CalculationFlag.SwissEphemeris,
        );
        if (Number.isFinite(nextRise.time) && nextRise.time > sunsetJd + 1e-8) {
          nextSunriseJd = nextRise.time;
        }
      } catch {
        nextSunriseJd = null;
      }
    } catch {
      throw new BadRequestException(
        'Could not compute sunrise/sunset for this date and location (polar day/night or ephemeris error).',
      );
    }

    const sunriseUtc = this.jdToUtcDate(sunriseJd);
    const sunsetUtc = this.jdToUtcDate(sunsetJd);
    const dayFrac = sunsetJd - sunriseJd;

    /** Apparent solar midpoint (JD); used for Abhijit window. */
    const solarMidpointJd = (sunriseJd + sunsetJd) / 2;
    const abhijitHalfDayFrac = 24 / (24 * 60);
    const abhijitStartJd = solarMidpointJd - abhijitHalfDayFrac;
    const abhijitEndJd = solarMidpointJd + abhijitHalfDayFrac;
    const abhijitStart = this.jdToUtcDate(abhijitStartJd).toISOString();
    const abhijitEnd = this.jdToUtcDate(abhijitEndJd).toISOString();

    const luxWd = DateTime.fromJSDate(sunriseUtc, { zone: 'utc' }).setZone(tz).weekday;
    const jsWeekday = luxWd === 7 ? 0 : luxWd;
    const maruDirection = MARU_DIRECTION_BY_JS_WEEKDAY[jsWeekday] ?? 'North';
    const rahuSlot = RAHU_SLOT_BY_JS_WEEKDAY[jsWeekday];
    const yamaSlot = YAMA_SLOT_BY_JS_WEEKDAY[jsWeekday];
    const guliSlot = GULI_SLOT_BY_JS_WEEKDAY[jsWeekday];

    const moonLon = this.chartService.moonSiderealLongitudeUtc(sunriseUtc, 'lahiri');
    const sunLon = this.chartService.sunSiderealLongitudeUtc(sunriseUtc, 'lahiri');
    const elong = this.norm360(moonLon - sunLon);
    const tithiIndex = Math.min(29, Math.floor(elong / 12));
    const paksha: 'shukla' | 'krishna' = tithiIndex < 15 ? 'shukla' : 'krishna';
    const ordinalIndex = tithiIndex % 15;
    const tithiOrdinal =
      ordinalIndex === 14 ? (paksha === 'shukla' ? 'Purnima' : 'Amavasya') : TITHI_ORDINAL[ordinalIndex];
    const tithiNumber = tithiIndex + 1;

    const halfTithiIndex0To59 = Math.min(59, Math.floor(elong / 6));

    const yogaSum = this.norm360(sunLon + moonLon);
    const yogaArc = 360 / 27;
    const yogaIdx = Math.floor(yogaSum / yogaArc);
    const yogaName = YOGA_NAMES[yogaIdx] ?? YOGA_NAMES[0];

    const nakName = this.chartService.nakshatraNameFromMoonLongitude(moonLon);
    const moonNorm = this.norm360(moonLon);
    const nakArc = 360 / 27;
    const nakIdx = Math.floor(moonNorm / nakArc);
    const posInNak = moonNorm % nakArc;
    const pada = Math.min(4, Math.floor(posInNak / (nakArc / 4)) + 1);

    const rahuk = this.segmentUtc(sunriseJd, dayFrac, rahuSlot);
    const yamac = this.segmentUtc(sunriseJd, dayFrac, yamaSlot);
    const gulic = this.segmentUtc(sunriseJd, dayFrac, guliSlot);

    const lagnaOpt = dto.lagna?.trim();
    const lagnaForMatrix = lagnaOpt && lagnaOpt.length > 0 ? lagnaOpt : undefined;

    const firstHoraIdx = FIRST_DAY_HORA_LORD_IDX[jsWeekday] ?? 0;
    const horaFrac = dayFrac / 12;
    const dayHoras = Array.from({ length: 12 }, (_, i) => {
      const lord = CHALDEAN_LORDS[(firstHoraIdx + i) % 7];
      const s = sunriseJd + i * horaFrac;
      const e = sunriseJd + (i + 1) * horaFrac;
      return {
        index1To12: i + 1,
        lord,
        phase: 'day' as const,
        personalStatus: getHoraFavorability(lord, lagnaForMatrix),
        startUtc: this.jdToUtcDate(s).toISOString(),
        endUtc: this.jdToUtcDate(e).toISOString(),
      };
    });

    let nightHoras: {
      index1To12: number;
      lord: (typeof CHALDEAN_LORDS)[number];
      phase: 'night';
      startUtc: string;
      endUtc: string;
    }[] = [];
    if (nextSunriseJd != null) {
      const nightFrac = nextSunriseJd - sunsetJd;
      const firstNightIdx = (firstHoraIdx + 12) % 7;
      const nhFrac = nightFrac / 12;
      nightHoras = Array.from({ length: 12 }, (_, i) => {
        const lord = CHALDEAN_LORDS[(firstNightIdx + i) % 7];
        const s = sunsetJd + i * nhFrac;
        const e = sunsetJd + (i + 1) * nhFrac;
        return {
          index1To12: i + 1,
          lord,
          phase: 'night' as const,
          personalStatus: getHoraFavorability(lord, lagnaForMatrix),
          startUtc: this.jdToUtcDate(s).toISOString(),
          endUtc: this.jdToUtcDate(e).toISOString(),
        };
      });
    }

    return okResponse(
      {
        date: dto.date,
        timezone: tz,
        latitude: lat,
        longitude: lon,
        reference: {
          label: 'sunrise',
          instantUtc: sunriseUtc.toISOString(),
        },
        sun: {
          siderealLongitudeDeg: Number(sunLon.toFixed(6)),
        },
        moon: {
          siderealLongitudeDeg: Number(moonLon.toFixed(6)),
        },
        tithi: {
          index1To30: tithiNumber,
          paksha,
          ordinalName: tithiOrdinal,
        },
        /** Sixth-part of a tithi (1/60 of synodic rotation); karana names vary by tradition — index is stable. */
        halfTithi: {
          index0To59: halfTithiIndex0To59,
          elongationDeg: Number(elong.toFixed(4)),
        },
        yoga: {
          index0To26: yogaIdx,
          name: yogaName,
          sumSiderealDeg: Number(yogaSum.toFixed(6)),
        },
        nakshatra: {
          name: nakName,
          index0To26: nakIdx,
          pada1To4: pada,
        },
        sunrise: { instantUtc: sunriseUtc.toISOString(), julianDay: sunriseJd },
        sunset: { instantUtc: sunsetUtc.toISOString(), julianDay: sunsetJd },
        // Abhijit: 48 min centered on (sunrise+sunset)/2 in JD; ±24 min.
        abhijitStart,
        abhijitEnd,
        // Maru diśā from local weekday at sunrise (Litha-style table).
        maruDirection,
        ...(nextSunriseJd != null
          ? {
              nextSunrise: {
                instantUtc: this.jdToUtcDate(nextSunriseJd).toISOString(),
                julianDay: nextSunriseJd,
              },
            }
          : {}),
        rahuKala: {
          slot1To8: rahuSlot,
          startUtc: rahuk.startUtc,
          endUtc: rahuk.endUtc,
        },
        yamagandha: {
          slot1To8: yamaSlot,
          startUtc: yamac.startUtc,
          endUtc: yamac.endUtc,
        },
        gulika: {
          slot1To8: guliSlot,
          startUtc: gulic.startUtc,
          endUtc: gulic.endUtc,
        },
        /** Twelve equal daytime horā from sunrise → sunset; lords follow Chaldean order from weekday first lord. */
        dayHoras,
        /** Twelve night horā from sunset → next sunrise (same location); Chaldean sequence continues after the 12th day horā. */
        nightHoras,
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
      },
      'Calendar day almanac computed',
    );
  }

  private segmentUtc(
    sunriseJd: number,
    dayFrac: number,
    slot1To8: number,
  ): { startUtc: string; endUtc: string } {
    const s = sunriseJd + ((slot1To8 - 1) / 8) * dayFrac;
    const e = sunriseJd + (slot1To8 / 8) * dayFrac;
    return {
      startUtc: this.jdToUtcDate(s).toISOString(),
      endUtc: this.jdToUtcDate(e).toISOString(),
    };
  }

  private cacheKey(dto: CalendarDayQueryDto): string {
    const lat = Number(dto.latitude.toFixed(4));
    const lon = Number(dto.longitude.toFixed(4));
    const lagna = (dto.lagna ?? '').trim();
    return `${dto.date}|${dto.timezone.trim()}|${lat}|${lon}|${lagna}`;
  }

  private pruneCache(now: number): void {
    for (const [k, v] of this.cache) {
      if (v.expiresAt <= now) this.cache.delete(k);
    }
  }

  private jdToUtcDate(jd: number): Date {
    return new Date((jd - 2440587.5) * 86400000);
  }

  private norm360(value: number): number {
    const n = value % 360;
    return n < 0 ? n + 360 : n;
  }

  private isValidIanaZone(zone: string): boolean {
    const z = zone.trim();
    if (!z) return false;
    return DateTime.now().setZone(z).isValid;
  }
}
