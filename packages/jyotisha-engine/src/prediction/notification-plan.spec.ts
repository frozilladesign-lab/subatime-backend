import {
  buildNotificationCandidates,
  type BuildNotificationCandidatesInput,
} from './notification-candidates';
import {
  buildNotificationPlan,
  type NotificationPlanSettings,
} from './notification-plan';

const BLOCKS = [
  { start: '06:00', end: '08:00', label: 'Early Morning' },
  { start: '08:00', end: '10:00', label: 'Morning Focus' },
  { start: '10:00', end: '12:00', label: 'Late Morning' },
  { start: '12:00', end: '14:00', label: 'Noon Window' },
  { start: '14:00', end: '16:00', label: 'Afternoon Push' },
  { start: '16:00', end: '18:00', label: 'Evening Start' },
  { start: '18:00', end: '20:00', label: 'Evening Prime' },
  { start: '20:00', end: '22:00', label: 'Night Calm' },
];

function candidatesInput(
  overrides: Partial<BuildNotificationCandidatesInput> = {},
): BuildNotificationCandidatesInput {
  return {
    date: '2026-07-05',
    timezone: 'Asia/Colombo',
    blocks: BLOCKS,
    goodTimes: [BLOCKS[6], BLOCKS[2]], // peak 18:00, strong 10:00
    badTimes: [BLOCKS[4], BLOCKS[5]], // caution 14:00, weak 16:00
    transits: [],
    confidenceScore: 0.72,
    dominantContext: 'overall',
    lagna: 'Vrishabha',
    summary: 'Based on Vrishabha lagna and Rohini, steady focus favors the evening.',
    ...overrides,
  };
}

function settings(overrides: Partial<NotificationPlanSettings> = {}): NotificationPlanSettings {
  return {
    categories: {
      dailyGuidance: true, career: true, money: true, relationship: true,
      health: true, travel: true, bestTime: true, avoidTime: true,
      weekly: true, monthly: true,
    },
    frequency: 'important_only',
    preferredTimes: { morning: '07:00', evening: '18:30' },
    quietHours: { enabled: true, start: '22:00', end: '06:00' },
    ...overrides,
  };
}

describe('candidate categories & importance (Phase B)', () => {
  it('labels candidates: guidance, best_time, avoid_time, topical peak', () => {
    const out = buildNotificationCandidates(candidatesInput({ focusAreas: ['money'] }));
    expect(out.guidance.map((g) => g.category)).toEqual(['daily_guidance', 'daily_guidance']);
    expect(out.bestWindow!.category).toBe('best_time');
    const peak = out.blocks.find((b) => b.type === 'peak')!;
    expect(peak.category).toBe('money');
    const caution = out.blocks.find((b) => b.priority === 3)!;
    expect(caution.category).toBe('avoid_time');
    expect(out.focusTopic).toBe('money');
  });

  it('focusAreas boost importance: matching peak/best-window become critical', () => {
    const focused = buildNotificationCandidates(candidatesInput({ focusAreas: ['career'] }));
    const neutral = buildNotificationCandidates(candidatesInput());
    expect(focused.blocks.find((b) => b.type === 'peak')!.importance).toBe('critical');
    expect(focused.bestWindow!.importance).toBe('critical');
    expect(neutral.blocks.find((b) => b.type === 'peak')!.importance).toBe('high');
    expect(neutral.bestWindow!.importance).toBe('high');
  });

  it('focus areas change the topical copy emphasis', () => {
    const money = buildNotificationCandidates(candidatesInput({ focusAreas: ['money'] }));
    expect(money.blocks.find((b) => b.type === 'peak')!.body).toContain('money');
    const rel = buildNotificationCandidates(candidatesInput({ focusAreas: ['relationship'] }));
    expect(rel.bestWindow!.body).toContain('conversations');
  });
});

describe('tone variants', () => {
  const base = () => candidatesInput({ tones: ['practical', 'balanced'] });

  it('practical+balanced keeps the base voice (default)', () => {
    const a = buildNotificationCandidates(base());
    const b = buildNotificationCandidates(candidatesInput());
    expect(a.blocks).toEqual(b.blocks);
    expect(a.tonesApplied).toEqual(['practical', 'balanced']);
  });

  it('simple keeps only the first sentence', () => {
    const out = buildNotificationCandidates(candidatesInput({ tones: ['simple'] }));
    const peak = out.blocks.find((b) => b.type === 'peak')!;
    expect(peak.body.match(/[.!?]/g)!.length).toBe(1);
  });

  it('spiritual adds a gentle grounding line', () => {
    const out = buildNotificationCandidates(candidatesInput({ tones: ['spiritual', 'balanced'] }));
    expect(out.guidance[0].body).toContain('trust your timing');
    expect(out.guidance[0].bodySi).toContain('විශ්වාස');
  });

  it('detailed appends the astrology reason (lagna/transit)', () => {
    const out = buildNotificationCandidates(candidatesInput({ tones: ['detailed', 'practical'] }));
    const peak = out.blocks.find((b) => b.type === 'peak')!;
    expect(peak.body).toContain('Vrishabha lagna');
  });

  it('positive softens caution wording — no scary copy', () => {
    const out = buildNotificationCandidates(candidatesInput({ tones: ['positive'] }));
    const caution = out.blocks.find((b) => b.priority === 3)!;
    expect(caution.body).not.toMatch(/\bAvoid\b/);
    expect(caution.body.toLowerCase()).not.toContain('bad luck');
    const weak = out.blocks.find((b) => b.priority === 4)!;
    expect(weak.body).not.toContain('Conserve energy.');
  });
});

describe('buildNotificationPlan — frequency', () => {
  const candidates = () => buildNotificationCandidates(candidatesInput({ focusAreas: ['career'] }));

  it('off schedules nothing (all dropped as frequency_off)', () => {
    const plan = buildNotificationPlan({ candidates: candidates(), settings: settings({ frequency: 'off' }) });
    expect(plan.scheduled).toEqual([]);
    expect(plan.dropped.length).toBeGreaterThan(0);
    expect(plan.dropped.every((d) => d.reason === 'frequency_off')).toBe(true);
  });

  it('important_only (default) caps at 2: morning guidance + one high/critical alert', () => {
    const plan = buildNotificationPlan({ candidates: candidates(), settings: settings() });
    expect(plan.scheduled).toHaveLength(2);
    expect(plan.scheduled[0].candidateId).toBe('daily-morning');
    expect(plan.scheduled[0].sendAt).toBe('07:00'); // preferred morning time
    const alert = plan.scheduled[1];
    expect(['best_time', 'avoid_time']).toContain(alert.category);
    expect(['critical', 'high']).toContain(alert.importance);
  });

  it('one_per_day keeps only the morning guidance', () => {
    const plan = buildNotificationPlan({ candidates: candidates(), settings: settings({ frequency: 'one_per_day' }) });
    expect(plan.scheduled).toHaveLength(1);
    expect(plan.scheduled[0].candidateId).toBe('daily-morning');
  });

  it('two_per_day keeps morning + the top alert', () => {
    const plan = buildNotificationPlan({ candidates: candidates(), settings: settings({ frequency: 'two_per_day' }) });
    expect(plan.scheduled).toHaveLength(2);
    expect(plan.scheduled.map((s) => s.candidateId)).toContain('daily-morning');
  });

  it('advanced allows more but never exceeds the daily cap', () => {
    const plan = buildNotificationPlan({ candidates: candidates(), settings: settings({ frequency: 'advanced' }) });
    expect(plan.scheduled.length).toBeGreaterThan(2);
    expect(plan.scheduled.length).toBeLessThanOrEqual(5);
  });
});

describe('buildNotificationPlan — filters', () => {
  it('category OFF removes those candidates with reason category_disabled', () => {
    const candidates = buildNotificationCandidates(candidatesInput({ focusAreas: ['money'] }));
    const plan = buildNotificationPlan({
      candidates,
      settings: settings({ categories: { ...settings().categories, bestTime: false } }),
    });
    expect(plan.scheduled.some((s) => s.category === 'best_time')).toBe(false);
    expect(plan.dropped.some((d) => d.candidateId === 'best-window' && d.reason === 'category_disabled')).toBe(true);
  });

  it('dailyGuidance OFF removes guidance but alerts still work', () => {
    const candidates = buildNotificationCandidates(candidatesInput());
    const plan = buildNotificationPlan({
      candidates,
      settings: settings({ categories: { ...settings().categories, dailyGuidance: false } }),
    });
    expect(plan.scheduled.every((s) => s.category !== 'daily_guidance')).toBe(true);
    expect(plan.scheduled.length).toBeGreaterThan(0);
  });

  it('Rahu Kālam suppresses best-time alerts whose send/window falls inside it', () => {
    // Peak 18:00–20:00; best-window alert fires 17:52. Rahu Kāla 17:30–19:00 covers both.
    const candidates = buildNotificationCandidates(
      candidatesInput({ rahuKalamLocal: { start: '17:30', end: '19:00' } }),
    );
    expect(candidates.rahuKalam).toEqual({ start: '17:30', end: '19:00' });
    const plan = buildNotificationPlan({ candidates, settings: settings() });
    expect(plan.dropped.some((d) => d.candidateId === 'best-window' && d.reason === 'rahu_kalam')).toBe(true);
    expect(plan.scheduled.some((s) => s.category === 'best_time')).toBe(false);
    // Avoid-time / guidance messages remain allowed.
    expect(plan.scheduled.some((s) => s.candidateId === 'daily-morning')).toBe(true);
  });

  it('quiet hours shift guidance to the quiet end and drop dead alerts', () => {
    // Morning preferred at 05:00 (inside 22:00–06:00 quiet) → shifted to 06:00.
    const candidates = buildNotificationCandidates(candidatesInput());
    const plan = buildNotificationPlan({
      candidates,
      settings: settings({ preferredTimes: { morning: '05:00', evening: '18:30' } }),
    });
    const morning = plan.scheduled.find((s) => s.candidateId === 'daily-morning')!;
    expect(morning.sendAt).toBe('06:00');
    expect(morning.reason).toContain('quiet_shift');
  });

  it('quiet hours drop an alert whose window itself is inside quiet hours', () => {
    // Peak at Night Calm 20:00 with quiet hours 19:00–23:00 → alert (19:52) and window (20:00) dead.
    const candidates = buildNotificationCandidates(
      candidatesInput({ goodTimes: [BLOCKS[7], BLOCKS[2]] }),
    );
    const plan = buildNotificationPlan({
      candidates,
      settings: settings({ quietHours: { enabled: true, start: '19:00', end: '23:00' } }),
    });
    expect(plan.dropped.some((d) => d.candidateId === 'best-window' && d.reason === 'quiet_hours')).toBe(true);
  });

  it('avoid-time alert fires before the caution window with helpful wording', () => {
    const candidates = buildNotificationCandidates(candidatesInput({ focusAreas: ['money'] }));
    const plan = buildNotificationPlan({
      candidates,
      settings: settings({ frequency: 'advanced' }),
    });
    const avoid = plan.scheduled.find((s) => s.category === 'avoid_time')!;
    expect(avoid.sendAt).toBe('13:50'); // 10 min before the 14:00 caution block
    expect(avoid.body.toLowerCase()).not.toContain('bad luck');
    expect(avoid.body).toContain('light');
  });

  it('the plan is deterministic', () => {
    const c = buildNotificationCandidates(candidatesInput({ focusAreas: ['career'] }));
    const a = buildNotificationPlan({ candidates: c, settings: settings() });
    const b = buildNotificationPlan({ candidates: c, settings: settings() });
    expect(b).toEqual(a);
  });
});
