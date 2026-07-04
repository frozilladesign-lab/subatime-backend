import { DateTime } from 'luxon';
import { ChartService } from '../../astrology/services/chart.service';
import { AlmanacService } from '../../calendar/almanac.service';
import { GeminiService } from '../../ai/services/gemini.service';
import { NotificationQueueService } from '../../notifications/queue/notification.queue';
import {
  buildChartInputFromBirthProfile,
  CURRENT_CHART_INPUT_VERSION,
  DailyPredictionService,
  isChartInputVersionStale,
} from './daily-prediction.service';
import { FeedbackLearningService } from './feedback-learning.service';
import { ScoringEngineService } from './scoring-engine.service';
import { PrismaService } from '../../../database/prisma.service';

/**
 * Regression coverage for a real, shipped bug: `buildChartDto()` (now extracted as the pure
 * `buildChartInputFromBirthProfile`) used to derive `birthTime` by UTC-slicing the stored
 * `timeOfBirth` instant and feeding that back into the chart engine as if it were local time.
 * The chart engine interprets `birthTime` as local time *within* `timezone`, so this
 * double-converted the offset and silently produced the wrong ascendant (lagna) and nakṣatra —
 * visible as a mismatch between the persisted `summary` text and the (correctly recomputed on
 * read) `meta.lagna`/`meta.nakshatra` fields.
 *
 * Cache safety note: predictions generated before this fix may have incorrect lagna/nakṣatra
 * for non-UTC profiles and should be regenerated.
 *
 * Test fixture: a real birth profile (Sachin Rasangika, 1998-05-18 22:10 Asia/Colombo,
 * Mahamodara, Galle). 1998 is deliberately chosen because `Asia/Colombo` was UTC+06:00 that
 * year (it only moved to UTC+05:30 in 2006) — a naive UTC slice of the correct UTC instant
 * (1998-05-18T16:10:00.000Z) yields "16:10", visibly different from the real local time
 * "22:10", so this fixture would have caught the bug even though Colombo's *current* offset
 * (+05:30) might otherwise mask a one-hour-scale regression.
 */
describe('buildChartInputFromBirthProfile (Sachin Rasangika fixture)', () => {
  const birthLocalDate = '1998-05-18';
  const birthLocalTime = '22:10';
  const timezone = 'Asia/Colombo';
  const expectedUtcInstant = '1998-05-18T16:10:00.000Z';

  const profile = {
    dateOfBirth: new Date(`${birthLocalDate}T00:00:00.000Z`),
    timeOfBirth: new Date(expectedUtcInstant),
    birthLocalDate,
    birthLocalTime,
    placeOfBirth: 'Mahamodara, Galle, Sri Lanka',
    latitude: 6.0383,
    longitude: 80.2039,
    timezone,
    userKnownLagna: null as string | null,
  };

  it('sanity check: Asia/Colombo was UTC+06:00 in 1998 (not the current UTC+05:30)', () => {
    // This pins down the premise the rest of this suite depends on — if IANA tzdata for
    // Asia/Colombo's historical 1998 offset ever changes, this fails loudly instead of the
    // regression test below silently losing its bite.
    const local = DateTime.fromISO(`${birthLocalDate}T${birthLocalTime}:00`, { zone: timezone });
    expect(local.isValid).toBe(true);
    expect(local.offset).toBe(360); // UTC+06:00, in minutes
    expect(local.toUTC().toISO()).toBe('1998-05-18T16:10:00.000Z');
  });

  it('uses birthLocalDate + birthLocalTime, not a UTC slice of timeOfBirth', () => {
    const input = buildChartInputFromBirthProfile('Sachin Rasangika', profile);

    expect(input.birthDate).toBe(birthLocalDate);
    expect(input.birthTime).toBe(birthLocalTime);

    // The bug's signature: UTC-slicing `timeOfBirth` ("1998-05-18T16:10:00.000Z") would have
    // produced birthTime "16:10" — one hour different from the correct local "22:10" because
    // 1998 Colombo was UTC+06:00. Fail loudly if anyone reintroduces that slice.
    const buggyUtcSlicedTime = profile.timeOfBirth.toISOString().slice(11, 16);
    expect(buggyUtcSlicedTime).toBe('16:10');
    expect(input.birthTime).not.toBe(buggyUtcSlicedTime);
  });

  it('falls back to a UTC slice only for legacy rows with no birthLocalDate/birthLocalTime', () => {
    const legacyProfile = { ...profile, birthLocalDate: null, birthLocalTime: null };
    const input = buildChartInputFromBirthProfile('Sachin Rasangika', legacyProfile);

    expect(input.birthDate).toBe(profile.dateOfBirth.toISOString().slice(0, 10));
    expect(input.birthTime).toBe(profile.timeOfBirth.toISOString().slice(11, 16));
  });

  it('produces a chart whose ascendant/nakṣatra differ from what the buggy UTC-slice input would have produced', () => {
    const chartService = new ChartService();

    const correctInput = buildChartInputFromBirthProfile('Sachin Rasangika', profile);
    const correctChart = chartService.generate(correctInput);

    // Reproduce exactly what the old, buggy `buildChartDto()` would have sent: the UTC-sliced
    // HH:mm re-interpreted as local time in the same timezone.
    const buggyInput = {
      ...correctInput,
      birthTime: profile.timeOfBirth.toISOString().slice(11, 16),
    };
    const buggyChart = chartService.generate(buggyInput);

    // A 6-hour-vs-different-offset shift in birth time is large enough to move the lagna
    // and/or nakṣatra — if this ever starts failing because the two charts coincidentally
    // match, treat it as a sign the fixture's premise (6-hour local/UTC gap) needs revisiting,
    // not as proof the bug is gone.
    expect(
      correctChart.lagna !== buggyChart.lagna || correctChart.nakshatra !== buggyChart.nakshatra,
    ).toBe(true);
  });
});

describe('DailyPredictionService.generateForUser (Sachin Rasangika fixture, integration)', () => {
  const userId = 'user-sachin';
  const birthLocalDate = '1998-05-18';
  const birthLocalTime = '22:10';
  const timezone = 'Asia/Colombo';

  const birthProfileRow = {
    id: 'bp-sachin',
    dateOfBirth: new Date(`${birthLocalDate}T00:00:00.000Z`),
    timeOfBirth: new Date('1998-05-18T16:10:00.000Z'),
    birthLocalDate,
    birthLocalTime,
    placeOfBirth: 'Mahamodara, Galle, Sri Lanka',
    latitude: 6.0383,
    longitude: 80.2039,
    timezone,
    userKnownLagna: null,
    onboardingIntent: null,
  };

  /**
   * @param cachedDailyPrediction Row `dailyPrediction.findUnique` should resolve to (simulating
   * an existing cached row for today), or `null` for a cache miss. Mutated in place by the fake
   * `upsert` so a second `findUnique` (as `getTodayForUser` does) sees the freshly written row.
   */
  function makeService(cachedDailyPrediction: Record<string, unknown> | null = null) {
    const chartService = new ChartService();
    const scoringEngine = new ScoringEngineService(chartService);

    let storedDailyPrediction = cachedDailyPrediction;

    const userFindUnique = jest.fn(() =>
      Promise.resolve({
        id: userId,
        name: 'Sachin Rasangika',
        preferences: {},
        accuracyScore: 0.5,
        birthProfile: birthProfileRow,
      }),
    );
    const astrologyChartFindFirst = jest.fn(() => Promise.resolve(null));
    const astrologyChartCreate = jest.fn((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'chart-1', ...args.data }),
    );
    const dailyPredictionFindUnique = jest.fn(() => Promise.resolve(storedDailyPrediction));
    const dailyPredictionUpsert = jest.fn((args: { create: Record<string, unknown> }) => {
      storedDailyPrediction = { id: storedDailyPrediction?.id ?? 'pred-1', ...args.create };
      return Promise.resolve(storedDailyPrediction);
    });
    const notificationJobUpsert = jest.fn(() =>
      Promise.resolve({ id: 'job-1', status: 'pending', scheduledAt: new Date() }),
    );
    const predictionFeedbackGroupBy = jest.fn(() => Promise.resolve([]));
    // Used by `enrichPrediction` (the cache-hit/read path) — same fixture profile.
    const birthProfileFindUnique = jest.fn(() =>
      Promise.resolve({ ...birthProfileRow, updatedAt: new Date('1990-01-01T00:00:00Z') }),
    );

    const prisma = {
      user: { findUnique: userFindUnique } as unknown as PrismaService['user'],
      birthProfile: { findUnique: birthProfileFindUnique } as unknown as PrismaService['birthProfile'],
      astrologyChart: {
        findFirst: astrologyChartFindFirst,
        create: astrologyChartCreate,
      } as unknown as PrismaService['astrologyChart'],
      dailyPrediction: {
        findUnique: dailyPredictionFindUnique,
        upsert: dailyPredictionUpsert,
      } as unknown as PrismaService['dailyPrediction'],
      notificationJob: { upsert: notificationJobUpsert } as unknown as PrismaService['notificationJob'],
      predictionFeedback: {
        groupBy: predictionFeedbackGroupBy,
      } as unknown as PrismaService['predictionFeedback'],
    } as unknown as PrismaService;

    const feedbackLearning = new FeedbackLearningService(prisma);
    const notificationQueue = {
      enqueueSendNotification: jest.fn(() => Promise.resolve()),
    } as unknown as NotificationQueueService;
    const gemini = { isConfigured: () => false } as unknown as GeminiService;

    const service = new DailyPredictionService(
      prisma,
      chartService,
      notificationQueue,
      scoringEngine,
      feedbackLearning,
      gemini,
      new AlmanacService(chartService),
    );
    return { service, dailyPredictionFindUnique, dailyPredictionUpsert };
  }

  it('produces meta.lagna/meta.nakshatra consistent with the generated summary text (no Karka-vs-Mesha-style mismatch)', async () => {
    const { service } = makeService();
    const result = await service.generateForUser(userId, new Date('2024-01-15T00:00:00Z'), {
      forceRegenerate: true,
    });

    expect(result).not.toBeNull();
    const lagna = result!.meta.lagna;
    const nakshatra = result!.meta.nakshatra;

    expect(lagna.length).toBeGreaterThan(0);
    expect(nakshatra.length).toBeGreaterThan(0);
    expect(result!.summary).toContain(`Based on ${lagna} lagna and ${nakshatra}`);

    // Known-correct values for this exact fixture (1998-05-18 22:10 Asia/Colombo, Mahamodara,
    // Galle) computed via the real Swiss-Ephemeris-backed chart engine. The bug (UTC-sliced
    // "16:10" instead of local "22:10") would have produced "Kanya"/"Shravana" instead — assert
    // the real values directly so this fails loudly, not just "some mismatch", if reintroduced.
    expect(lagna).toBe('Dhanu');
    expect(nakshatra).toBe('Dhanishta');
    expect(lagna).not.toBe('Kanya');
    expect(nakshatra).not.toBe('Shravana');
    expect(result!.summary).not.toContain('Kanya lagna');
  });

  const predictionDay = new Date('2024-01-15T00:00:00Z');

  function makeCachedRow(
    chartInputVersion: string | null,
    summary: string,
    opts?: { notificationCandidates?: unknown },
  ) {
    return {
      id: 'pred-cached',
      userId,
      date: predictionDay,
      summary,
      goodTimes: [],
      badTimes: [],
      transits: [],
      confidenceScore: 0.5,
      scoreSpread: 0.3,
      dominantContext: 'overall',
      chartInputVersion,
      // Fresh rows carry engine-built candidates; pass null to simulate a pre-refactor row.
      notificationCandidates:
        opts && 'notificationCandidates' in opts
          ? opts.notificationCandidates
          : { version: 1, date: '2024-01-15', timezone, blocks: [], powerHours: [] },
      createdAt: new Date('2024-01-15T00:00:00Z'),
      updatedAt: new Date('2024-01-15T00:00:00Z'),
    };
  }

  describe('chartInputVersion cache staleness (safe regeneration of pre-fix rows)', () => {
    it('isChartInputVersionStale: current version is not stale; missing/old versions are stale', () => {
      expect(isChartInputVersionStale(CURRENT_CHART_INPUT_VERSION)).toBe(false);
      expect(isChartInputVersionStale(null)).toBe(true);
      expect(isChartInputVersionStale(undefined)).toBe(true);
      expect(isChartInputVersionStale('legacy-utc-slice-v1')).toBe(true);
    });

    it('1. reuses a cached prediction whose chartInputVersion is current (no regeneration)', async () => {
      const cached = makeCachedRow(CURRENT_CHART_INPUT_VERSION, 'Cached summary, still fresh.');
      const { service, dailyPredictionUpsert } = makeService(cached);

      const result = await service.generateForUser(userId, predictionDay);

      expect(dailyPredictionUpsert).not.toHaveBeenCalled();
      expect(result?.summary).toBe('Cached summary, still fresh.');
    });

    it('2. regenerates when the cached row has no chartInputVersion (legacy pre-fix row)', async () => {
      const cached = makeCachedRow(null, 'Based on Mesha lagna and Anuradha, stale text.');
      const { service, dailyPredictionUpsert } = makeService(cached);

      const result = await service.generateForUser(userId, predictionDay);

      expect(dailyPredictionUpsert).toHaveBeenCalledTimes(1);
      expect(result?.summary).not.toBe('Based on Mesha lagna and Anuradha, stale text.');
    });

    it('3. regenerates when the cached row has an older chartInputVersion', async () => {
      const cached = makeCachedRow('legacy-utc-slice-v1', 'Based on Mesha lagna and Anuradha, stale text.');
      const { service, dailyPredictionUpsert } = makeService(cached);

      const result = await service.generateForUser(userId, predictionDay);

      expect(dailyPredictionUpsert).toHaveBeenCalledTimes(1);
      expect(result?.summary).not.toBe('Based on Mesha lagna and Anuradha, stale text.');
    });

    it('4. a regenerated prediction uses the local birth fields and stays consistent with meta.lagna/summary', async () => {
      const cached = makeCachedRow('legacy-utc-slice-v1', 'Based on Mesha lagna and Anuradha, stale text.');
      const { service } = makeService(cached);

      const result = await service.generateForUser(userId, predictionDay);

      expect(result).not.toBeNull();
      expect(result!.meta.lagna).toBe('Dhanu');
      expect(result!.meta.nakshatra).toBe('Dhanishta');
      expect(result!.summary).toContain(`Based on ${result!.meta.lagna} lagna and ${result!.meta.nakshatra}`);
    });

    it('5. forceRegenerate still bypasses the cache even when the cached row has the current version', async () => {
      const cached = makeCachedRow(CURRENT_CHART_INPUT_VERSION, 'Cached summary, still fresh.');
      const { service, dailyPredictionUpsert } = makeService(cached);

      const result = await service.generateForUser(userId, predictionDay, { forceRegenerate: true });

      expect(dailyPredictionUpsert).toHaveBeenCalledTimes(1);
      expect(result?.summary).not.toBe('Cached summary, still fresh.');
      expect(result?.summary).toContain('Based on Dhanu lagna and Dhanishta');
    });

    it('6. regenerates when the cached row predates notificationCandidates (safe backfill)', async () => {
      const cached = makeCachedRow(CURRENT_CHART_INPUT_VERSION, 'Cached summary, still fresh.', {
        notificationCandidates: null,
      });
      const { service, dailyPredictionUpsert } = makeService(cached);

      const result = await service.generateForUser(userId, predictionDay);

      expect(dailyPredictionUpsert).toHaveBeenCalledTimes(1);
      expect(result?.notificationCandidates).toBeDefined();
    });

    it('7. stores engine-built notificationCandidates matching the persisted blocks (single wording source)', async () => {
      const { service, dailyPredictionUpsert } = makeService(null);

      const result = await service.generateForUser(userId, predictionDay, { forceRegenerate: true });

      expect(dailyPredictionUpsert).toHaveBeenCalledTimes(1);
      const create = dailyPredictionUpsert.mock.calls[0][0].create as Record<string, unknown>;
      const candidates = create.notificationCandidates as {
        date: string;
        timezone: string;
        blocks: {
          type: string;
          startTime: string;
          title: string;
          titleSi: string;
          body: string;
          bodySi: string;
        }[];
      };

      // One candidate per engine block, bilingual and non-empty — delivery layers never compose copy.
      expect(candidates.blocks).toHaveLength(8);
      expect(candidates.timezone).toBe(timezone);
      expect(candidates.blocks.every((b) => b.title.length > 0 && b.body.length > 0)).toBe(true);
      expect(candidates.blocks.every((b) => b.titleSi.length > 0 && b.bodySi.length > 0)).toBe(true);

      // Peak/caution candidates line up with the persisted goodTimes/badTimes.
      const goodTimes = create.goodTimes as { start: string }[];
      const badTimes = create.badTimes as { start: string }[];
      const peak = candidates.blocks.find((b) => b.type === 'peak');
      const caution = candidates.blocks.find((b) => b.type === 'caution');
      expect(peak?.startTime).toBe(goodTimes[0]?.start);
      expect(caution?.startTime).toBe(badTimes[0]?.start);

      // The returned output carries the exact same candidates that were persisted.
      expect(result?.notificationCandidates).toEqual(candidates);
    });

    it('new predictions are written with the current chartInputVersion', async () => {
      const { service, dailyPredictionUpsert } = makeService(null);

      await service.generateForUser(userId, predictionDay, { forceRegenerate: true });

      expect(dailyPredictionUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ chartInputVersion: CURRENT_CHART_INPUT_VERSION }) as Record<
            string,
            unknown
          >,
        }),
      );
    });
  });
});
