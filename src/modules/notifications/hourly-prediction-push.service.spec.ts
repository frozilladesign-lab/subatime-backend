import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { DailyPredictionService } from '../prediction/services/daily-prediction.service';
import { FirebasePushService } from '../push/firebase-push.service';
import { HourlyPredictionPushService } from './hourly-prediction-push.service';

/**
 * Phase 3 dedup: the hourly FCM block push is a FALLBACK. Users whose devices report a
 * fresh local schedule are skipped; stale users get FCM with wording taken verbatim
 * from the stored engine-built notificationCandidates (never composed here).
 *
 * Phase 4 dedup: block pushes claim a persistent NotificationJob row under the unique
 * key (userId, date, candidateId, type) BEFORE sending, so the same block can never be
 * pushed twice across restarts, duplicate cron ticks, or multiple instances.
 */

/** 06:02 UTC — the 06:00 block is "starting now" for a UTC-timezone profile. */
const NOW = new Date('2026-07-04T06:02:00.000Z');

const BLOCK_0600_CANDIDATE = {
  id: 'block-0600',
  type: 'caution',
  startTime: '06:00',
  endTime: '08:00',
  score: 42,
  priority: 3,
  category: 'avoid_time',
  importance: 'high',
  title: '⚠️ Early Morning — Low-energy hora',
  titleSi: '⚠️ පුරා උදෑසන',
  body: 'Low-energy hora. Conserve and observe.',
  bodySi: 'අඩු ශක්ති කාලයක්. විවේක ගෙන නිරීක්ෂණය කරන්න.',
  deepLink: 'subatime://feed?planDate=2026-07-04&block=06%3A00',
  reasonCode: 'context:overall',
  astroSource: { context: 'overall', confidenceScore: 0.6 },
};

/** Shared dedup store simulating the (userId, date, candidateId, type) unique index. */
function makeNotificationJobMock(claimedKeys: Set<string>) {
  const create = jest.fn((args: { data: Record<string, unknown> }) => {
    const d = args.data;
    const key = [d.userId, (d.date as Date)?.toISOString().slice(0, 10), d.candidateId, d.type].join(':');
    if (claimedKeys.has(key)) {
      return Promise.reject(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
    }
    claimedKeys.add(key);
    return Promise.resolve({ id: `job-${claimedKeys.size}` });
  });
  const update = jest.fn((_args: { where: unknown; data: Record<string, unknown> }) =>
    Promise.resolve({ id: 'job-updated' }),
  );
  return { create, update };
}

function makeService(opts: {
  localSchedules: unknown[];
  storedCandidates?: unknown;
  pushSucceeds?: boolean;
  claimedKeys?: Set<string>;
}) {
  const sendEachToTokens = opts.pushSucceeds === false
    ? jest.fn(() =>
        Promise.resolve({
          successCount: 0,
          failureCount: 1,
          responses: [{ success: false, error: { code: 'messaging/internal-error' } }],
        }),
      )
    : jest.fn(() =>
    Promise.resolve({
      successCount: 1,
      failureCount: 0,
      responses: [{ success: true }],
    }),
  );
  const push = {
    isReady: () => true,
    sendEachToTokens,
  } as unknown as FirebasePushService;

  const dailyPredictionFindUnique = jest.fn(() =>
    Promise.resolve(
      opts.storedCandidates === undefined
        ? null
        : { notificationCandidates: opts.storedCandidates },
    ),
  );
  const claimedKeys = opts.claimedKeys ?? new Set<string>();
  const notificationJob = makeNotificationJobMock(claimedKeys);
  const prisma = {
    user: {
      findMany: jest.fn(() =>
        Promise.resolve([
          {
            id: 'user-1',
            name: 'Nadia',
            preferences: {},
            birthProfile: { timezone: 'UTC' },
            deviceTokens: [{ token: 'tok-1' }],
            localNotificationSchedules: opts.localSchedules,
          },
        ]),
      ),
    } as unknown as PrismaService['user'],
    dailyPrediction: {
      findUnique: dailyPredictionFindUnique,
    } as unknown as PrismaService['dailyPrediction'],
    notificationJob: notificationJob as unknown as PrismaService['notificationJob'],
    userDeviceToken: {
      deleteMany: jest.fn(() => Promise.resolve({ count: 0 })),
    } as unknown as PrismaService['userDeviceToken'],
  } as unknown as PrismaService;

  const generateForUser = jest.fn(() => Promise.resolve(null));
  const dailyPrediction = { generateForUser } as unknown as DailyPredictionService;

  const service = new HourlyPredictionPushService(prisma, dailyPrediction, push);
  return {
    service,
    sendEachToTokens,
    dailyPredictionFindUnique,
    generateForUser,
    notificationJob,
    claimedKeys,
  };
}

const FRESH_SCHEDULE = {
  lastLocalScheduleAt: new Date('2026-07-04T05:30:00.000Z'),
  localScheduleThroughDate: '2026-07-05',
  deviceTimezone: 'UTC',
  notificationPermissionStatus: 'granted',
};

const STORED = {
  version: 1,
  date: '2026-07-04',
  timezone: 'UTC',
  blocks: [BLOCK_0600_CANDIDATE],
  powerHours: [],
};

describe('HourlyPredictionPushService (Phase 3 local-first dedup)', () => {
  it('skips FCM entirely when a device has a fresh local schedule', async () => {
    const { service, sendEachToTokens, dailyPredictionFindUnique } = makeService({
      localSchedules: [FRESH_SCHEDULE],
      storedCandidates: STORED,
    });

    await service.sendBlockNotifications(NOW);

    expect(sendEachToTokens).not.toHaveBeenCalled();
    // Skipped before even reading the prediction — no wasted work.
    expect(dailyPredictionFindUnique).not.toHaveBeenCalled();
  });

  it('sends FCM fallback with stored candidate wording when the local schedule is stale', async () => {
    const { service, sendEachToTokens } = makeService({
      localSchedules: [
        { ...FRESH_SCHEDULE, lastLocalScheduleAt: new Date('2026-07-01T05:30:00.000Z') },
      ],
      storedCandidates: STORED,
    });

    await service.sendBlockNotifications(NOW);

    expect(sendEachToTokens).toHaveBeenCalledTimes(1);
    const call = (sendEachToTokens.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    // Wording comes verbatim from the stored candidate — never composed in this service.
    expect(call.title).toBe(BLOCK_0600_CANDIDATE.title);
    expect(call.body).toBe(BLOCK_0600_CANDIDATE.body);
    expect((call.data as Record<string, string>).candidateId).toBe('block-0600');
  });

  it('sends FCM fallback when notification permission is denied on all devices', async () => {
    const { service, sendEachToTokens } = makeService({
      localSchedules: [{ ...FRESH_SCHEDULE, notificationPermissionStatus: 'denied' }],
      storedCandidates: STORED,
    });

    await service.sendBlockNotifications(NOW);

    expect(sendEachToTokens).toHaveBeenCalledTimes(1);
  });

  it('sends FCM fallback when no device ever reported a local schedule', async () => {
    const { service, sendEachToTokens } = makeService({
      localSchedules: [],
      storedCandidates: STORED,
    });

    await service.sendBlockNotifications(NOW);

    expect(sendEachToTokens).toHaveBeenCalledTimes(1);
  });

  it('never pushes without a stored/generated candidate (no local composition fallback)', async () => {
    const { service, sendEachToTokens, generateForUser } = makeService({
      localSchedules: [],
      storedCandidates: undefined, // no stored prediction row
    });

    await service.sendBlockNotifications(NOW);

    expect(generateForUser).toHaveBeenCalled();
    expect(sendEachToTokens).not.toHaveBeenCalled();
  });
});

describe('HourlyPredictionPushService (Phase 4 persistent DB dedup)', () => {
  it('claims a NotificationJob row before sending FCM', async () => {
    const { service, sendEachToTokens, notificationJob } = makeService({
      localSchedules: [],
      storedCandidates: STORED,
    });

    await service.sendBlockNotifications(NOW);

    expect(notificationJob.create).toHaveBeenCalledTimes(1);
    const created = (notificationJob.create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(created.type).toBe('prediction_block_fallback');
    expect(created.candidateId).toBe('block-0600');
    expect(created.status).toBe('sent'); // delivered inline — dispatcher only polls pending
    expect((created.date as Date).toISOString().slice(0, 10)).toBe('2026-07-04');
    expect(sendEachToTokens).toHaveBeenCalledTimes(1);
  });

  it('skips FCM when the dedup key is already claimed (restart / second cron tick / other instance)', async () => {
    // Pre-claim the exact key this run would use.
    const claimedKeys = new Set<string>([
      ['user-1', '2026-07-04', 'block-0600', 'prediction_block_fallback'].join(':'),
    ]);
    const { service, sendEachToTokens, notificationJob } = makeService({
      localSchedules: [],
      storedCandidates: STORED,
      claimedKeys,
    });

    await service.sendBlockNotifications(NOW);

    expect(notificationJob.create).toHaveBeenCalledTimes(1); // attempted…
    expect(sendEachToTokens).not.toHaveBeenCalled(); // …but P2002 → no send
  });

  it('two runs in the same block window send exactly once (persistent across ticks)', async () => {
    const claimedKeys = new Set<string>();
    const first = makeService({ localSchedules: [], storedCandidates: STORED, claimedKeys });
    await first.service.sendBlockNotifications(NOW);
    expect(first.sendEachToTokens).toHaveBeenCalledTimes(1);

    // Second tick (e.g. after a deploy) reuses the shared dedup store.
    const second = makeService({ localSchedules: [], storedCandidates: STORED, claimedKeys });
    await second.service.sendBlockNotifications(NOW);
    expect(second.sendEachToTokens).not.toHaveBeenCalled();
  });

  it('marks the job failed (and does not resend) when FCM delivery fails', async () => {
    const { service, sendEachToTokens, notificationJob } = makeService({
      localSchedules: [],
      storedCandidates: STORED,
      pushSucceeds: false,
    });

    await service.sendBlockNotifications(NOW);

    expect(sendEachToTokens).toHaveBeenCalledTimes(1);
    expect(notificationJob.update).toHaveBeenCalledTimes(1);
    const upd = (notificationJob.update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(upd.status).toBe('failed');
    expect((upd.payload as Record<string, unknown>).error).toBe('fcm_all_tokens_failed');
  });
});
