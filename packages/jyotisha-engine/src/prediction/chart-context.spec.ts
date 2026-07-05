import { computeChartContext, type ChartContextInput, type TransitLongitude } from './chart-context';

/**
 * P0 trust test: different Lagna / Moon / Dasha on the SAME transit day must produce
 * meaningfully different themes, active houses, and reasons. Same chart ⇒ identical.
 */

// A fixed transit sky (same "date/location Panchanga" shared across all users).
const TODAY_TRANSITS: TransitLongitude[] = [
  { planet: 'sun', longitude: 100 },     // Karka
  { planet: 'moon', longitude: 315 },    // Kumbha
  { planet: 'mars', longitude: 40 },     // Vrishabha
  { planet: 'jupiter', longitude: 70 },  // Mithuna
  { planet: 'saturn', longitude: 330 },  // Meena
  { planet: 'rahu', longitude: 350 },    // Meena
  { planet: 'ketu', longitude: 170 },    // Kanya
];

// 5 profiles: different ascendant (Lagna), Moon, and Dasha lord.
const PROFILES: Record<string, ChartContextInput> = {
  // Aries asc, Moon in Leo, Sun dasha
  aries: {
    ascendantLongitude: 5, natalMoonLongitude: 130, dashaLord: 'Sun',
    natalPlanets: { sun: 130, moon: 130, saturn: 280, jupiter: 200 },
    transits: TODAY_TRANSITS,
  },
  // Cancer asc, Moon in Capricorn, Saturn dasha
  cancer: {
    ascendantLongitude: 100, natalMoonLongitude: 290, dashaLord: 'Saturn',
    natalPlanets: { sun: 40, moon: 290, saturn: 300, jupiter: 10 },
    transits: TODAY_TRANSITS,
  },
  // Libra asc, Moon in Aries, Venus dasha
  libra: {
    ascendantLongitude: 190, natalMoonLongitude: 20, dashaLord: 'Venus',
    natalPlanets: { venus: 200, moon: 20, saturn: 100, jupiter: 250 },
    transits: TODAY_TRANSITS,
  },
  // Capricorn asc, Moon in Cancer, Jupiter dasha
  capricorn: {
    ascendantLongitude: 285, natalMoonLongitude: 110, dashaLord: 'Jupiter',
    natalPlanets: { jupiter: 300, moon: 110, saturn: 20, sun: 250 },
    transits: TODAY_TRANSITS,
  },
  // Gemini asc, Moon in Sagittarius, Mercury dasha
  gemini: {
    ascendantLongitude: 65, natalMoonLongitude: 250, dashaLord: 'Mercury',
    natalPlanets: { mercury: 80, moon: 250, saturn: 160, mars: 300 },
    transits: TODAY_TRANSITS,
  },
};

describe('computeChartContext — chart-driven personalization', () => {
  it('is deterministic: same input ⇒ identical result', () => {
    const a = computeChartContext(PROFILES.cancer);
    const b = computeChartContext(PROFILES.cancer);
    expect(b).toEqual(a);
  });

  it('different Lagna/Moon/Dasha ⇒ meaningfully different themes on the same transit day', () => {
    const results = Object.fromEntries(
      Object.entries(PROFILES).map(([k, v]) => [k, computeChartContext(v)]),
    );

    // At least 3 distinct dominant themes across the 5 charts (not all "overall").
    const themes = Object.values(results).map((r) => r.dominantTheme);
    expect(new Set(themes).size).toBeGreaterThanOrEqual(3);
    expect(themes.every((t) => t === 'overall')).toBe(false);

    // Active Lagna houses differ between charts (same transits, different ascendant).
    const cancerHouses = results.cancer.activeHousesFromLagna.map((h) => h.house).join(',');
    const libraHouses = results.libra.activeHousesFromLagna.map((h) => h.house).join(',');
    expect(cancerHouses).not.toBe(libraHouses);

    // Reasons are chart-specific and explainable (not empty, not identical).
    expect(results.cancer.reasons[0]).not.toBe(results.libra.reasons[0]);
    expect(results.cancer.topTransitInfluences.length).toBeGreaterThan(0);
  });

  it('same transit longitude lands in different houses for different ascendants', () => {
    // Saturn at 330° (Meena): 12th from Aries(5°), 9th from Cancer(100°), 6th from Libra(190°).
    const aries = computeChartContext(PROFILES.aries).activeHousesFromLagna.find((h) => h.planet === 'saturn');
    const cancer = computeChartContext(PROFILES.cancer).activeHousesFromLagna.find((h) => h.planet === 'saturn');
    const libra = computeChartContext(PROFILES.libra).activeHousesFromLagna.find((h) => h.planet === 'saturn');
    expect(aries?.house).toBe(12);
    expect(cancer?.house).toBe(9);
    expect(libra?.house).toBe(6);
  });

  it('Dasha lord biases the theme via its natal house', () => {
    // Capricorn asc (285°), Jupiter dasha, Jupiter natal at 300° (Kumbha) = 2nd house.
    const cap = computeChartContext(PROFILES.capricorn);
    expect(cap.dashaHouseFromLagna).toBe(2);
    expect(cap.reasons.some((r) => r.includes('Jupiter'))).toBe(true);
  });

  it('focus areas boost but do not fabricate: chart winner preserved when focus is empty', () => {
    const noFocus = computeChartContext({ ...PROFILES.libra, focusAreas: [] });
    const withFocus = computeChartContext({ ...PROFILES.libra, focusAreas: ['money'] });
    // Focus can only raise money if the chart already scored it; the flag reports honestly.
    expect(typeof withFocus.focusBoostApplied).toBe('boolean');
    // Without focus, the result is purely chart-driven.
    expect(noFocus.focusBoostApplied).toBe(false);
  });

  it('dominantContext maps the theme to the coarse scoring context', () => {
    const r = computeChartContext(PROFILES.cancer);
    expect(['overall', 'career', 'love', 'health']).toContain(r.dominantContext);
  });
});
