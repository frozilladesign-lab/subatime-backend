import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createRequire } from 'module';
import { DateTime } from 'luxon';

/** Full TZ polygon DB (`geo-tz/all`) — historical DST; loaded via require for TS `moduleResolution: node`. */
const geoTzFindAt: (lat: number, lon: number) => string[] = (
  createRequire(__dirname)('geo-tz/all') as { find: (lat: number, lon: number) => string[] }
).find;
import {
  CalculationFlag,
  LunarPoint,
  Planet,
  SiderealMode,
  calculateHouses,
  calculatePosition,
  close,
  dateToJulianDay,
  getAyanamsa,
  HouseSystem,
  setSiderealMode,
  setTopocentric,
} from '@swisseph/node';
import { GenerateChartDto } from '../dto/astrology.dto';

/** 12 Nirayana rāśi names (whole signs); used for Janma Rāśi etc. */
export const SIDEREAL_SIGNS = [
  'Mesha',
  'Vrishabha',
  'Mithuna',
  'Karka',
  'Simha',
  'Kanya',
  'Tula',
  'Vrischika',
  'Dhanu',
  'Makara',
  'Kumbha',
  'Meena',
] as const;

export const NAKSHATRA_LIST = [
  'Ashwini',
  'Bharani',
  'Krittika',
  'Rohini',
  'Mrigashira',
  'Ardra',
  'Punarvasu',
  'Pushya',
  'Ashlesha',
  'Magha',
  'Purva Phalguni',
  'Uttara Phalguni',
  'Hasta',
  'Chitra',
  'Swati',
  'Vishakha',
  'Anuradha',
  'Jyeshtha',
  'Mula',
  'Purva Ashadha',
  'Uttara Ashadha',
  'Shravana',
  'Dhanishta',
  'Shatabhisha',
  'Purva Bhadrapada',
  'Uttara Bhadrapada',
  'Revati',
] as const;

const NAKSHATRA_LORDS = ['Ketu', 'Venus', 'Sun', 'Moon', 'Mars', 'Rahu', 'Jupiter', 'Saturn', 'Mercury'] as const;

const MAHADASHA_YEARS: Record<(typeof NAKSHATRA_LORDS)[number], number> = {
  Ketu: 7,
  Venus: 20,
  Sun: 6,
  Moon: 10,
  Mars: 7,
  Rahu: 18,
  Jupiter: 16,
  Saturn: 19,
  Mercury: 17,
};

type PlanetName = 'sun' | 'moon' | 'mars' | 'mercury' | 'jupiter' | 'venus' | 'saturn' | 'rahu' | 'ketu';
type PlanetaryData = Record<PlanetName, string>;
type PlanetLongitudes = Record<PlanetName, number>;

export type AspectHit = {
  from: PlanetName;
  to: PlanetName;
  /** Canonical angle matched (0, 60, 90, 120, 180). */
  aspect: number;
  /** True smallest geocentric separation in degrees (0–180). */
  separation: number;
};

export type PlanetaryStrength = Record<PlanetName, number>;

/** How birth local time was turned into UTC for the ephemeris. */
export type BirthTimeResolution = 'iana-local' | 'utc-wallclock-fallback';

export type BirthMomentUtc = {
  utc: Date;
  /** IANA zone used when resolution is iana-local (e.g. Asia/Colombo). */
  zoneUsed: string;
  resolution: BirthTimeResolution;
};

@Injectable()
export class ChartService implements OnModuleDestroy {
  private readonly logger = new Logger(ChartService.name);

  onModuleDestroy(): void {
    try {
      close();
    } catch {
      /* noop */
    }
  }

  generate(dto: GenerateChartDto): {
    lagna: string;
    nakshatra: string;
    planetaryData: PlanetaryData;
    chartData: Record<string, unknown>;
  } {
    const coordinates = this.resolveCoordinates(dto.birthPlace, dto.latitude, dto.longitude);
    const birthMoment = this.toUtcBirthMoment(
      dto.birthDate,
      dto.birthTime,
      coordinates.lat,
      coordinates.lon,
      dto.birthPlace,
      dto.timezone,
    );

    if (process.env.CHART_ENGINE === 'legacy') {
      return this.generateLegacy(dto, birthMoment.utc, coordinates, birthMoment);
    }

    try {
      return this.generateSwiss(dto, birthMoment.utc, coordinates, birthMoment);
    } catch (err) {
      this.logger.warn(`Swiss Ephemeris chart failed, using legacy engine: ${String(err)}`);
      return this.generateLegacy(dto, birthMoment.utc, coordinates, birthMoment);
    }
  }

  /**
   * Sidereal lunar longitude (deg 0–360) at UTC instant.
   * Geocentric Swiss Ephemeris when available; otherwise legacy approximation.
   */
  moonSiderealLongitudeUtc(dateUtc: Date, ayanamsaMode?: string): number {
    if (process.env.CHART_ENGINE === 'legacy') {
      return this.moonSiderealLongitudeLegacy(dateUtc, ayanamsaMode);
    }
    try {
      const sidMode =
        ayanamsaMode === 'krishnamurti' ? SiderealMode.Krishnamurti : SiderealMode.Lahiri;
      setSiderealMode(sidMode);
      setTopocentric(0, 0, 0);
      const jd = dateToJulianDay(dateUtc);
      const flags =
        CalculationFlag.SwissEphemeris | CalculationFlag.Speed | CalculationFlag.Sidereal;
      return this.normalize(calculatePosition(jd, Planet.Moon, flags).longitude);
    } catch {
      return this.moonSiderealLongitudeLegacy(dateUtc, ayanamsaMode);
    }
  }

  /** Sidereal solar longitude (0–360°) at UTC instant; matches chart engine / ayanamsa choice. */
  sunSiderealLongitudeUtc(dateUtc: Date, ayanamsaMode?: string): number {
    if (process.env.CHART_ENGINE === 'legacy') {
      const ayanamsa = this.computeAyanamsa(dateUtc, ayanamsaMode);
      return this.computeSiderealLongitudes(dateUtc, ayanamsa).sun;
    }
    try {
      const sidMode =
        ayanamsaMode === 'krishnamurti' ? SiderealMode.Krishnamurti : SiderealMode.Lahiri;
      setSiderealMode(sidMode);
      setTopocentric(0, 0, 0);
      const jd = dateToJulianDay(dateUtc);
      const flags =
        CalculationFlag.SwissEphemeris | CalculationFlag.Speed | CalculationFlag.Sidereal;
      return this.normalize(calculatePosition(jd, Planet.Sun, flags).longitude);
    } catch {
      const ayanamsa = this.computeAyanamsa(dateUtc, ayanamsaMode);
      return this.computeSiderealLongitudes(dateUtc, ayanamsa).sun;
    }
  }

  /** Whole nakṣatra name from sidereal Moon longitude (same 27-fold as birth chart). */
  nakshatraNameFromMoonLongitude(moonLongitude: number): string {
    return this.getNakshatra(moonLongitude);
  }

  private moonSiderealLongitudeLegacy(dateUtc: Date, ayanamsaMode?: string): number {
    const d = this.daysSinceJ2000(dateUtc);
    const tropical = this.moonLongitudeTropicalRefined(d);
    const ay = this.computeAyanamsa(dateUtc, ayanamsaMode);
    return this.normalize(tropical - ay);
  }

  private siderealModeFromDto(dto: GenerateChartDto): SiderealMode {
    return dto.ayanamsa === 'krishnamurti' ? SiderealMode.Krishnamurti : SiderealMode.Lahiri;
  }

  private generateSwiss(
    dto: GenerateChartDto,
    birthDate: Date,
    coordinates: { lat: number; lon: number; label: string },
    birthMoment: BirthMomentUtc,
  ): {
    lagna: string;
    nakshatra: string;
    planetaryData: PlanetaryData;
    chartData: Record<string, unknown>;
  } {
    setSiderealMode(this.siderealModeFromDto(dto));
    setTopocentric(coordinates.lon, coordinates.lat, 0);

    const jd = dateToJulianDay(birthDate);
    const flags =
      CalculationFlag.SwissEphemeris |
      CalculationFlag.Speed |
      CalculationFlag.Sidereal |
      CalculationFlag.Topocentric;

    const lon = (body: Planet | LunarPoint) =>
      this.normalize(calculatePosition(jd, body, flags).longitude);

    const rahuLon = lon(LunarPoint.TrueNode);
    const longitudes: PlanetLongitudes = {
      sun: lon(Planet.Sun),
      moon: lon(Planet.Moon),
      mars: lon(Planet.Mars),
      mercury: lon(Planet.Mercury),
      jupiter: lon(Planet.Jupiter),
      venus: lon(Planet.Venus),
      saturn: lon(Planet.Saturn),
      rahu: rahuLon,
      ketu: this.normalize(rahuLon + 180),
    };

    const housesData = calculateHouses(
      jd,
      coordinates.lat,
      coordinates.lon,
      HouseSystem.WholeSign,
    );
    const ayanamsa = getAyanamsa(jd);
    const ascendantLongitude = this.normalize(housesData.ascendant - ayanamsa);
    const mcSidereal = this.normalize(housesData.mc - ayanamsa);

    const lagna = this.getSignName(ascendantLongitude);
    const nakshatra = this.getNakshatra(longitudes.moon);
    const houses = this.computeHouses(ascendantLongitude);
    const planetHouses = this.computePlanetHouses(longitudes, ascendantLongitude);
    const aspects = this.computeAngularAspects(longitudes);
    const dasha = this.computeMahadasha(birthDate, longitudes.moon);
    const planetStrength = this.computePlanetStrength(longitudes);

    const base = {
      lagna,
      nakshatra,
      planetaryData: this.toPlanetarySignMap(longitudes),
      chartData: {
        lagna,
        nakshatra,
        ayanamsa: Number(ayanamsa.toFixed(6)),
        ascendantLongitude: Number(ascendantLongitude.toFixed(6)),
        moonLongitude: Number(longitudes.moon.toFixed(6)),
        mcSidereal: Number(mcSidereal.toFixed(6)),
        julianDay: Number(jd.toFixed(8)),
        houses,
        planetLongitudes: this.roundLongitudes(longitudes),
        planetHouses,
        aspects,
        planetStrength,
        dasha,
        coordinates,
        ayanamsaMode: dto.ayanamsa ?? 'lahiri',
        ephemeris: 'swiss-ephemeris',
        houseSystem: 'whole-sign',
        birthTimeZone: birthMoment.zoneUsed,
        birthTimeResolution: birthMoment.resolution,
      },
    };
    return this.applyOptionalLagnaUserOverride(base, dto.lagnaUserOverride, longitudes);
  }

  private generateLegacy(
    dto: GenerateChartDto,
    birthDate: Date,
    coordinates: { lat: number; lon: number; label: string },
    birthMoment: BirthMomentUtc,
  ): {
    lagna: string;
    nakshatra: string;
    planetaryData: PlanetaryData;
    chartData: Record<string, unknown>;
  } {
    const ayanamsa = this.computeAyanamsa(birthDate, dto.ayanamsa);
    const longitudes = this.computeSiderealLongitudes(birthDate, ayanamsa);
    const ascendantLongitude = this.computeAscendantLongitude(
      birthDate,
      coordinates.lat,
      coordinates.lon,
      ayanamsa,
    );
    const lagna = this.getSignName(ascendantLongitude);
    const nakshatra = this.getNakshatra(longitudes.moon);
    const houses = this.computeHouses(ascendantLongitude);
    const planetHouses = this.computePlanetHouses(longitudes, ascendantLongitude);
    const aspects = this.computeAngularAspects(longitudes);
    const dasha = this.computeMahadasha(birthDate, longitudes.moon);
    const planetStrength = this.computePlanetStrength(longitudes);

    const base = {
      lagna,
      nakshatra,
      planetaryData: this.toPlanetarySignMap(longitudes),
      chartData: {
        lagna,
        nakshatra,
        ayanamsa: Number(ayanamsa.toFixed(4)),
        ascendantLongitude: Number(ascendantLongitude.toFixed(4)),
        moonLongitude: Number(longitudes.moon.toFixed(4)),
        houses,
        planetLongitudes: this.roundLongitudes(longitudes),
        planetHouses,
        aspects,
        planetStrength,
        dasha,
        coordinates,
        ayanamsaMode: dto.ayanamsa ?? 'lahiri',
        ephemeris: 'legacy-mean-orbit',
        birthTimeZone: birthMoment.zoneUsed,
        birthTimeResolution: birthMoment.resolution,
      },
    };
    return this.applyOptionalLagnaUserOverride(base, dto.lagnaUserOverride, longitudes);
  }

  /**
   * When the user confirms a different whole-sign rising, rotate sidereal ascendant longitude by N×30°
   * and recompute whole-sign houses + planet house numbers (planet longitudes unchanged).
   */
  private applyOptionalLagnaUserOverride(
    base: {
      lagna: string;
      nakshatra: string;
      planetaryData: PlanetaryData;
      chartData: Record<string, unknown>;
    },
    overrideRaw: string | undefined,
    longitudes: PlanetLongitudes,
  ): {
    lagna: string;
    nakshatra: string;
    planetaryData: PlanetaryData;
    chartData: Record<string, unknown>;
  } {
    const raw = overrideRaw?.trim();
    if (!raw) return base;
    if (!SIDEREAL_SIGNS.includes(raw as (typeof SIDEREAL_SIGNS)[number])) return base;
    const canon = raw as (typeof SIDEREAL_SIGNS)[number];
    const curr = base.lagna.trim();
    if (!SIDEREAL_SIGNS.includes(curr as (typeof SIDEREAL_SIGNS)[number])) return base;
    const currSign = curr as (typeof SIDEREAL_SIGNS)[number];
    if (currSign === canon) return base;
    const ascRaw = base.chartData['ascendantLongitude'];
    const ascLon = typeof ascRaw === 'number' ? ascRaw : Number(ascRaw);
    if (!Number.isFinite(ascLon)) return base;
    const currIdx = SIDEREAL_SIGNS.indexOf(currSign);
    const targetIdx = SIDEREAL_SIGNS.indexOf(canon);
    const shift = (targetIdx - currIdx + 12) % 12;
    const newAsc = this.normalize(ascLon + shift * 30);
    const houses = this.computeHouses(newAsc);
    const planetHouses = this.computePlanetHouses(longitudes, newAsc);
    const lagna = this.getSignName(newAsc);
    const decimals = (base.chartData['ephemeris'] as string | undefined)?.includes('swiss') ? 6 : 4;
    const roundAsc = Number(newAsc.toFixed(decimals));
    return {
      lagna,
      nakshatra: base.nakshatra,
      planetaryData: base.planetaryData,
      chartData: {
        ...base.chartData,
        lagna,
        ascendantLongitude: roundAsc,
        houses,
        planetHouses,
        lagnaUserOverride: canon,
        computedLagna: base.lagna,
      },
    };
  }

  /**
   * Birth date + clock time interpreted in an IANA zone (historical offsets via Luxon), then UTC.
   * Sri Lanka: Asia/Colombo includes civil-time history (e.g. UTC+6 until Apr 2006 alignment with IST).
   * Set CHART_TIMEZONE_SKIP=1 to force legacy UTC wall clock.
   */
  private toUtcBirthMoment(
    birthDate: string,
    birthTime: string,
    lat: number,
    lon: number,
    birthPlace?: string,
    explicitTimezone?: string,
  ): BirthMomentUtc {
    if (process.env.CHART_TIMEZONE_SKIP === '1') {
      return {
        utc: this.toDateUtcWallClock(birthDate, birthTime),
        zoneUsed: 'UTC',
        resolution: 'utc-wallclock-fallback',
      };
    }

    const ymd = this.parseYmd(birthDate);
    if (!ymd) {
      return {
        utc: new Date(`${birthDate}T00:00:00Z`),
        zoneUsed: 'UTC',
        resolution: 'utc-wallclock-fallback',
      };
    }

    const zone = this.resolveBirthIanaZone(lat, lon, birthPlace, explicitTimezone);

    const [y, mo, d] = ymd;
    const [h, mi, s] = this.normalizeTimeParts(birthTime);
    const local = DateTime.fromObject(
      { year: y, month: mo, day: d, hour: h, minute: mi, second: s },
      { zone },
    );

    if (!local.isValid) {
      this.logger.warn(
        `Invalid birth datetime in ${zone}: ${local.invalidReason ?? 'unknown'}; using UTC wall clock`,
      );
      return {
        utc: this.toDateUtcWallClock(birthDate, birthTime),
        zoneUsed: 'UTC',
        resolution: 'utc-wallclock-fallback',
      };
    }

    return {
      utc: local.toUTC().toJSDate(),
      zoneUsed: zone,
      resolution: 'iana-local',
    };
  }

  private isValidLuxonZone(zone: string): boolean {
    const z = zone.trim();
    if (!z) return false;
    return DateTime.fromObject(
      { year: 2000, month: 6, day: 15, hour: 12, minute: 0 },
      { zone: z },
    ).isValid;
  }

  /** Rough Sri Lanka footprint: place text or island bounding box. */
  private isLikelySriLankaBirth(lat: number, lon: number, birthPlace?: string): boolean {
    const p = (birthPlace ?? '').toLowerCase();
    if (/\bsri[\s-]*lanka\b/.test(p) || p.includes('srilanka') || p.includes('ceylon')) return true;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    return lat >= 5.72 && lat <= 10.03 && lon >= 79.43 && lon <= 82.09;
  }

  /**
   * Prefer stored profile timezone; otherwise geo-tz. Sri Lankan births mapped away from
   * Asia/Kolkata when coordinates/text indicate the island (India-standard mistake).
   */
  private resolveBirthIanaZone(
    lat: number,
    lon: number,
    birthPlace: string | undefined,
    explicitTimezone: string | undefined,
  ): string {
    const sl = this.isLikelySriLankaBirth(lat, lon, birthPlace);

    const preferColomboIfIndiaMislabeled = (z: string): string => {
      if (!sl) return z;
      if (z === 'Asia/Kolkata' || z === 'Asia/Calcutta') return 'Asia/Colombo';
      return z;
    };

    const trimmed = explicitTimezone?.trim();
    if (trimmed && this.isValidLuxonZone(trimmed)) {
      return preferColomboIfIndiaMislabeled(trimmed);
    }

    try {
      const zones = geoTzFindAt(lat, lon);
      if (zones.length > 0) {
        return preferColomboIfIndiaMislabeled(zones[0]);
      }
      if (!sl) {
        this.logger.warn(`geo-tz: no IANA zone for lat=${lat} lon=${lon}; using UTC`);
      }
    } catch (e) {
      this.logger.warn(`geo-tz lookup failed (${String(e)})`);
    }

    if (sl) return 'Asia/Colombo';

    return 'UTC';
  }

  /** Legacy: treat components as UTC (previous behavior). */
  private toDateUtcWallClock(birthDate: string, birthTime: string): Date {
    const timePart = birthTime.length <= 5 ? `${birthTime}:00` : birthTime;
    const date = new Date(`${birthDate}T${timePart}Z`);
    return Number.isNaN(date.getTime()) ? new Date(`${birthDate}T00:00:00Z`) : date;
  }

  private parseYmd(s: string): [number, number, number] | null {
    const parts = s.trim().split('-').map((x) => Number(x.trim()));
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
    return [parts[0], parts[1], parts[2]];
  }

  private normalizeTimeParts(birthTime: string): [number, number, number] {
    const raw = birthTime.trim();
    const withSecs = raw.length <= 5 ? `${raw}:00` : raw;
    const seg = withSecs.split(':').map((x) => Number(String(x).trim()));
    const h = Number.isFinite(seg[0]) ? Math.min(23, Math.max(0, Math.trunc(seg[0]))) : 0;
    const m = Number.isFinite(seg[1]) ? Math.min(59, Math.max(0, Math.trunc(seg[1]))) : 0;
    const s = Number.isFinite(seg[2]) ? Math.min(59, Math.max(0, Math.trunc(seg[2]))) : 0;
    return [h, m, s];
  }

  private resolveCoordinates(
    place: string,
    latitude?: number,
    longitude?: number,
  ): { lat: number; lon: number; label: string } {
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return { lat: Number(latitude), lon: Number(longitude), label: place || 'Custom' };
    }
    if (place.includes(',')) {
      const [latRaw, lonRaw] = place.split(',').map((v) => Number(v.trim()));
      if (Number.isFinite(latRaw) && Number.isFinite(lonRaw)) {
        return { lat: latRaw, lon: lonRaw, label: 'Parsed Coordinates' };
      }
    }
    const city = place.trim().toLowerCase();
    const locations: Record<string, { lat: number; lon: number; label: string }> = {
      colombo: { lat: 6.9271, lon: 79.8612, label: 'Colombo' },
      kandy: { lat: 7.2906, lon: 80.6337, label: 'Kandy' },
      galle: { lat: 6.0535, lon: 80.221, label: 'Galle' },
      matara: { lat: 5.9549, lon: 80.555, label: 'Matara' },
      kurunegala: { lat: 7.4863, lon: 80.3647, label: 'Kurunegala' },
      jaffna: { lat: 9.6615, lon: 80.0255, label: 'Jaffna' },
      negombo: { lat: 7.2084, lon: 79.8358, label: 'Negombo' },
      ratnapura: { lat: 6.6828, lon: 80.3992, label: 'Ratnapura' },
    };
    return locations[city] ?? { lat: 6.9271, lon: 79.8612, label: place || 'Colombo' };
  }

  private computeAyanamsa(date: Date, mode?: string): number {
    const lahiri = this.computeLahiriAyanamsa(date);
    if (mode === 'krishnamurti') return lahiri - 0.1;
    return lahiri;
  }

  private computeLahiriAyanamsa(date: Date): number {
    const year = date.getUTCFullYear() + (date.getUTCMonth() + 1) / 12;
    return 24.0 + (year - 2000) * 0.014;
  }

  /** Meeus-style short-period corrections on mean lunar longitude (tropical, deg). */
  private moonLongitudeTropicalRefined(d: number): number {
    let L = 218.3165 + 13.176396 * d;
    const Mm = 134.9634 + 13.064992953 * d;
    const D = 297.8501921 + 12.190749 * d;
    const r = (deg: number) => (deg * Math.PI) / 180;
    L +=
      6.288774 * Math.sin(r(Mm)) +
      1.274027 * Math.sin(r(2 * D - Mm)) +
      0.658314 * Math.sin(r(2 * D)) +
      0.213616 * Math.sin(r(2 * Mm)) -
      0.185596 * Math.sin(r(D));
    return this.normalize(L);
  }

  private computeSiderealLongitudes(date: Date, ayanamsa: number): PlanetLongitudes {
    const d = this.daysSinceJ2000(date);
    const tropical = {
      sun: this.normalize(280.4665 + 0.98564736 * d),
      moon: this.moonLongitudeTropicalRefined(d),
      mars: this.normalize(355.433 + 0.524039 * d),
      mercury: this.normalize(252.251 + 4.09233445 * d),
      jupiter: this.normalize(34.351 + 0.083091 * d),
      venus: this.normalize(181.9798 + 1.60213034 * d),
      saturn: this.normalize(50.0774 + 0.03345965 * d),
      rahu: this.normalize(125.0445 - 0.0529539 * d),
    };
    const siderealRahu = this.normalize(tropical.rahu - ayanamsa);
    return {
      sun: this.normalize(tropical.sun - ayanamsa),
      moon: this.normalize(tropical.moon - ayanamsa),
      mars: this.normalize(tropical.mars - ayanamsa),
      mercury: this.normalize(tropical.mercury - ayanamsa),
      jupiter: this.normalize(tropical.jupiter - ayanamsa),
      venus: this.normalize(tropical.venus - ayanamsa),
      saturn: this.normalize(tropical.saturn - ayanamsa),
      rahu: siderealRahu,
      ketu: this.normalize(siderealRahu + 180),
    };
  }

  private computeAscendantLongitude(date: Date, latDeg: number, lonDeg: number, ayanamsa: number): number {
    const jd = this.julianDate(date);
    const t = (jd - 2451545.0) / 36525.0;
    const gmst =
      280.46061837 +
      360.98564736629 * (jd - 2451545) +
      0.000387933 * t * t -
      (t * t * t) / 38710000;
    const lst = this.normalize(gmst + lonDeg);
    const epsilon = 23.4392911 - 0.0130042 * t;
    const theta = this.toRadians(lst);
    const phi = this.toRadians(latDeg);
    const eps = this.toRadians(epsilon);
    const numerator = Math.sin(theta) * Math.cos(eps) + Math.tan(phi) * Math.sin(eps);
    const denominator = Math.cos(theta);
    const ascTropical = this.normalize(this.toDegrees(Math.atan2(numerator, denominator)));
    return this.normalize(ascTropical - ayanamsa);
  }

  private computeHouses(ascendantLongitude: number): Record<string, string> {
    const houses: Record<string, string> = {};
    for (let i = 0; i < 12; i++) {
      const start = this.normalize(ascendantLongitude + i * 30);
      houses[`house${i + 1}`] = this.getSignName(start);
    }
    return houses;
  }

  private computePlanetHouses(longitudes: PlanetLongitudes, ascendantLongitude: number): Record<PlanetName, number> {
    const result = {} as Record<PlanetName, number>;
    (Object.keys(longitudes) as PlanetName[]).forEach((planet) => {
      const rel = this.normalize(longitudes[planet] - ascendantLongitude);
      result[planet] = Math.floor(rel / 30) + 1;
    });
    return result;
  }

  private smallestArcDeg(a: number, b: number): number {
    let d = Math.abs(this.normalize(a) - this.normalize(b)) % 360;
    if (d > 180) d = 360 - d;
    return d;
  }

  /** Major aspects by true longitude separation (not whole-sign house offsets). */
  private computeAngularAspects(longitudes: PlanetLongitudes): AspectHit[] {
    const targets: { angle: number; orb: number }[] = [
      { angle: 0, orb: 9 },
      { angle: 60, orb: 6 },
      { angle: 90, orb: 6 },
      { angle: 120, orb: 6 },
      { angle: 180, orb: 8 },
    ];
    const planets = Object.keys(longitudes) as PlanetName[];
    const hits: AspectHit[] = [];
    for (let i = 0; i < planets.length; i++) {
      for (let j = i + 1; j < planets.length; j++) {
        const from = planets[i];
        const to = planets[j];
        const sep = this.smallestArcDeg(longitudes[from], longitudes[to]);
        for (const { angle, orb } of targets) {
          if (Math.abs(sep - angle) <= orb) {
            hits.push({
              from,
              to,
              aspect: angle,
              separation: Number(sep.toFixed(4)),
            });
            break;
          }
        }
      }
    }
    return hits;
  }

  private readonly EXALT: Partial<Record<PlanetName, (typeof SIDEREAL_SIGNS)[number]>> = {
    sun: 'Mesha',
    moon: 'Vrishabha',
    mars: 'Makara',
    mercury: 'Kanya',
    jupiter: 'Karka',
    venus: 'Meena',
    saturn: 'Tula',
    rahu: 'Vrishabha',
    ketu: 'Vrischika',
  };

  private readonly DEBIL: Partial<Record<PlanetName, (typeof SIDEREAL_SIGNS)[number]>> = {
    sun: 'Tula',
    moon: 'Vrischika',
    mars: 'Karka',
    mercury: 'Meena',
    jupiter: 'Makara',
    venus: 'Kanya',
    saturn: 'Mesha',
    rahu: 'Vrischika',
    ketu: 'Vrishabha',
  };

  private readonly OWN_SIGNS: Record<PlanetName, (typeof SIDEREAL_SIGNS)[number][]> = {
    sun: ['Simha'],
    moon: ['Karka'],
    mars: ['Mesha', 'Vrischika'],
    mercury: ['Mithuna', 'Kanya'],
    jupiter: ['Dhanu', 'Meena'],
    venus: ['Vrishabha', 'Tula'],
    saturn: ['Makara', 'Kumbha'],
    rahu: ['Mithuna', 'Kumbha'],
    ketu: ['Dhanu', 'Vrischika'],
  };

  /** 0–1 crude strength (exaltation / own / neutral / debilitation). */
  private computePlanetStrength(longitudes: PlanetLongitudes): PlanetaryStrength {
    const out = {} as PlanetaryStrength;
    (Object.keys(longitudes) as PlanetName[]).forEach((p) => {
      const sign = this.getSignName(longitudes[p]);
      if (this.EXALT[p] === sign) out[p] = 1;
      else if (this.DEBIL[p] === sign) out[p] = 0.25;
      else if (this.OWN_SIGNS[p]?.includes(sign as (typeof SIDEREAL_SIGNS)[number])) out[p] = 0.85;
      else out[p] = 0.55;
    });
    return out;
  }

  private computeMahadasha(birthDate: Date, moonLongitude: number): Record<string, unknown> {
    const nakIdx = Math.floor(moonLongitude / (360 / 27));
    const nakLord = NAKSHATRA_LORDS[nakIdx % 9];
    const nakStart = nakIdx * (360 / 27);
    const progress = (moonLongitude - nakStart) / (360 / 27);
    const firstFullYears = MAHADASHA_YEARS[nakLord];
    const firstRemaining = firstFullYears * (1 - progress);
    const elapsedYears = (Date.now() - birthDate.getTime()) / (1000 * 60 * 60 * 24 * 365.2425);

    let remaining = firstRemaining;
    let current = nakLord;
    let cursor = (nakIdx % 9 + 1) % 9;
    let ageTracker = elapsedYears;

    while (ageTracker > remaining) {
      ageTracker -= remaining;
      current = NAKSHATRA_LORDS[cursor];
      remaining = MAHADASHA_YEARS[current];
      cursor = (cursor + 1) % 9;
    }

    const next = NAKSHATRA_LORDS[cursor];
    return {
      current,
      yearsRemaining: Number((remaining - ageTracker).toFixed(2)),
      next,
      sequenceStart: nakLord,
    };
  }

  private toPlanetarySignMap(longitudes: PlanetLongitudes): PlanetaryData {
    return {
      sun: this.getSignName(longitudes.sun),
      moon: this.getSignName(longitudes.moon),
      mars: this.getSignName(longitudes.mars),
      mercury: this.getSignName(longitudes.mercury),
      jupiter: this.getSignName(longitudes.jupiter),
      venus: this.getSignName(longitudes.venus),
      saturn: this.getSignName(longitudes.saturn),
      rahu: this.getSignName(longitudes.rahu),
      ketu: this.getSignName(longitudes.ketu),
    };
  }

  private roundLongitudes(longitudes: PlanetLongitudes): Record<PlanetName, number> {
    const values = {} as Record<PlanetName, number>;
    (Object.keys(longitudes) as PlanetName[]).forEach((planet) => {
      values[planet] = Number(longitudes[planet].toFixed(4));
    });
    return values;
  }

  private getSignName(longitude: number): string {
    const idx = Math.floor(this.normalize(longitude) / 30);
    return SIDEREAL_SIGNS[idx] ?? SIDEREAL_SIGNS[0];
  }

  private getNakshatra(moonLongitude: number): string {
    const idx = Math.floor(this.normalize(moonLongitude) / (360 / 27));
    return NAKSHATRA_LIST[idx] ?? NAKSHATRA_LIST[0];
  }

  private daysSinceJ2000(date: Date): number {
    return this.julianDate(date) - 2451545.0;
  }

  private julianDate(date: Date): number {
    return date.getTime() / 86400000 + 2440587.5;
  }

  private normalize(value: number): number {
    const normalized = value % 360;
    return normalized < 0 ? normalized + 360 : normalized;
  }

  private toRadians(degrees: number): number {
    return (degrees * Math.PI) / 180;
  }

  private toDegrees(radians: number): number {
    return (radians * 180) / Math.PI;
  }
}
