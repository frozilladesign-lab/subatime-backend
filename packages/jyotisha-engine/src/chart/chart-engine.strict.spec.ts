import { ChartCalculationError } from '../types/chart';

/**
 * Strict-Swiss mode tests.
 *
 * `CHART_ENGINE=strict-swiss` is the production setting: if Swiss Ephemeris fails for any
 * reason, the engine must throw a typed `ChartCalculationError` rather than silently returning
 * a legacy (approximate) chart. These tests force a Swiss Ephemeris failure via a mock of
 * `@swisseph/node` to prove that behavior without depending on a real ephemeris fault.
 */
jest.mock('@swisseph/node', () => {
  const actual = jest.requireActual('@swisseph/node');
  return {
    ...actual,
    calculatePosition: jest.fn(() => {
      throw new Error('simulated swiss ephemeris failure');
    }),
  };
});

describe('JyotishaChartEngine strict-swiss mode', () => {
  const baseDto = {
    fullName: 'Strict Mode Check',
    birthDate: '1990-06-15',
    birthTime: '07:30',
    birthPlace: 'Colombo',
    ayanamsa: 'lahiri' as const,
    timezone: 'Asia/Colombo',
  };
  let prevEnv: string | undefined;

  beforeEach(() => {
    prevEnv = process.env.CHART_ENGINE;
  });

  afterEach(() => {
    process.env.CHART_ENGINE = prevEnv;
  });

  it('throws a typed ChartCalculationError when Swiss Ephemeris fails in strict-swiss mode', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { JyotishaChartEngine } = require('./chart-engine');
    const engine = new JyotishaChartEngine();
    process.env.CHART_ENGINE = 'strict-swiss';

    expect(() => engine.generate(baseDto)).toThrow(ChartCalculationError);
    try {
      engine.generate(baseDto);
      fail('expected generate() to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ChartCalculationError);
      expect((err as InstanceType<typeof ChartCalculationError>).code).toBe('SWISS_EPHEMERIS_FAILED');
    }
  });

  it('never silently falls back to legacy math when Swiss Ephemeris fails in strict-swiss mode', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { JyotishaChartEngine } = require('./chart-engine');
    const engine = new JyotishaChartEngine();
    process.env.CHART_ENGINE = 'strict-swiss';

    let threw = false;
    try {
      engine.generate(baseDto);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
