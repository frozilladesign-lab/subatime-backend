import { JyotishaChartEngine, SIDEREAL_SIGNS } from '../chart/chart-engine';
import { computeHoraTimeline } from './hora';
import { computeNakshatraSnapshot } from './nakshatra-timeline';
import { AlmanacCalculationError, computePanchanga } from './panchanga';
import { computeRahuKalam } from './rahu-kalam';
import { computeSunriseSunset } from './sunrise-sunset';
import { computeTithi } from './tithi';
import { computeYoga } from './yoga';

/**
 * Reference: drikpanchang.com, Colombo (geoname-id=1248991), 2024-01-15 — already verified and
 * locked in by `chart-engine.accuracy.spec.ts`: sunrise ~06:27 AM, sunset ~06:13 PM, ayanāṃśa
 * 24.199607, nakṣatra Shatabhisha, Moon sign Kumbha, Sun sign Makara (Asia/Colombo, UTC+05:30,
 * no internet call — values stored locally here and in the existing accuracy report).
 */
/** Decimal local hour for a UTC ISO instant, offset by +05:30 (Asia/Colombo, no historical DST in 2024). */
function colomboLocalDecimalHour(isoUtc: string): number {
  const d = new Date(isoUtc);
  return d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600 + 5.5;
}

describe('Almanac engine modules — Colombo 2024-01-15 reference', () => {
  const engine = new JyotishaChartEngine();
  const colombo = { date: '2024-01-15', timezone: 'Asia/Colombo', latitude: 6.9271, longitude: 79.8612 };

  describe('computeSunriseSunset', () => {
    it('produces a sunrise/sunset within ~1 minute of the published reference', () => {
      // dateToJulianDay(local midnight) is what computePanchanga feeds in; replicate it minimally
      // by searching from local midnight UTC for this fixture.
      const jdMidnightUtc = 2460324.5; // 2024-01-15T00:00:00Z (JD for that instant)
      const r = computeSunriseSunset(jdMidnightUtc, colombo.latitude, colombo.longitude);

      const sunriseLocal = colomboLocalDecimalHour(r.sunriseUtc);
      const sunsetLocal = colomboLocalDecimalHour(r.sunsetUtc);
      expect(sunriseLocal).toBeCloseTo(6.45, 1); // ~06:27 AM
      expect(sunsetLocal).toBeCloseTo(18.2, 1); // ~06:13 PM
      expect(r.accuracy.tier).toBe('ephemeris');
      expect(r.accuracy.degraded).toBe(false);
    });
  });

  describe('computeTithi', () => {
    it('derives a tithi (and stable karaṇa index) from real sidereal Moon/Sun longitudes', () => {
      // Sidereal longitudes for Colombo 2024-01-15 sunrise (verified via chart engine).
      const moonLon = 318.980576;
      const sunLon = 270.157716;
      const t = computeTithi(moonLon, sunLon);

      expect(t.index1To30).toBe(5);
      expect(t.paksha).toBe('shukla');
      expect(t.ordinalName).toBe('Panchami');
      expect(t.karana.index0To59).toBeGreaterThanOrEqual(0);
      expect(t.karana.index0To59).toBeLessThanOrEqual(59);
      expect(t.accuracy.tier).toBe('ephemeris');
    });

    it('flags Purnima/Amavasya at the 15th tithi of each pakṣa', () => {
      // Elongation just under 180° -> tithiIndex 14 (0-based) -> shukla Purnima.
      const purnima = computeTithi(179, 0);
      expect(purnima.ordinalName).toBe('Purnima');
      // Elongation just under 360° -> tithiIndex 29 -> krishna Amavasya.
      const amavasya = computeTithi(359, 0);
      expect(amavasya.ordinalName).toBe('Amavasya');
    });
  });

  describe('computeYoga', () => {
    it('derives the 27-fold yoga index from real sidereal Sun+Moon longitudes', () => {
      const y = computeYoga(270.157716, 318.980576);
      expect(y.index0To26).toBe(17);
      expect(y.name).toBe('Variyan');
      expect(y.accuracy.tier).toBe('ephemeris');
    });
  });

  describe('computeNakshatraSnapshot', () => {
    it('matches the published nakṣatra (Shatabhisha) for the reference Moon longitude', () => {
      const n = computeNakshatraSnapshot(318.980576);
      expect(n.name).toBe('Shatabhisha');
      expect(n.index0To26).toBe(23);
      expect(n.pada1To4).toBeGreaterThanOrEqual(1);
      expect(n.pada1To4).toBeLessThanOrEqual(4);
      expect(n.accuracy.tier).toBe('ephemeris');
    });
  });

  describe('computeHoraTimeline', () => {
    it('produces 12 day horā segments spanning sunrise→sunset, Chaldean-ordered', () => {
      const sunriseJd = 2460324.5393314795;
      const sunsetJd = 2460325.0297376937;
      const h = computeHoraTimeline({ jsWeekday: 1, sunriseJd, sunsetJd, nextSunriseJd: null });

      expect(h.dayHoras).toHaveLength(12);
      expect(h.nightHoras).toHaveLength(0); // no next sunrise supplied
      expect(h.dayHoras[0].startUtc).toBe(new Date((sunriseJd - 2440587.5) * 86400000).toISOString());
      expect(h.dayHoras[11].endUtc).toBe(new Date((sunsetJd - 2440587.5) * 86400000).toISOString());
      expect(h.accuracy.tier).toBe('classical-rule');
    });

    it('continues the Chaldean sequence unbroken into 12 night horā when a next sunrise is supplied', () => {
      const sunriseJd = 2460324.5393314795;
      const sunsetJd = 2460325.0297376937;
      const nextSunriseJd = 2460325.539511342;
      const h = computeHoraTimeline({ jsWeekday: 1, sunriseJd, sunsetJd, nextSunriseJd });
      expect(h.nightHoras).toHaveLength(12);
      expect(h.nightHoras[0].phase).toBe('night');
    });

    it('labels personalStatus as favorable/tense/neutral via the optional lagna matrix', () => {
      const h = computeHoraTimeline({
        jsWeekday: 1,
        sunriseJd: 2460324.5393314795,
        sunsetJd: 2460325.0297376937,
        nextSunriseJd: null,
        lagna: 'Mesha',
      });
      for (const seg of h.dayHoras) {
        expect(['favorable', 'tense', 'neutral']).toContain(seg.personalStatus);
      }
    });
  });

  describe('computeRahuKalam', () => {
    it('selects the correct weekday-indexed Rāhu kāla/Yamagaṇḍa/Gulika slot and Maru diśā', () => {
      // 2024-01-15 is a Monday -> JS weekday 1.
      const r = computeRahuKalam(1, 2460324.5393314795, 2460325.0297376937);
      expect(r.rahuKala.slot1To8).toBe(2);
      expect(r.yamagandha.slot1To8).toBe(4);
      expect(r.gulika.slot1To8).toBe(5);
      expect(r.maruDirection).toBe('NorthWest');
      expect(r.accuracy.tier).toBe('classical-rule');
    });
  });

  describe('computePanchanga (full assembly)', () => {
    it('matches all Colombo 2024-01-15 reference values in one assembled call', () => {
      const result = computePanchanga(colombo, engine);

      expect(result.nakshatra.name).toBe('Shatabhisha');
      const moonSignIdx = Math.floor((((result.moon.siderealLongitudeDeg % 360) + 360) % 360) / 30);
      const sunSignIdx = Math.floor((((result.sun.siderealLongitudeDeg % 360) + 360) % 360) / 30);
      expect(SIDEREAL_SIGNS[moonSignIdx]).toBe('Kumbha');
      expect(SIDEREAL_SIGNS[sunSignIdx]).toBe('Makara');

      // Sunrise ~06:27 AM, sunset ~06:13 PM Asia/Colombo (UTC+05:30).
      const sunriseLocalHour = colomboLocalDecimalHour(result.sunrise.instantUtc);
      const sunsetLocalHour = colomboLocalDecimalHour(result.sunset.instantUtc);
      expect(sunriseLocalHour).toBeCloseTo(6.45, 1);
      expect(sunsetLocalHour).toBeCloseTo(18.2, 1);

      expect(result.dayHoras).toHaveLength(12);
      expect(result.nightHoras).toHaveLength(12);
      expect(result.rahuKala.slot1To8).toBe(2);

      expect(result.accuracy.tier).toBe('ephemeris');
      expect(result.accuracy.degraded).toBe(false);
      expect(result.accuracy.verifiedAgainst?.length).toBeGreaterThan(0);
    });

    it('attaches the optional lagna personalization block only when lagna is supplied', () => {
      const withoutLagna = computePanchanga(colombo, engine);
      expect(withoutLagna.personalization).toBeUndefined();

      const withLagna = computePanchanga({ ...colombo, lagna: 'Mesha' }, engine);
      expect(withLagna.personalization).toEqual({ lagna: 'Mesha', lagnaMatrixKey: 'Aries' });
    });

    it('throws AlmanacCalculationError for an invalid IANA timezone', () => {
      expect(() => computePanchanga({ ...colombo, timezone: 'Not/AZone' }, engine)).toThrow(
        AlmanacCalculationError,
      );
    });

    it('throws AlmanacCalculationError for an invalid calendar date', () => {
      expect(() => computePanchanga({ ...colombo, date: '2024-99-99' }, engine)).toThrow(
        AlmanacCalculationError,
      );
    });
  });
});
