import {
  buildMonthlyDigest,
  buildWeeklyDigest,
  type DigestDayInput,
} from './digest';

/** Helper: a day whose theme scores peak on `top` with a given confidence. */
function day(date: string, top: string, conf: number, second?: string): DigestDayInput {
  const scores: Record<string, number> = {
    career: 0.1, money: 0.1, relationship: 0.1, health: 0.1,
    education: 0.1, travel: 0.1, business: 0.1, spiritual: 0.1, overall: 0.1,
  };
  scores[top] = 1;
  if (second) scores[second] = 0.6;
  return { date, dominantTheme: top as never, themeScores: scores, confidenceScore: conf };
}

// Two users' weeks on the SAME dates but different chart-derived themes.
const careerWeek: DigestDayInput[] = [
  day('2026-07-06', 'career', 0.5),
  day('2026-07-07', 'career', 0.8), // best
  day('2026-07-08', 'money', 0.6),
  day('2026-07-09', 'career', 0.55),
  day('2026-07-10', 'career', 0.7),
  day('2026-07-11', 'health', 0.3), // caution
  day('2026-07-12', 'career', 0.5),
];
const relationshipWeek: DigestDayInput[] = [
  day('2026-07-06', 'relationship', 0.6),
  day('2026-07-07', 'relationship', 0.4), // caution
  day('2026-07-08', 'relationship', 0.85), // best
  day('2026-07-09', 'spiritual', 0.5),
  day('2026-07-10', 'relationship', 0.7),
  day('2026-07-11', 'relationship', 0.65),
  day('2026-07-12', 'health', 0.55),
];

describe('buildWeeklyDigest', () => {
  it('is deterministic: same input ⇒ identical digest', () => {
    const a = buildWeeklyDigest({ weekStart: '2026-07-06', days: careerWeek, lagna: 'Vrishabha' });
    const b = buildWeeklyDigest({ weekStart: '2026-07-06', days: careerWeek, lagna: 'Vrishabha' });
    expect(b).toEqual(a);
  });

  it('different charts ⇒ different weekly theme, best/caution day, and body', () => {
    const cw = buildWeeklyDigest({ weekStart: '2026-07-06', days: careerWeek, lagna: 'Vrishabha' });
    const rw = buildWeeklyDigest({ weekStart: '2026-07-06', days: relationshipWeek, lagna: 'Makara' });

    expect(cw.dominantTheme).toBe('career');
    expect(rw.dominantTheme).toBe('relationship');
    expect(cw.dominantTheme).not.toBe(rw.dominantTheme);

    expect(cw.bestDay.date).toBe('2026-07-07');
    expect(rw.bestDay.date).toBe('2026-07-08');
    expect(cw.cautionDay.date).toBe('2026-07-11');
    expect(rw.cautionDay.date).toBe('2026-07-07');

    expect(cw.body).not.toBe(rw.body);
    expect(cw.title.toLowerCase()).toContain('career');
    expect(rw.title.toLowerCase()).toContain('relationship');
  });

  it('emits bilingual copy and a chart-explainable audit', () => {
    const d = buildWeeklyDigest({ weekStart: '2026-07-06', days: careerWeek, lagna: 'Vrishabha' });
    expect(d.bodySi.length).toBeGreaterThan(0);
    expect(d.actionSi.length).toBeGreaterThan(0);
    expect(d.audit.chartTheme).toBe('career');
    expect(d.audit.reasons.length).toBeGreaterThan(0);
  });

  it('focus areas boost a supported theme but the flag reports honestly', () => {
    // Career-dominant week; a money focus that the chart lightly supports.
    const withFocus = buildWeeklyDigest({
      weekStart: '2026-07-06', days: careerWeek, lagna: 'Vrishabha', focusAreas: ['money'],
    });
    expect(withFocus.focusHighlight?.theme).toBe('money');
    expect(typeof withFocus.audit.focusBoostApplied).toBe('boolean');
  });
});

describe('buildMonthlyDigest', () => {
  const monthDays: DigestDayInput[] = Array.from({ length: 30 }, (_, i) => {
    const date = `2026-08-${String(i + 1).padStart(2, '0')}`;
    // Health-dominant month with a strong window mid-month.
    const conf = i >= 10 && i <= 15 ? 0.85 : 0.4 + (i % 5) * 0.02;
    return day(date, 'health', conf, 'spiritual');
  });

  it('is deterministic and chart-personalized', () => {
    const a = buildMonthlyDigest({ monthStart: '2026-08-01', days: monthDays, lagna: 'Dhanu' });
    const b = buildMonthlyDigest({ monthStart: '2026-08-01', days: monthDays, lagna: 'Dhanu' });
    expect(b).toEqual(a);
    expect(a.dominantTheme).toBe('health');
    expect(a.mostActivatedArea).toBe('health');
  });

  it('picks 3 standout dates (date-ordered) and best/caution 5-day windows', () => {
    const d = buildMonthlyDigest({ monthStart: '2026-08-01', days: monthDays, lagna: 'Dhanu' });
    expect(d.standoutDates).toHaveLength(3);
    // Standout dates sorted ascending.
    const dates = d.standoutDates.map((s) => s.date);
    expect([...dates].sort()).toEqual(dates);
    // Best window falls in the strong mid-month stretch.
    expect(d.bestPeriod.start >= '2026-08-10' && d.bestPeriod.end <= '2026-08-16').toBe(true);
    expect(d.cautionPeriod.start).not.toBe(d.bestPeriod.start);
  });

  it('different Lagna month with a different dominant theme reads differently', () => {
    const moneyMonth = monthDays.map((dd, i) => day(dd.date, 'money', dd.confidenceScore, i % 2 ? 'business' : 'career'));
    const health = buildMonthlyDigest({ monthStart: '2026-08-01', days: monthDays, lagna: 'Dhanu' });
    const money = buildMonthlyDigest({ monthStart: '2026-08-01', days: moneyMonth, lagna: 'Vrishabha' });
    expect(health.dominantTheme).toBe('health');
    expect(money.dominantTheme).toBe('money');
    expect(health.body).not.toBe(money.body);
    expect(health.action).not.toBe(money.action);
  });
});
