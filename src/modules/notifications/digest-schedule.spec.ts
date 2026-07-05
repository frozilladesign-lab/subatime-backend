import { buildDigestSchedule, type DigestScheduleSettings, type DigestSlot } from './digest-schedule';

const WEEKLY: DigestSlot = { kind: 'weekly', periodKey: '2026-W28', date: '2026-07-12', hm: '19:00' };
const MONTHLY: DigestSlot = { kind: 'monthly', periodKey: '2026-07', date: '2026-07-01', hm: '07:30' };

function settings(over: Partial<DigestScheduleSettings> = {}): DigestScheduleSettings {
  return {
    categories: { weekly: true, monthly: true },
    frequency: 'important_only',
    quietHours: { enabled: true, start: '22:00', end: '06:00' },
    ...over,
  };
}

describe('buildDigestSchedule', () => {
  it('schedules weekly Sunday 19:00 and monthly 1st 07:30 by default', () => {
    const p = buildDigestSchedule({ weekly: WEEKLY, monthly: MONTHLY, settings: settings() });
    const w = p.scheduled.find((s) => s.kind === 'weekly')!;
    const m = p.scheduled.find((s) => s.kind === 'monthly')!;
    expect(w.sendAt).toBe('19:00');
    expect(m.sendAt).toBe('07:30');
    expect(p.dropped).toEqual([]);
  });

  it('frequency off schedules nothing', () => {
    const p = buildDigestSchedule({ weekly: WEEKLY, monthly: MONTHLY, settings: settings({ frequency: 'off' }) });
    expect(p.scheduled).toEqual([]);
    expect(p.dropped.every((d) => d.reason === 'frequency_off')).toBe(true);
  });

  it('digests are allowed in important_only (low-frequency, not daily-capped)', () => {
    const p = buildDigestSchedule({ weekly: WEEKLY, monthly: MONTHLY, settings: settings({ frequency: 'important_only' }) });
    expect(p.scheduled).toHaveLength(2);
  });

  it('category OFF drops that digest only', () => {
    const p = buildDigestSchedule({
      weekly: WEEKLY, monthly: MONTHLY,
      settings: settings({ categories: { weekly: false, monthly: true } }),
    });
    expect(p.scheduled.map((s) => s.kind)).toEqual(['monthly']);
    expect(p.dropped).toContainEqual({ kind: 'weekly', periodKey: '2026-W28', reason: 'category_disabled' });
  });

  it('already-sent period keys are not rescheduled (no duplicates)', () => {
    const p = buildDigestSchedule({
      weekly: WEEKLY, monthly: MONTHLY, settings: settings(),
      alreadySent: new Set(['2026-W28']),
    });
    expect(p.scheduled.some((s) => s.kind === 'weekly')).toBe(false);
    expect(p.dropped).toContainEqual({ kind: 'weekly', periodKey: '2026-W28', reason: 'already_sent' });
    expect(p.scheduled.some((s) => s.kind === 'monthly')).toBe(true);
  });

  it('quiet hours move a digest to the quiet-window end', () => {
    // Weekly 19:00 with quiet 18:00–07:00 → shifted to 07:00.
    const p = buildDigestSchedule({
      weekly: WEEKLY, settings: settings({ quietHours: { enabled: true, start: '18:00', end: '07:00' } }),
    });
    const w = p.scheduled.find((s) => s.kind === 'weekly')!;
    expect(w.sendAt).toBe('07:00');
    expect(w.reason).toContain('quiet_shift');
  });

  it('same-day monthly+weekly: monthly first, weekly ≥4h later', () => {
    // Monthly on the 1st 07:30; weekly also on the 1st at 09:00 → weekly pushed to 11:30.
    const weeklySameDay: DigestSlot = { ...WEEKLY, date: '2026-07-01', hm: '09:00' };
    const p = buildDigestSchedule({ weekly: weeklySameDay, monthly: MONTHLY, settings: settings() });
    const m = p.scheduled.find((s) => s.kind === 'monthly')!;
    const w = p.scheduled.find((s) => s.kind === 'weekly')!;
    expect(m.sendAt).toBe('07:30');
    expect(w.sendAt).toBe('11:30'); // 07:30 + 4h
    expect(w.reason).toContain('spaced_after_monthly');
  });

  it('same-day when 4h-later would be too late: weekly bumped to next evening', () => {
    // Monthly at 18:00, weekly same day → 22:00 (past 21:00 cutoff / into quiet) → next evening.
    const monthlyLate: DigestSlot = { ...MONTHLY, hm: '18:00' };
    const weeklySameDay: DigestSlot = { ...WEEKLY, date: '2026-07-01', hm: '19:00' };
    const p = buildDigestSchedule({ weekly: weeklySameDay, monthly: monthlyLate, settings: settings() });
    const w = p.scheduled.find((s) => s.kind === 'weekly')!;
    expect(w.date).toBe('2026-07-02');
    expect(w.sendAt).toBe('19:00');
    expect(w.reason).toContain('bumped_next_evening');
  });

  it('is deterministic', () => {
    const a = buildDigestSchedule({ weekly: WEEKLY, monthly: MONTHLY, settings: settings() });
    const b = buildDigestSchedule({ weekly: WEEKLY, monthly: MONTHLY, settings: settings() });
    expect(b).toEqual(a);
  });
});
