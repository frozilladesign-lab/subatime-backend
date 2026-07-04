import {
  anyLocalScheduleFresh,
  isLocalScheduleFresh,
  LOCAL_SCHEDULE_MAX_AGE_MS,
  type LocalScheduleState,
} from './local-schedule-freshness';

/** 2026-07-04 06:02 UTC — mid-morning in Asia/Colombo (11:32). */
const NOW = new Date('2026-07-04T06:02:00.000Z');

function state(overrides: Partial<LocalScheduleState> = {}): LocalScheduleState {
  return {
    lastLocalScheduleAt: new Date('2026-07-04T05:00:00.000Z'),
    localScheduleThroughDate: '2026-07-05',
    deviceTimezone: 'UTC',
    notificationPermissionStatus: 'granted',
    ...overrides,
  };
}

describe('isLocalScheduleFresh', () => {
  it('fresh: granted permission, recent schedule, covers tomorrow', () => {
    expect(isLocalScheduleFresh(state(), NOW)).toBe(true);
  });

  it('stale: missing state allows FCM fallback', () => {
    expect(isLocalScheduleFresh(null, NOW)).toBe(false);
    expect(isLocalScheduleFresh(undefined, NOW)).toBe(false);
  });

  it('stale: denied or unknown permission allows FCM fallback', () => {
    expect(isLocalScheduleFresh(state({ notificationPermissionStatus: 'denied' }), NOW)).toBe(false);
    expect(isLocalScheduleFresh(state({ notificationPermissionStatus: 'unknown' }), NOW)).toBe(false);
    expect(isLocalScheduleFresh(state({ notificationPermissionStatus: null }), NOW)).toBe(false);
  });

  it('stale: lastLocalScheduleAt older than 36h allows FCM fallback', () => {
    const old = new Date(NOW.getTime() - LOCAL_SCHEDULE_MAX_AGE_MS - 60_000);
    expect(isLocalScheduleFresh(state({ lastLocalScheduleAt: old }), NOW)).toBe(false);

    const justInside = new Date(NOW.getTime() - LOCAL_SCHEDULE_MAX_AGE_MS + 60_000);
    expect(isLocalScheduleFresh(state({ lastLocalScheduleAt: justInside }), NOW)).toBe(true);
  });

  it('stale: through-date before tomorrow (schedule expiring today) allows FCM fallback', () => {
    expect(isLocalScheduleFresh(state({ localScheduleThroughDate: '2026-07-04' }), NOW)).toBe(false);
    expect(isLocalScheduleFresh(state({ localScheduleThroughDate: null }), NOW)).toBe(false);
    expect(isLocalScheduleFresh(state({ localScheduleThroughDate: 'not-a-date' }), NOW)).toBe(false);
  });

  it('tomorrow is computed in the DEVICE timezone, not UTC', () => {
    // 2026-07-04T20:30Z is already 2026-07-05 02:00 in Asia/Colombo (UTC+5:30),
    // so "tomorrow" there is 2026-07-06 — a schedule through 2026-07-05 is stale
    // for a Colombo device but still fresh for a UTC device.
    const lateUtcEvening = new Date('2026-07-04T20:30:00.000Z');
    const through0705 = {
      localScheduleThroughDate: '2026-07-05',
      lastLocalScheduleAt: new Date('2026-07-04T19:00:00.000Z'),
    };
    expect(
      isLocalScheduleFresh(state({ ...through0705, deviceTimezone: 'Asia/Colombo' }), lateUtcEvening),
    ).toBe(false);
    expect(
      isLocalScheduleFresh(state({ ...through0705, deviceTimezone: 'UTC' }), lateUtcEvening),
    ).toBe(true);
  });
});

describe('anyLocalScheduleFresh', () => {
  it('true when at least one device is fresh; false for none or empty', () => {
    const stale = state({ notificationPermissionStatus: 'denied' });
    expect(anyLocalScheduleFresh([stale, state()], NOW)).toBe(true);
    expect(anyLocalScheduleFresh([stale], NOW)).toBe(false);
    expect(anyLocalScheduleFresh([], NOW)).toBe(false);
  });
});
