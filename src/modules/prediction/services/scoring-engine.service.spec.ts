import { ChartService } from '../../astrology/services/chart.service';
import { ScoringEngineService } from './scoring-engine.service';

/**
 * Regression baseline for the scoring formula. Locks in `goodTimes`/`badTimes`/scores for a
 * fixed birth profile + fixed date so that moving this engine into `@subatime/jyotisha-engine`
 * (or any future scoring tweak) can be checked against unintentional drift.
 *
 * If this snapshot changes, the scoring math changed — verify that was intentional before
 * updating the snapshot.
 */
describe('ScoringEngineService regression baseline', () => {
  const chartService = new ChartService();
  const scoringEngine = new ScoringEngineService(chartService);

  const blocks = [
    { start: '06:00', end: '08:00', label: 'Early Morning' },
    { start: '08:00', end: '10:00', label: 'Morning Focus' },
    { start: '10:00', end: '12:00', label: 'Late Morning' },
    { start: '12:00', end: '14:00', label: 'Noon Window' },
    { start: '14:00', end: '16:00', label: 'Afternoon Push' },
    { start: '16:00', end: '18:00', label: 'Evening Start' },
    { start: '18:00', end: '20:00', label: 'Evening Prime' },
    { start: '20:00', end: '22:00', label: 'Night Calm' },
  ];

  // `computeMahadasha` derives `yearsRemaining`/`mahadashaEndDate`/`antaraEndDate` from
  // `Date.now()` (age-since-birth), so this snapshot would otherwise drift by ~1/365 year on
  // every calendar day and fail this "regression baseline" spuriously. Pin "now" to the fixed
  // date used everywhere else in this file so the chart — and the snapshot — are fully
  // deterministic regardless of when the test actually runs.
  const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(new Date('2024-01-15T00:00:00Z').getTime());
  const fixedChart = chartService.generate({
    fullName: 'Regression Fixture',
    birthDate: '1990-06-15',
    birthTime: '07:30',
    birthPlace: 'Colombo',
    ayanamsa: 'lahiri',
    timezone: 'Asia/Colombo',
  });
  nowSpy.mockRestore();

  const fixedDate = new Date('2024-01-15T00:00:00Z');

  it('produces a stable chart snapshot for the fixture birth profile', () => {
    expect(fixedChart.lagna).toMatchSnapshot('lagna');
    expect(fixedChart.nakshatra).toMatchSnapshot('nakshatra');
    expect(fixedChart.chartData).toMatchSnapshot('chartData');
  });

  it('produces stable per-block scores for a fixed date', () => {
    const scored = scoringEngine.scoreBlocks({
      blocks,
      lagna: fixedChart.lagna,
      nakshatra: fixedChart.nakshatra,
      date: fixedDate,
      planetaryData: fixedChart.planetaryData,
      chartData: fixedChart.chartData,
      feedbackWeightAdjustment: 1,
      primaryContextWeight: 1,
    });

    expect(scored).toMatchSnapshot('scoredBlocks');
  });

  it('picks stable goodTimes/badTimes ordering for the fixed date', () => {
    const scored = scoringEngine.scoreBlocks({
      blocks,
      lagna: fixedChart.lagna,
      nakshatra: fixedChart.nakshatra,
      date: fixedDate,
      planetaryData: fixedChart.planetaryData,
      chartData: fixedChart.chartData,
      feedbackWeightAdjustment: 1,
      primaryContextWeight: 1,
    });

    const sorted = [...scored].sort((a, b) => b.score - a.score);
    const goodTimes = sorted.slice(0, 2).map((s) => s.block.label);
    const badTimes = sorted.slice(-2).map((s) => s.block.label);
    const confidence = scoringEngine.calculateConfidence(scored);

    expect({ goodTimes, badTimes, confidence }).toMatchSnapshot('goodBadConfidence');
  });
});
