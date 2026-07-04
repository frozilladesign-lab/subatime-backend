import { JyotishaChartEngine } from '../chart/chart-engine';
import { SCORE_COMPONENT_WEIGHTS } from './scoring-engine';
import { JyotishaScoringEngine, type TimeBlock } from './scoring-engine';

/**
 * Explainable scoring breakdown — each block's `scoreBreakdown` must account for every
 * weighted component (rawValue/weight/weightedContribution/type/explanation), the weights
 * must sum to exactly 1.0, and the breakdown contributions must reconstruct the pre-feedback/
 * pre-context-scale combined score (this test holds those multipliers at 1 to make that
 * reconstruction exact).
 */
describe('scoring breakdown explainability', () => {
  it('component weights sum to exactly 1.0 (fails if a future edit unbalances them)', () => {
    const total = Object.values(SCORE_COMPONENT_WEIGHTS).reduce((sum, w) => sum + w, 0);
    // SCORE_COMPONENT_WEIGHTS covers all components except the 1% time-of-day term, which is
    // applied separately in scoreBlocks() — together they must sum to 1.0.
    const TIME_OF_DAY_WEIGHT = 0.01;
    expect(Number((total + TIME_OF_DAY_WEIGHT).toFixed(6))).toBe(1);
  });

  const chartEngine = new JyotishaChartEngine();
  const scoringEngine = new JyotishaScoringEngine(chartEngine);
  const blocks: TimeBlock[] = [{ start: '08:00', end: '10:00', label: 'Morning Focus' }];

  const fixedChart = chartEngine.generate({
    fullName: 'Breakdown Fixture',
    birthDate: '1990-06-15',
    birthTime: '07:30',
    birthPlace: 'Colombo',
    ayanamsa: 'lahiri',
    timezone: 'Asia/Colombo',
  });

  function scoreFixture() {
    return scoringEngine.scoreBlocks({
      blocks,
      lagna: fixedChart.lagna,
      nakshatra: fixedChart.nakshatra,
      date: new Date('2024-03-01T00:00:00Z'),
      planetaryData: fixedChart.planetaryData,
      feedbackWeightAdjustment: 1,
      primaryContextWeight: 1,
      chartData: fixedChart.chartData,
      dataQuality: 1,
    });
  }

  it('every scored block has a scoreBreakdown with one entry per weighted component, each with an explanation', () => {
    const [scored] = scoreFixture();
    const expectedComponents = [...Object.keys(SCORE_COMPONENT_WEIGHTS), 'timeOfDay'];
    expect(scored.scoreBreakdown.map((c) => c.component).sort()).toEqual([...expectedComponents].sort());
    for (const c of scored.scoreBreakdown) {
      expect(typeof c.explanation).toBe('string');
      expect(c.explanation.length).toBeGreaterThan(10);
      expect(['astronomical', 'heuristic', 'product']).toContain(c.type);
      expect(c.weightedContribution).toBeCloseTo(c.rawValue * c.weight, 4);
    }
  });

  it('breakdown weights sum to 1.0', () => {
    const [scored] = scoreFixture();
    const weightSum = scored.scoreBreakdown.reduce((sum, c) => sum + c.weight, 0);
    expect(Number(weightSum.toFixed(6))).toBe(1);
  });

  it('breakdown contributions sum to the final score when feedback/context multipliers are neutral (1)', () => {
    const [scored] = scoreFixture();
    const contributionSum = scored.scoreBreakdown.reduce((sum, c) => sum + c.weightedContribution, 0);
    expect(contributionSum).toBeCloseTo(scored.score, 3);
  });

  it('includes heuristic accuracy metadata describing the result as an interpretation model, not an astronomical fact', () => {
    const [scored] = scoreFixture();
    expect(scored.accuracy.tier).toBe('heuristic');
    expect(scored.accuracy.degraded).toBe(false);
    expect(scored.accuracy.notes.some((n) => n.toLowerCase().includes('interpretation model'))).toBe(true);
  });

  it('flags accuracy.degraded when no chart snapshot is supplied', () => {
    const scored = scoringEngine.scoreBlocks({
      blocks,
      lagna: fixedChart.lagna,
      nakshatra: fixedChart.nakshatra,
      date: new Date('2024-03-01T00:00:00Z'),
      planetaryData: fixedChart.planetaryData,
      feedbackWeightAdjustment: 1,
      primaryContextWeight: 1,
      dataQuality: 1,
    });
    expect(scored[0].accuracy.degraded).toBe(true);
  });
});
