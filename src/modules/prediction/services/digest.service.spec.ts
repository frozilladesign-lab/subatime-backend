import { PrismaService } from '../../../database/prisma.service';
import { DailyPredictionService } from './daily-prediction.service';
import { DigestService } from './digest.service';

/**
 * DigestService orchestration: reuse-not-regenerate per period, category/frequency gating,
 * and no-duplicate persistence. The pure timing rules live in digest-schedule.spec; the
 * engine digest content in the jyotisha-engine digest.spec.
 */

const NOW = new Date('2026-07-08T09:00:00.000Z'); // Wednesday, ISO week 28, July 2026

function themeScores(top: string): Record<string, number> {
  const s: Record<string, number> = {
    career: 0.1, money: 0.1, relationship: 0.1, health: 0.1,
    education: 0.1, travel: 0.1, business: 0.1, spiritual: 0.1, overall: 0.1,
  };
  s[top] = 1;
  return s;
}

function makeService(opts: {
  categories?: Record<string, boolean>;
  frequency?: string;
  existingRows?: unknown[];
}) {
  const settings = {
    categories: { weekly: true, monthly: true, ...(opts.categories ?? {}) },
    frequency: opts.frequency ?? 'important_only',
    quietHours: { enabled: true, start: '22:00', end: '06:00' },
    preferredTimes: { morning: '07:00', evening: '18:30' },
    focusAreas: [] as string[],
    tones: ['practical', 'balanced'],
    version: 1,
  };
  const userFindUnique = jest.fn(() =>
    Promise.resolve({
      preferences: { notificationSettings: settings },
      birthProfile: { timezone: 'Asia/Colombo', onboardingIntent: null, lagna: 'Vrishabha' },
    }),
  );
  const digestFindMany = jest.fn(() => Promise.resolve(opts.existingRows ?? []));
  const digestUpsert = jest.fn((args: { create: Record<string, unknown> }) =>
    Promise.resolve({ id: 'd1', ...args.create }),
  );
  const prisma = {
    user: { findUnique: userFindUnique } as unknown as PrismaService['user'],
    userDigest: {
      findMany: digestFindMany,
      upsert: digestUpsert,
    } as unknown as PrismaService['userDigest'],
  } as unknown as PrismaService;

  const getDigestDaySignals = jest.fn((_uid: string, dates: string[]) =>
    Promise.resolve(
      dates.map((date, i) => ({
        date,
        dominantTheme: 'career',
        themeScores: themeScores('career'),
        confidenceScore: 0.4 + (i % 5) * 0.05,
      })),
    ),
  );
  const daily = { getDigestDaySignals } as unknown as DailyPredictionService;

  const service = new DigestService(prisma, daily);
  return { service, digestUpsert, digestFindMany, getDigestDaySignals };
}

describe('DigestService.getUserDigests', () => {
  it('generates weekly + monthly and persists them (career-personalized)', async () => {
    const { service, digestUpsert } = makeService({});
    const out = await service.getUserDigests('user-1', NOW);

    expect(out.weekly).not.toBeNull();
    expect(out.monthly).not.toBeNull();
    expect(out.weekly!.digest.dominantTheme).toBe('career');
    expect(out.monthly!.digest.dominantTheme).toBe('career');
    // Weekly fires Sunday 19:00 local; monthly the 1st 07:30 local.
    expect(out.weekly!.sendAtLocal).toBe('19:00');
    expect(out.monthly!.sendAtLocal).toBe('07:30');
    expect(out.weekly!.periodKey).toBe('2026-W28');
    expect(out.monthly!.periodKey).toBe('2026-07');
    expect(digestUpsert).toHaveBeenCalledTimes(2);
  });

  it('reuses a persisted digest for the same period (no regeneration)', async () => {
    const stored = {
      kind: 'weekly',
      periodKey: '2026-W28',
      sendAt: new Date(),
      timezone: 'Asia/Colombo',
      payload: {
        kind: 'weekly', periodKey: '2026-W28', sendAtLocal: '19:00', sendDate: '2026-07-12',
        sendAtUtc: '2026-07-12T13:30:00.000Z', timezone: 'Asia/Colombo', category: 'weekly',
        digest: { version: 1, dominantTheme: 'career', title: 'x', body: 'y' },
      },
    };
    const { service, getDigestDaySignals } = makeService({ existingRows: [stored] });
    const out = await service.getUserDigests('user-1', NOW);
    expect(out.weekly!.digest.dominantTheme).toBe('career');
    // Weekly reused → signals only computed for the monthly digest, not weekly.
    const kinds = getDigestDaySignals.mock.calls.map((c) => (c[1] as string[]).length);
    expect(kinds).not.toContain(7); // no fresh 7-day weekly computation
  });

  it('category OFF → that digest is not returned', async () => {
    const { service } = makeService({ categories: { weekly: false } });
    const out = await service.getUserDigests('user-1', NOW);
    expect(out.weekly).toBeNull();
    expect(out.monthly).not.toBeNull();
    expect(out.dropped).toContainEqual({ kind: 'weekly', periodKey: '2026-W28', reason: 'category_disabled' });
  });

  it('frequency OFF → no digests at all', async () => {
    const { service, digestUpsert } = makeService({ frequency: 'off' });
    const out = await service.getUserDigests('user-1', NOW);
    expect(out.weekly).toBeNull();
    expect(out.monthly).toBeNull();
    expect(digestUpsert).not.toHaveBeenCalled();
  });
});
