import { computeRealDailyTransitCards, deriveDailyTransitsFromPool } from './day-transits';

/**
 * `computeRealDailyTransitCards` replaces the old hash-selected static pool with cards derived
 * from an actual transit-Moon longitude and configured-orb aspect checks against natal Moon,
 * Sun, and ascendant. transitMoonLongitude is fixed at 0° in these tests; the three natal
 * longitudes are placed at a "safe" baseline (145°/200°/45° from the transit Moon) that is
 * outside every configured orb, so isolating a single aspect under test never accidentally
 * triggers a second one.
 */
describe('computeRealDailyTransitCards', () => {
  const TRANSIT_MOON = 0;
  const SAFE_MOON = 145;
  const SAFE_SUN = 200;
  const SAFE_ASC = 45;

  it('emits a conjunction card only when the transit Moon is within the conjunction orb (8°) of a natal reference', () => {
    const withinOrb = computeRealDailyTransitCards({
      transitMoonLongitude: TRANSIT_MOON,
      natalMoonLongitude: 8, // deviation 8° — exactly at the orb edge
      natalSunLongitude: SAFE_SUN,
      natalAscendantLongitude: SAFE_ASC,
    });
    expect(withinOrb).toHaveLength(1);
    expect(withinOrb[0].isComputed).toBe(true);
    expect(withinOrb[0].aspectType).toBe('conjunction');
    expect(withinOrb[0].natalReference).toBe('moon');
    expect(withinOrb[0].orb).toBeCloseTo(8, 4);

    const outsideOrb = computeRealDailyTransitCards({
      transitMoonLongitude: TRANSIT_MOON,
      natalMoonLongitude: 8.5, // deviation 8.5° — just past the orb edge
      natalSunLongitude: SAFE_SUN,
      natalAscendantLongitude: SAFE_ASC,
    });
    expect(outsideOrb).toHaveLength(1);
    expect(outsideOrb[0].id).toBe('steady_lunar_influence');
    expect(outsideOrb[0].aspectType).toBeUndefined();
  });

  it('emits a trine card only when the transit Moon is within the trine orb (7°) of a natal reference', () => {
    const withinOrb = computeRealDailyTransitCards({
      transitMoonLongitude: TRANSIT_MOON,
      natalMoonLongitude: SAFE_MOON,
      natalSunLongitude: 127, // 120° + 7° — exactly at the orb edge
      natalAscendantLongitude: SAFE_ASC,
    });
    expect(withinOrb).toHaveLength(1);
    expect(withinOrb[0].isComputed).toBe(true);
    expect(withinOrb[0].aspectType).toBe('trine');
    expect(withinOrb[0].natalReference).toBe('sun');
    expect(withinOrb[0].type).toBe('opportunity');

    const outsideOrb = computeRealDailyTransitCards({
      transitMoonLongitude: TRANSIT_MOON,
      natalMoonLongitude: SAFE_MOON,
      natalSunLongitude: 128, // 120° + 8° — just past the orb edge
      natalAscendantLongitude: SAFE_ASC,
    });
    expect(outsideOrb).toHaveLength(1);
    expect(outsideOrb[0].id).toBe('steady_lunar_influence');
  });

  it('emits no aspect card when no real aspect is active within any configured orb', () => {
    const cards = computeRealDailyTransitCards({
      transitMoonLongitude: TRANSIT_MOON,
      natalMoonLongitude: SAFE_MOON,
      natalSunLongitude: SAFE_SUN,
      natalAscendantLongitude: SAFE_ASC,
    });
    for (const card of cards) {
      expect(card.aspectType).toBeUndefined();
      expect(card.natalReference).toBeUndefined();
    }
  });

  it('returns a neutral "Steady Lunar Influence" summary card (isComputed: true) when no major transit exists', () => {
    const cards = computeRealDailyTransitCards({
      transitMoonLongitude: TRANSIT_MOON,
      natalMoonLongitude: SAFE_MOON,
      natalSunLongitude: SAFE_SUN,
      natalAscendantLongitude: SAFE_ASC,
    });
    expect(cards).toHaveLength(1);
    const [card] = cards;
    expect(card.title).toBe('Steady Lunar Influence');
    expect(card.isComputed).toBe(true);
    expect(card.degraded).toBeUndefined();
    expect(card.type).toBe('neutral');
    expect(card.description.toLowerCase()).toContain('no major moon aspect');
  });

  it('every computed card carries source/provenance fields (transitBody, transitLongitude, sign/nakshatra/houses)', () => {
    const cards = computeRealDailyTransitCards({
      transitMoonLongitude: 10,
      natalMoonLongitude: 10, // conjunction
      natalSunLongitude: 300,
      natalAscendantLongitude: 320,
    });
    expect(cards).toHaveLength(1);
    const [card] = cards;
    expect(card.transitBody).toBe('moon');
    expect(card.transitLongitude).toBeCloseTo(10, 4);
    expect(card.natalLongitude).toBeCloseTo(10, 4);
    expect(typeof card.transitMoonSign).toBe('string');
    expect(typeof card.transitMoonNakshatra).toBe('string');
    expect(typeof card.transitMoonHouseFromLagna).toBe('number');
    expect(typeof card.transitMoonHouseFromNatalMoon).toBe('number');
  });
});

describe('deriveDailyTransitsFromPool (fallback path)', () => {
  it('stamps every fallback card as isComputed: false / degraded: true with a reason', () => {
    const cards = deriveDailyTransitsFromPool({
      date: new Date('2024-01-15T00:00:00Z'),
      userId: 'user-1',
      onboardingIntent: 'career',
      lagna: 'Mesha',
      nakshatra: 'Ashwini',
    });
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.isComputed).toBe(false);
      expect(card.degraded).toBe(true);
      expect(typeof card.degradedReason).toBe('string');
      expect(card.degradedReason?.length).toBeGreaterThan(0);
    }
  });
});
