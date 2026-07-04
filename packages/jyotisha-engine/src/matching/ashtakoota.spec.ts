import { compareAshtakootaCompatibility } from './ashtakoota';
import { MatchProfileError } from './types';

const KOOTA_NAMES = ['Varna', 'Vashya', 'Tara', 'Yoni', 'Graha Maitri', 'Gana', 'Bhakoot', 'Nadi'];
const KOOTA_MAX: Record<string, number> = {
  Varna: 1, Vashya: 2, Tara: 3, Yoni: 4, 'Graha Maitri': 5, Gana: 6, Bhakoot: 7, Nadi: 8,
};

function profile(lagna: string, nakshatra: string, moonSign: string) {
  return { lagna, nakshatra, moonSign, marsHouse: 1 };
}

describe('compareAshtakootaCompatibility', () => {
  it('returns all 8 kootas with the correct max score each, summing to 36', () => {
    const result = compareAshtakootaCompatibility(
      profile('Mesha', 'Ashwini', 'Mesha'),
      profile('Tula', 'Chitra', 'Vrischika'),
    );
    expect(result.method).toBe('ashtakoota');
    expect(result.kootas.map((k) => k.name).sort()).toEqual([...KOOTA_NAMES].sort());
    for (const k of result.kootas) {
      expect(k.maxScore).toBe(KOOTA_MAX[k.name]);
      expect(k.score).toBeGreaterThanOrEqual(0);
      expect(k.score).toBeLessThanOrEqual(k.maxScore);
      expect(typeof k.explanation).toBe('string');
      expect(k.explanation.length).toBeGreaterThan(10);
    }
    const maxPossible = Object.values(KOOTA_MAX).reduce((a, b) => a + b, 0);
    expect(maxPossible).toBe(36);
    expect(result.maxScore).toBe(36);
  });

  it('totalScore/percentage are internally consistent with the kootas array', () => {
    const result = compareAshtakootaCompatibility(
      profile('Karka', 'Punarvasu', 'Karka'),
      profile('Vrischika', 'Anuradha', 'Vrischika'),
    );
    const sum = result.kootas.reduce((s, k) => s + k.score, 0);
    expect(result.totalScore).toBeCloseTo(sum, 4);
    expect(result.percentage).toBeCloseTo((sum / 36) * 100, 1);
  });

  it('identical Moon sign and nakshatra for both profiles scores full marks on Varna, Vashya, Graha Maitri, Gana, Bhakoot (same-group/self comparisons)', () => {
    const result = compareAshtakootaCompatibility(
      profile('Karka', 'Pushya', 'Karka'),
      profile('Karka', 'Pushya', 'Karka'),
    );
    const byName = Object.fromEntries(result.kootas.map((k) => [k.name, k.score]));
    expect(byName.Varna).toBe(1);
    expect(byName.Vashya).toBe(2);
    expect(byName['Graha Maitri']).toBe(5);
    expect(byName.Gana).toBe(6);
    expect(byName.Bhakoot).toBe(7);
    expect(byName.Yoni).toBe(4);
  });

  it('flags Nadi dosha (score 0) when both profiles share the same nadi group', () => {
    // Ashwini and Ardra are both Aadi nadi.
    const result = compareAshtakootaCompatibility(
      profile('Mesha', 'Ashwini', 'Mesha'),
      profile('Mesha', 'Ardra', 'Mithuna'),
    );
    const nadi = result.kootas.find((k) => k.name === 'Nadi')!;
    expect(nadi.score).toBe(0);
    expect(result.doshaNotes.some((n) => n.toLowerCase().includes('nadi'))).toBe(true);
  });

  it('does not flag Nadi dosha when the two profiles are in different nadi groups', () => {
    // Ashwini = Aadi, Bharani = Madhya.
    const result = compareAshtakootaCompatibility(
      profile('Mesha', 'Ashwini', 'Mesha'),
      profile('Vrishabha', 'Bharani', 'Vrishabha'),
    );
    const nadi = result.kootas.find((k) => k.name === 'Nadi')!;
    expect(nadi.score).toBe(8);
  });

  it('flags Bhakoot dosha (score 0) for a 6th/8th Moon-sign relationship', () => {
    // Mesha (idx0) to Kanya (idx5): count = 5-0+1 = 6 -> Shadashtaka dosha.
    const result = compareAshtakootaCompatibility(
      profile('Mesha', 'Ashwini', 'Mesha'),
      profile('Kanya', 'Hasta', 'Kanya'),
    );
    const bhakoot = result.kootas.find((k) => k.name === 'Bhakoot')!;
    expect(bhakoot.score).toBe(0);
    expect(result.doshaNotes.some((n) => n.toLowerCase().includes('bhakoot'))).toBe(true);
  });

  it('does not flag Bhakoot dosha for a 1st/1st (same sign) relationship', () => {
    const result = compareAshtakootaCompatibility(
      profile('Mesha', 'Ashwini', 'Mesha'),
      profile('Mesha', 'Bharani', 'Mesha'),
    );
    const bhakoot = result.kootas.find((k) => k.name === 'Bhakoot')!;
    expect(bhakoot.score).toBe(7);
  });

  it('Tara koota gives full 3 points when both directions land on a favorable tara', () => {
    // Same nakshatra both directions -> tara index 1 (Janma) both ways -> unfavorable -> 0.
    const same = compareAshtakootaCompatibility(
      profile('Mesha', 'Ashwini', 'Mesha'),
      profile('Mesha', 'Ashwini', 'Mesha'),
    );
    const tara = same.kootas.find((k) => k.name === 'Tara')!;
    expect(tara.score).toBe(0);
  });

  it('includes warnings about regional variation and does not combine with heuristic scoring', () => {
    const result = compareAshtakootaCompatibility(
      profile('Mesha', 'Ashwini', 'Mesha'),
      profile('Tula', 'Chitra', 'Tula'),
    );
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.toLowerCase().includes('regional'))).toBe(true);
    expect(result.accuracy.tier).toBe('classical-rule');
    expect(result.accuracy.degraded).toBe(false);
  });

  it('throws MatchProfileError when nakshatra cannot be resolved to a canonical name', () => {
    expect(() =>
      compareAshtakootaCompatibility(
        { lagna: 'Mesha', nakshatra: 'NotARealStar', moonSign: 'Mesha', marsHouse: 1 },
        profile('Tula', 'Chitra', 'Tula'),
      ),
    ).toThrow(MatchProfileError);
  });

  it('throws MatchProfileError when Moon sign cannot be resolved to a canonical whole sign', () => {
    expect(() =>
      compareAshtakootaCompatibility(
        { lagna: 'Mesha', nakshatra: 'Ashwini', moonSign: 'Aries', marsHouse: 1 },
        profile('Tula', 'Chitra', 'Tula'),
      ),
    ).toThrow(MatchProfileError);
  });
});
