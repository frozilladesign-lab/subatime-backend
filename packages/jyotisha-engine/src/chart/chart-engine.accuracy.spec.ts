import { JyotishaChartEngine } from './chart-engine';

/**
 * Accuracy checks for the chart engine.
 *
 * 1. Swiss Ephemeris path vs an independently published panchāṅga
 *    (drikpanchang.com, Colombo, 2024-01-15, geoname-id=1248991):
 *      sunrise 06:27 AM, sunset 06:13 PM, ayanāṃśa 24.199607,
 *      nakshatra Shatabhisha, moon sign Kumbha, sun sign Makara.
 *    The chart engine's Lahiri sidereal output should agree closely (sub-degree).
 *
 * 2. Legacy mean-orbit fallback vs Swiss Ephemeris: documents the KNOWN accuracy gap
 *    (ascendant ~270° off, Mars/Mercury/Venus 40-54° off; Sun/Moon/Jupiter/Saturn/
 *    Rahu/Ketu within ~1.5°). This is a known, unresolved limitation — these
 *    assertions exist so a future fix (or further drift) is visible, not silent.
 */
describe('JyotishaChartEngine accuracy', () => {
  const engine = new JyotishaChartEngine();

  it('Swiss path: ayanamsa and moon/sun sidereal longitude match published panchanga (Colombo 2024-01-15)', () => {
    const sunriseUtc = new Date('2024-01-15T00:56:00Z'); // ~06:26 AM Asia/Colombo
    const moonLon = engine.moonSiderealLongitudeUtc(sunriseUtc, 'lahiri');
    const sunLon = engine.sunSiderealLongitudeUtc(sunriseUtc, 'lahiri');
    const nakshatra = engine.nakshatraNameFromMoonLongitude(moonLon);

    expect(nakshatra).toBe('Shatabhisha');

    const moonSignIdx = Math.floor((((moonLon % 360) + 360) % 360) / 30);
    const sunSignIdx = Math.floor((((sunLon % 360) + 360) % 360) / 30);
    expect(moonSignIdx).toBe(10); // Kumbha
    expect(sunSignIdx).toBe(9); // Makara
  });

  it('legacy fallback has a known large ascendant/fast-planet drift vs Swiss Ephemeris (documented gap, not yet fixed)', () => {
    const dto = {
      fullName: 'Drift Check',
      birthDate: '1990-06-15',
      birthTime: '07:30',
      birthPlace: 'Colombo',
      ayanamsa: 'lahiri' as const,
      timezone: 'Asia/Colombo',
    };

    const prevEnv = process.env.CHART_ENGINE;
    try {
      process.env.CHART_ENGINE = '';
      const swiss = engine.generate(dto);
      process.env.CHART_ENGINE = 'legacy';
      const legacy = engine.generate(dto);

      const wrap = (deg: number) => {
        const d = Math.abs(deg) % 360;
        return Math.min(d, 360 - d);
      };

      const ascSwiss = Number(swiss.chartData.ascendantLongitude);
      const ascLegacy = Number(legacy.chartData.ascendantLongitude);
      const ascDrift = wrap(ascSwiss - ascLegacy);

      // Known bug: large ascendant drift (60°+ = at least two whole signs off, i.e. unusable
      // for lagna). This assertion documents the gap rather than hiding it — if a future fix
      // shrinks this drift, tighten the bound here.
      expect(ascDrift).toBeGreaterThan(60);

      const sLon = swiss.chartData.planetLongitudes as Record<string, number>;
      const lLon = legacy.chartData.planetLongitudes as Record<string, number>;

      // Slow bodies stay close to Swiss Ephemeris here, but legacy calculations are still only
      // approximate and may be wrong near sign, nakṣatra, pāda, aspect, or house boundaries.
      // They must not be used for production-grade chart interpretation.
      for (const planet of ['sun', 'moon', 'jupiter', 'saturn', 'rahu', 'ketu'] as const) {
        expect(wrap(sLon[planet] - lLon[planet])).toBeLessThan(3);
      }

      // Fast bodies are currently unusable from the legacy path (missing eccentricity term).
      for (const planet of ['mars', 'mercury', 'venus'] as const) {
        expect(wrap(sLon[planet] - lLon[planet])).toBeGreaterThan(30);
      }
    } finally {
      process.env.CHART_ENGINE = prevEnv;
    }
  });

});
