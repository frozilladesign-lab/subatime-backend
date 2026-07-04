import { ChartCalculationError } from '../types/chart';
import { JyotishaChartEngine } from './chart-engine';

describe('JyotishaChartEngine degraded/accuracy metadata', () => {
  const engine = new JyotishaChartEngine();
  let prevEnv: string | undefined;

  beforeEach(() => {
    prevEnv = process.env.CHART_ENGINE;
  });

  afterEach(() => {
    process.env.CHART_ENGINE = prevEnv;
  });

  const dto = {
    fullName: 'Degraded Mode Check',
    birthDate: '1990-06-15',
    birthTime: '07:30',
    birthPlace: 'Colombo',
    ayanamsa: 'lahiri' as const,
    timezone: 'Asia/Colombo',
  };

  it('legacy mode (CHART_ENGINE=legacy) is always visibly degraded', () => {
    process.env.CHART_ENGINE = 'legacy';
    const chart = engine.generate(dto);

    expect(chart.chartData.degraded).toBe(true);
    expect(typeof chart.chartData.degradedReason).toBe('string');
    expect(chart.chartData.accuracyTier).toBe('approximate');
    const accuracy = chart.chartData.accuracy as { tier: string; degraded: boolean };
    expect(accuracy.tier).toBe('approximate');
    expect(accuracy.degraded).toBe(true);
  });

  it('Swiss path (default/dev mode, no failure) is never marked degraded', () => {
    process.env.CHART_ENGINE = '';
    const chart = engine.generate(dto);

    expect(chart.chartData.degraded).toBe(false);
    expect(chart.chartData.accuracyTier).toBe('ephemeris');
    const accuracy = chart.chartData.accuracy as { tier: string; degraded: boolean; verifiedAgainst?: string[] };
    expect(accuracy.tier).toBe('ephemeris');
    expect(accuracy.degraded).toBe(false);
    expect(accuracy.verifiedAgainst?.length).toBeGreaterThan(0);
  });

  it('CHART_ENGINE=swiss (explicit mode name) behaves the same as unset — ephemeris, never degraded', () => {
    process.env.CHART_ENGINE = 'swiss';
    const chart = engine.generate(dto);

    expect(chart.chartData.degraded).toBe(false);
    expect(chart.chartData.accuracyTier).toBe('ephemeris');
  });

  it('CHART_ENGINE=strict-swiss on a healthy Swiss call returns the same ephemeris-tier result (no behavior change vs. swiss mode)', () => {
    process.env.CHART_ENGINE = 'strict-swiss';
    const chart = engine.generate(dto);

    expect(chart.chartData.degraded).toBe(false);
    expect(chart.chartData.accuracyTier).toBe('ephemeris');
  });

  it('Swiss path stamps inputLocalDateTime and calculationUtcDateTime', () => {
    process.env.CHART_ENGINE = '';
    const chart = engine.generate(dto);
    expect(typeof chart.chartData.inputLocalDateTime).toBe('string');
    expect(typeof chart.chartData.calculationUtcDateTime).toBe('string');
    // 1990-06-15 07:30 Asia/Colombo was UTC+5:30 (pre-2006 +6 shift doesn't apply after Apr 2006,
    // but for 1990 Colombo used +5:30 standard time) -> 02:00Z.
    expect(chart.chartData.calculationUtcDateTime).toBe('1990-06-15T02:00:00.000Z');
  });
});

describe('JyotishaChartEngine timezone and coordinate validation', () => {
  const engine = new JyotishaChartEngine();

  it('rejects an invalid/ambiguous explicit IANA timezone string', () => {
    expect(() =>
      engine.generate({
        fullName: 'Bad TZ',
        birthDate: '1990-06-15',
        birthTime: '07:30',
        birthPlace: 'Colombo',
        timezone: 'Not/AZone',
      }),
    ).toThrow(ChartCalculationError);
  });

  it('rejects out-of-range latitude', () => {
    expect(() =>
      engine.generate({
        fullName: 'Bad Lat',
        birthDate: '1990-06-15',
        birthTime: '07:30',
        birthPlace: 'Custom',
        latitude: 999,
        longitude: 79.86,
      }),
    ).toThrow(ChartCalculationError);
  });

  it('rejects out-of-range longitude', () => {
    expect(() =>
      engine.generate({
        fullName: 'Bad Lon',
        birthDate: '1990-06-15',
        birthTime: '07:30',
        birthPlace: 'Custom',
        latitude: 6.93,
        longitude: -999,
      }),
    ).toThrow(ChartCalculationError);
  });

  /** Snapshot UTC conversions for a spread of zones/DST states. */
  const fixtures: { label: string; birthDate: string; birthTime: string; timezone: string; lat: number; lon: number }[] = [
    { label: 'Colombo (no DST, UTC+5:30)', birthDate: '2024-01-15', birthTime: '06:30', timezone: 'Asia/Colombo', lat: 6.9271, lon: 79.8612 },
    { label: 'London during DST (BST, UTC+1)', birthDate: '2024-07-15', birthTime: '12:00', timezone: 'Europe/London', lat: 51.5074, lon: -0.1278 },
    { label: 'New York during DST (EDT, UTC-4)', birthDate: '2024-07-15', birthTime: '12:00', timezone: 'America/New_York', lat: 40.7128, lon: -74.006 },
    { label: 'New York non-DST (EST, UTC-5)', birthDate: '2024-01-15', birthTime: '12:00', timezone: 'America/New_York', lat: 40.7128, lon: -74.006 },
  ];

  for (const f of fixtures) {
    it(`converts local birth time to UTC correctly: ${f.label}`, () => {
      const chart = engine.generate({
        fullName: 'TZ Fixture',
        birthDate: f.birthDate,
        birthTime: f.birthTime,
        birthPlace: f.label,
        timezone: f.timezone,
        latitude: f.lat,
        longitude: f.lon,
      });
      expect(chart.chartData.calculationUtcDateTime).toMatchSnapshot(`${f.label} calculationUtcDateTime`);
      expect(chart.chartData.inputLocalDateTime).toMatchSnapshot(`${f.label} inputLocalDateTime`);
    });
  }
});
