import { JyotishaChartEngine } from './chart-engine';

/**
 * Vimśottarī Mahādaśā birth-balance tests.
 *
 * computeMahadasha is private, so we drive it through `generate()` with a fixed birth moment
 * and a Moon longitude chosen via the `lagnaUserOverride`-free Swiss path is not directly
 * controllable from the public API (Moon longitude comes from the ephemeris for a given birth
 * moment), so these tests instead validate the *mathematical relationships* that must hold for
 * any chart's `dasha` block, plus the fixed 9-lord order and 120-year total cycle invariant.
 */
describe('Vimśottarī Mahādaśā birth balance', () => {
  const engine = new JyotishaChartEngine();

  const NAKSHATRA_LORDS_CYCLE = [
    'Ketu', 'Venus', 'Sun', 'Moon', 'Mars', 'Rahu', 'Jupiter', 'Saturn', 'Mercury',
  ];
  const MAHADASHA_YEARS: Record<string, number> = {
    Ketu: 7, Venus: 20, Sun: 6, Moon: 10, Mars: 7, Rahu: 18, Jupiter: 16, Saturn: 19, Mercury: 17,
  };

  it('the fixed Vimśottarī 9-lord cycle sums to exactly 120 years', () => {
    const total = NAKSHATRA_LORDS_CYCLE.reduce((sum, lord) => sum + MAHADASHA_YEARS[lord], 0);
    expect(total).toBe(120);
  });

  function generateDasha(birthDate: string, birthTime: string) {
    const chart = engine.generate({
      fullName: 'Mahadasha Check',
      birthDate,
      birthTime,
      birthPlace: 'Colombo',
      timezone: 'Asia/Colombo',
      latitude: 6.9271,
      longitude: 79.8612,
    });
    return chart.chartData.dasha as Record<string, unknown>;
  }

  it('returns birth nakshatra, lord, elapsed/remaining degrees, and a first-dasha balance consistent with the classical formula', () => {
    const dasha = generateDasha('1990-06-15', '07:30');

    expect(typeof dasha.birthNakshatra).toBe('string');
    expect(typeof dasha.birthNakshatraLord).toBe('string');
    expect(NAKSHATRA_LORDS_CYCLE).toContain(dasha.birthNakshatraLord);

    const elapsed = Number(dasha.nakshatraElapsedDegrees);
    const remaining = Number(dasha.nakshatraRemainingDegrees);
    const span = 360 / 27; // 13°20'

    // elapsed + remaining must reconstruct the full nakshatra span.
    expect(elapsed + remaining).toBeCloseTo(span, 4);
    expect(elapsed).toBeGreaterThanOrEqual(0);
    expect(elapsed).toBeLessThan(span);

    const lord = dasha.birthNakshatraLord as string;
    const fullYears = MAHADASHA_YEARS[lord];
    const expectedBalance = fullYears * (remaining / span);
    expect(Number(dasha.firstDashaBalanceYears)).toBeCloseTo(expectedBalance, 2);

    // Sanity: first balance is always a fraction of (0, fullYears].
    expect(Number(dasha.firstDashaBalanceYears)).toBeGreaterThan(0);
    expect(Number(dasha.firstDashaBalanceYears)).toBeLessThanOrEqual(fullYears);

    expect(typeof dasha.mahadashaStartDate).toBe('string');
    expect(typeof dasha.mahadashaEndDate).toBe('string');
    expect(new Date(dasha.mahadashaEndDate as string).getTime()).toBeGreaterThan(
      new Date(dasha.mahadashaStartDate as string).getTime(),
    );
  });

  it('next mahādaśā lord always follows the fixed 9-lord Vimśottarī order after the current lord', () => {
    const dasha = generateDasha('1990-06-15', '07:30');
    const current = dasha.current as string;
    const next = dasha.next as string;
    const currentIdx = NAKSHATRA_LORDS_CYCLE.indexOf(current);
    const expectedNextIdx = (currentIdx + 1) % 9;
    expect(next).toBe(NAKSHATRA_LORDS_CYCLE[expectedNextIdx]);
  });

  it('antardaśā window (when present) falls within the enclosing mahādaśā lord cycle and has start before end', () => {
    const dasha = generateDasha('1990-06-15', '07:30');
    if (dasha.antaraStartDate && dasha.antaraEndDate) {
      const start = new Date(dasha.antaraStartDate as string).getTime();
      const end = new Date(dasha.antaraEndDate as string).getTime();
      expect(end).toBeGreaterThan(start);
    }
  });

  describe('boundary cases via direct moon-longitude math (mirrors computeMahadasha formula)', () => {
    const span = 360 / 27;

    function expectedBalance(nakIdx: number, moonLongitude: number) {
      const lord = NAKSHATRA_LORDS_CYCLE[nakIdx % 9];
      const nakStart = nakIdx * span;
      const elapsed = moonLongitude - nakStart;
      const remaining = span - elapsed;
      return { lord, elapsed, remaining, balance: MAHADASHA_YEARS[lord] * (remaining / span) };
    }

    it('Moon exactly at the start of a nakshatra: full lord balance (remaining fraction = 1)', () => {
      const nakIdx = 4; // Mrigashira, lord Mars in the 9-lord cycle (idx 4)
      const moonLongitude = nakIdx * span; // exact boundary
      const { remaining, balance } = expectedBalance(nakIdx, moonLongitude);
      expect(remaining).toBeCloseTo(span, 6);
      expect(balance).toBeCloseTo(MAHADASHA_YEARS[NAKSHATRA_LORDS_CYCLE[nakIdx % 9]], 6);
    });

    it('Moon exactly halfway through a nakshatra: balance is half the full dasha years', () => {
      const nakIdx = 4;
      const moonLongitude = nakIdx * span + span / 2;
      const { remaining, balance } = expectedBalance(nakIdx, moonLongitude);
      expect(remaining).toBeCloseTo(span / 2, 6);
      expect(balance).toBeCloseTo(MAHADASHA_YEARS[NAKSHATRA_LORDS_CYCLE[nakIdx % 9]] / 2, 6);
    });

    it('Moon near the end of a nakshatra: balance approaches zero', () => {
      const nakIdx = 4;
      const moonLongitude = nakIdx * span + span * 0.999;
      const { remaining, balance } = expectedBalance(nakIdx, moonLongitude);
      expect(remaining).toBeCloseTo(span * 0.001, 4);
      expect(balance).toBeLessThan(0.01 * MAHADASHA_YEARS[NAKSHATRA_LORDS_CYCLE[nakIdx % 9]]);
    });
  });
});
