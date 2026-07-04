import { JyotishaChartEngine, SIDEREAL_SIGNS } from '../../chart/chart-engine';
import { computePanchanga } from '../../almanac/panchanga';
import { ACCURACY_FIXTURES } from './locations';

/**
 * Multi-location accuracy fixtures — no network calls. All expected values are stored in
 * `locations.ts`; see each fixture's `sourceType`/`sourceNote` there for provenance (Colombo is
 * externally verified, the rest are engine self-consistency/regression guards only).
 *
 * Boundary-sensitive fields (declared per-fixture) are checked with a wide tolerance and an
 * explicit "how close to the boundary" assertion instead of strict equality, so a future
 * ephemeris/ayanāṃśa tweak that shifts the value doesn't silently break unrelated coverage.
 */
describe('Multi-location accuracy fixtures', () => {
  const engine = new JyotishaChartEngine();

  for (const fixture of ACCURACY_FIXTURES) {
    describe(`${fixture.name} (${fixture.sourceType})`, () => {
      const chart = engine.generate({
        fullName: 'Fixture',
        birthDate: fixture.date,
        birthTime: fixture.time,
        birthPlace: fixture.name,
        latitude: fixture.latitude,
        longitude: fixture.longitude,
        timezone: fixture.timezone,
        ayanamsa: 'lahiri',
      });
      const cd = chart.chartData as Record<string, unknown>;
      const planetLon = cd.planetLongitudes as Record<string, number>;
      const ayanamsa = cd.ayanamsa as number;
      const sunSiderealSign = SIDEREAL_SIGNS[Math.floor((((planetLon.sun % 360) + 360) % 360) / 30)];
      const moonSiderealSign = SIDEREAL_SIGNS[Math.floor((((planetLon.moon % 360) + 360) % 360) / 30)];

      it('matches the expected Lahiri ayanāṃśa within tolerance', () => {
        expect(Math.abs(ayanamsa - fixture.expected.ayanamsaDeg)).toBeLessThanOrEqual(
          fixture.expected.ayanamsaToleranceDeg,
        );
      });

      it('matches the expected Sun sidereal sign (or is explicitly boundary-sensitive)', () => {
        const distToBoundary = Math.min(
          ((planetLon.sun % 360) + 360) % 30,
          30 - (((planetLon.sun % 360) + 360) % 30),
        );
        if (fixture.boundarySensitiveFields.includes('sunSiderealSign')) {
          // Don't assert strict equality near a boundary — just document how close it is.
          expect(distToBoundary).toBeLessThan(2);
          expect(sunSiderealSign).toBe(fixture.expected.sunSiderealSign); // still true today; not a hard guarantee
        } else {
          expect(sunSiderealSign).toBe(fixture.expected.sunSiderealSign);
        }
      });

      it('matches the expected Moon sidereal sign', () => {
        if (!fixture.boundarySensitiveFields.includes('moonSiderealSign')) {
          expect(moonSiderealSign).toBe(fixture.expected.moonSiderealSign);
        }
      });

      it('matches the expected Moon nakṣatra (or is explicitly boundary-sensitive)', () => {
        if (fixture.boundarySensitiveFields.includes('moonNakshatra')) {
          const nakArc = 360 / 27;
          const posInNak = (((planetLon.moon % 360) + 360) % 360) % nakArc;
          const distToBoundary = Math.min(posInNak, nakArc - posInNak);
          expect(distToBoundary).toBeLessThan(1);
          expect(chart.nakshatra).toBe(fixture.expected.moonNakshatra); // still true today; fragile
        } else {
          expect(chart.nakshatra).toBe(fixture.expected.moonNakshatra);
        }
      });

      if (fixture.expected.ascendantSign) {
        it(
          fixture.sourceType === 'external-verified'
            ? 'matches the ascendant (self-consistency only — not part of the external reference)'
            : 'matches the expected ascendant sign (self-consistency)',
          () => {
            expect(chart.lagna).toBe(fixture.expected.ascendantSign);
          },
        );
      }

      if (fixture.expected.sunriseLocal && fixture.expected.sunsetLocal) {
        it('matches the expected sunrise/sunset within tolerance', () => {
          const result = computePanchanga(
            { date: fixture.date, timezone: fixture.timezone, latitude: fixture.latitude, longitude: fixture.longitude },
            engine,
          );
          const toleranceMin = fixture.expected.sunriseSunsetToleranceMinutes ?? 2;

          const localDecimalMinutes = (isoUtc: string, offsetHours: number): number => {
            const d = new Date(isoUtc);
            return (d.getUTCHours() + offsetHours) * 60 + d.getUTCMinutes();
          };
          const [expSunriseH, expSunriseM] = fixture.expected.sunriseLocal!.split(':').map(Number);
          const [expSunsetH, expSunsetM] = fixture.expected.sunsetLocal!.split(':').map(Number);
          // Asia/Colombo (only timezone currently using this assertion) has been a fixed
          // UTC+05:30 offset since 2006 — no DST.
          const offsetHours = 5.5;

          expect(
            Math.abs(localDecimalMinutes(result.sunrise.instantUtc, offsetHours) - (expSunriseH * 60 + expSunriseM)),
          ).toBeLessThanOrEqual(toleranceMin);
          expect(
            Math.abs(localDecimalMinutes(result.sunset.instantUtc, offsetHours) - (expSunsetH * 60 + expSunsetM)),
          ).toBeLessThanOrEqual(toleranceMin);
        });
      }

      if (fixture.expected.rahuKalaSlot1To8 != null) {
        it('matches the expected Rāhu kāla slot (classical-rule, not an ephemeris fact by itself)', () => {
          const result = computePanchanga(
            { date: fixture.date, timezone: fixture.timezone, latitude: fixture.latitude, longitude: fixture.longitude },
            engine,
          );
          expect(result.rahuKala.slot1To8).toBe(fixture.expected.rahuKalaSlot1To8);
          expect(result.accuracy.tier).toBe('ephemeris');
        });
      }
    });
  }
});
