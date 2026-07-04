import { analyzeManglikDosha, detectDosha } from './dosha';

describe('detectDosha (two-profile compatibility comparison, unchanged behavior)', () => {
  it('flags a mismatch when only one side is Manglik', () => {
    const result = detectDosha({ marsHouse: 1 }, { marsHouse: 2 });
    expect(result.aManglik).toBe(true);
    expect(result.bManglik).toBe(false);
    expect(result.hasManglikMismatch).toBe(true);
  });
});

describe('analyzeManglikDosha (single-profile transparent analysis)', () => {
  const manglikHouses = [1, 4, 7, 8, 12];
  const nonManglikHouses = [2, 3, 5, 6, 9, 10, 11];

  for (const house of manglikHouses) {
    it(`marks Manglik from lagna when Mars is in house ${house}`, () => {
      const result = analyzeManglikDosha({ marsHouseFromLagna: house });
      expect(result.manglikFromLagna).toBe(true);
      expect(result.marsHouseFromLagna).toBe(house);
      expect(result.rulesUsed).toContain('mars-houses-1-4-7-8-12-from-lagna');
    });
  }

  for (const house of nonManglikHouses) {
    it(`does not mark Manglik from lagna when Mars is in house ${house}`, () => {
      const result = analyzeManglikDosha({ marsHouseFromLagna: house });
      expect(result.manglikFromLagna).toBe(false);
    });
  }

  it('omits Moon/Venus fields entirely when not supplied', () => {
    const result = analyzeManglikDosha({ marsHouseFromLagna: 7 });
    expect(result.manglikFromMoon).toBeUndefined();
    expect(result.manglikFromVenus).toBeUndefined();
    expect(result.rulesUsed).toEqual(['mars-houses-1-4-7-8-12-from-lagna']);
  });

  it('includes a Moon-based check when marsHouseFromMoon is supplied', () => {
    const result = analyzeManglikDosha({ marsHouseFromLagna: 3, marsHouseFromMoon: 8 });
    expect(result.manglikFromLagna).toBe(false);
    expect(result.manglikFromMoon).toBe(true);
    expect(result.marsHouseFromMoon).toBe(8);
    expect(result.rulesUsed).toContain('mars-houses-1-4-7-8-12-from-moon');
    expect(result.notes.some((n) => n.toLowerCase().includes('moon'))).toBe(true);
  });

  it('includes a Venus-based check when marsHouseFromVenus is supplied', () => {
    const result = analyzeManglikDosha({ marsHouseFromLagna: 5, marsHouseFromVenus: 4 });
    expect(result.manglikFromVenus).toBe(true);
    expect(result.marsHouseFromVenus).toBe(4);
    expect(result.rulesUsed).toContain('mars-houses-1-4-7-8-12-from-venus');
    expect(result.notes.some((n) => n.toLowerCase().includes('venus'))).toBe(true);
  });

  it('includes both optional checks together when both houses are supplied', () => {
    const result = analyzeManglikDosha({
      marsHouseFromLagna: 1,
      marsHouseFromMoon: 4,
      marsHouseFromVenus: 6,
    });
    expect(result.manglikFromLagna).toBe(true);
    expect(result.manglikFromMoon).toBe(true);
    expect(result.manglikFromVenus).toBe(false);
    expect(result.rulesUsed).toEqual([
      'mars-houses-1-4-7-8-12-from-lagna',
      'mars-houses-1-4-7-8-12-from-moon',
      'mars-houses-1-4-7-8-12-from-venus',
    ]);
  });
});
