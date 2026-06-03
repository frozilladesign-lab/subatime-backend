import { buildPlanDayCopy, windowLabelKey } from './copy-contract.builder';

describe('buildPlanDayCopy', () => {
  it('maps rating and focus to headline and summary keys', () => {
    const copy = buildPlanDayCopy({
      rating: 'mixed',
      focus: 'career',
      confidenceScore: 0.74,
      focusWeightPct: 72,
      bestWindow: { label: 'Morning Focus', start: '08:00', end: '10:00' },
      cautionWindow: { label: 'Afternoon Push', start: '14:00', end: '16:00' },
    });

    expect(copy.headline.key).toBe('guidance.headline.mixed');
    expect(copy.summary.key).toBe('guidance.summary.mixed');
    expect(copy.summary.vars?.focus).toEqual({ key: 'categories.career', vars: {} });
    expect(windowLabelKey('Morning Focus')).toBe('windows.morning_focus');
  });
});
