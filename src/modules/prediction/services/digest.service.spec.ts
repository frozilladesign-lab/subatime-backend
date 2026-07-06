import { PrismaService } from '../../../database/prisma.service';
import { GeminiService } from '../../ai/services/gemini.service';
import { DailyPredictionService } from './daily-prediction.service';
import { DigestService } from './digest.service';
import { DigestAiService } from './digest-ai/digest-ai.service';
import { buildChartHash, buildFocusHash } from './digest-ai/digest-ai.hash';
import { DIGEST_AI_PROMPT_VERSION, type DigestLocale } from './digest-ai/digest-ai.types';

/**
 * DigestService orchestration: reuse-not-regenerate per period, category/frequency gating,
 * and no-duplicate persistence. The pure timing rules live in digest-schedule.spec; the
 * engine digest content in the jyotisha-engine digest.spec; AI-first content + fallback in
 * digest-ai.*.spec. These tests run with Gemini NOT configured (template content).
 */

const NOW = new Date('2026-07-08T09:00:00.000Z'); // Wednesday, ISO week 28, July 2026

// Content identity of the default test user (language si, empty focus, default tones, no nakshatra).
const DEFAULT_LOCALE: DigestLocale = 'si';
const DEFAULT_FOCUS_HASH = buildFocusHash({
  focusAreas: [],
  tones: ['practical', 'balanced'],
  locale: DEFAULT_LOCALE,
});
const DEFAULT_CHART_HASH = buildChartHash({ lagna: 'Vrishabha', nakshatra: undefined });

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
  weeklyRow?: unknown;
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
  const digestFindUnique = jest.fn(() => Promise.resolve(opts.weeklyRow ?? null));
  const digestUpsert = jest.fn((args: { create: Record<string, unknown> }) =>
    Promise.resolve({ id: 'd1', ...args.create }),
  );
  const prisma = {
    user: { findUnique: userFindUnique } as unknown as PrismaService['user'],
    userDigest: {
      findMany: digestFindMany,
      findUnique: digestFindUnique,
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

  // Gemini not configured → DigestAiService returns the deterministic (template) digest.
  const digestAi = new DigestAiService({ isConfigured: () => false } as unknown as GeminiService);

  const service = new DigestService(prisma, daily, digestAi);
  return { service, digestUpsert, digestFindMany, digestFindUnique, getDigestDaySignals };
}

/** A stored weekly UserDigest row with matching identity + per-day AI content for one date. */
function makeWeeklyRow(overrides: {
  focusHash?: string;
  chartHash?: string;
  locale?: string;
  promptVersion?: string;
  dailyContent?: unknown[];
  aiProvider?: string;
  contentStatus?: string;
} = {}) {
  const day = (date: string) => ({
    date,
    headline: `Headline ${date}`,
    summary: `Summary ${date}`,
    do: `Do ${date}`,
    avoid: `Avoid ${date}`,
    notification: `Notify ${date}`,
  });
  return {
    kind: 'weekly',
    periodKey: '2026-W28',
    sendAt: new Date(),
    timezone: 'Asia/Colombo',
    locale: overrides.locale ?? DEFAULT_LOCALE,
    focusHash: overrides.focusHash ?? DEFAULT_FOCUS_HASH,
    chartHash: overrides.chartHash ?? DEFAULT_CHART_HASH,
    promptVersion: overrides.promptVersion ?? DIGEST_AI_PROMPT_VERSION,
    aiProvider: overrides.aiProvider ?? 'gemini',
    contentStatus: overrides.contentStatus ?? 'generated',
    payload: {
      kind: 'weekly',
      periodKey: '2026-W28',
      dailyContent: overrides.dailyContent ?? ['2026-07-06', '2026-07-08', '2026-07-10'].map(day),
    },
  };
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
      locale: DEFAULT_LOCALE,
      focusHash: DEFAULT_FOCUS_HASH,
      chartHash: DEFAULT_CHART_HASH,
      promptVersion: DIGEST_AI_PROMPT_VERSION,
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
    const kinds = getDigestDaySignals.mock.calls.map((c) => c[1].length);
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

describe('DigestService.getWeeklyDailyOverlay (daily activation bridge)', () => {
  it('overlays today from the stored weekly pack when identity matches', async () => {
    const { service, digestUpsert } = makeService({ weeklyRow: makeWeeklyRow() });
    const out = await service.getWeeklyDailyOverlay('user-1', '2026-07-08');
    expect(out.source).toBe('weekly_pack');
    expect(out.content?.date).toBe('2026-07-08');
    expect(out.content?.headline).toBe('Headline 2026-07-08');
    expect(out.content?.notification).toBe('Notify 2026-07-08');
    expect(out.provenance?.periodKey).toBe('2026-W28');
    expect(out.provenance?.provider).toBe('gemini');
    // Read-only: no regeneration/persistence happens on the read path.
    expect(digestUpsert).not.toHaveBeenCalled();
  });

  it('missing weekly pack → deterministic fallback (never blank)', async () => {
    const { service } = makeService({ weeklyRow: null });
    const out = await service.getWeeklyDailyOverlay('user-1', '2026-07-08');
    expect(out.source).toBe('deterministic');
    expect(out.reason).toBe('no_weekly_pack');
    expect(out.content).toBeUndefined();
  });

  it('wrong chartHash → stale, deterministic fallback', async () => {
    const { service } = makeService({ weeklyRow: makeWeeklyRow({ chartHash: 'deadbeef' }) });
    const out = await service.getWeeklyDailyOverlay('user-1', '2026-07-08');
    expect(out.source).toBe('deterministic');
    expect(out.reason).toBe('stale_pack');
  });

  it('wrong focusHash → stale, deterministic fallback', async () => {
    const { service } = makeService({ weeklyRow: makeWeeklyRow({ focusHash: 'deadbeef' }) });
    const out = await service.getWeeklyDailyOverlay('user-1', '2026-07-08');
    expect(out.source).toBe('deterministic');
    expect(out.reason).toBe('stale_pack');
  });

  it('wrong locale → stale, deterministic fallback', async () => {
    const { service } = makeService({ weeklyRow: makeWeeklyRow({ locale: 'en' }) });
    const out = await service.getWeeklyDailyOverlay('user-1', '2026-07-08');
    expect(out.source).toBe('deterministic');
    expect(out.reason).toBe('stale_pack');
  });

  it('wrong promptVersion → stale, deterministic fallback', async () => {
    const { service } = makeService({ weeklyRow: makeWeeklyRow({ promptVersion: 'old-v0' }) });
    const out = await service.getWeeklyDailyOverlay('user-1', '2026-07-08');
    expect(out.source).toBe('deterministic');
    expect(out.reason).toBe('stale_pack');
  });

  it('fresh pack but no per-day copy (template fallback) → deterministic', async () => {
    const { service } = makeService({ weeklyRow: makeWeeklyRow({ dailyContent: [] }) });
    const out = await service.getWeeklyDailyOverlay('user-1', '2026-07-08');
    expect(out.source).toBe('deterministic');
    expect(out.reason).toBe('no_daily_content');
  });

  it('fresh pack but today is not in the pack → deterministic', async () => {
    const { service } = makeService({ weeklyRow: makeWeeklyRow() }); // covers 06/08/10 only
    const out = await service.getWeeklyDailyOverlay('user-1', '2026-07-07');
    expect(out.source).toBe('deterministic');
    expect(out.reason).toBe('day_not_in_pack');
  });

  it('is read-only: never calls Gemini or regenerates when AI is disabled', async () => {
    const { service, digestFindUnique, digestUpsert } = makeService({ weeklyRow: makeWeeklyRow() });
    await service.getWeeklyDailyOverlay('user-1', '2026-07-08');
    await service.getWeeklyDailyOverlay('user-1', '2026-07-08');
    expect(digestFindUnique).toHaveBeenCalledTimes(2);
    expect(digestUpsert).not.toHaveBeenCalled(); // no generation on the read path
  });
});
