import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DateTime } from 'luxon';
import { PrismaService } from '../../../database/prisma.service';
import { taraIndex1to9, taraNameEn } from '../../astrology/jyotisha-tara';
import { ChartService, NAKSHATRA_LIST } from '../../astrology/services/chart.service';
import { NotificationQueueService } from '../../notifications/queue/notification.queue';
import { GenerateChartDto } from '../../astrology/dto/astrology.dto';
import { okResponse } from '../../../common/utils/response.util';
import { SubmitPredictionFeedbackDto } from '../dto/feedback.dto';
import { FeedbackLearningService } from './feedback-learning.service';
import { GeminiService } from '../../ai/services/gemini.service';
import { ScoringEngineService } from './scoring-engine.service';
import type { DayTransitDto } from './day-transits';

type TimeBlock = { start: string; end: string; label: string };
export type ContextKey = 'overall' | 'career' | 'love' | 'health';

export interface PredictionPersonalization {
  mostRelevantContext: ContextKey;
  lowerSignalContexts: ContextKey[];
  contextWeights: Record<string, number>;
  /**
   * Accent on block scores (~0.90–1.10): maps dominant `contextWeights[mostRelevantContext]`
   * so feedback history nudges timing without crushing raw transit scores.
   */
  primaryContextScoreMultiplier: number;
}

export interface DailyPredictionOutput {
  /** Row id in `daily_predictions` (POST `/predictions/:id/feedback`). */
  predictionId: string;
  userId: string;
  date: string;
  summary: string;
  goodTimes: TimeBlock[];
  badTimes: TimeBlock[];
  transits: DayTransitDto[];
  confidenceScore: number;
  personalization: PredictionPersonalization;
  meta: {
    lagna: string;
    nakshatra: string;
    scoreSpread: number;
    method:
      | 'weighted-score-v2'
      | 'weighted-score-v2+gemini'
      | 'weighted-score-v3'
      | 'weighted-score-v3+gemini';
    /** Sidereal Moon sign (Janma Rāśi) from birth chart. */
    janmaRasi?: string;
    /** Tara Bāla at local civil noon in birth-profile timezone (approximate daily snapshot). */
    taraAtBirthTimezoneNoon?: { index1To9: number; name: string };
  };
}

@Injectable()
export class DailyPredictionService {
  private readonly logger = new Logger(DailyPredictionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chartService: ChartService,
    private readonly notificationQueue: NotificationQueueService,
    private readonly scoringEngine: ScoringEngineService,
    private readonly feedbackLearning: FeedbackLearningService,
    private readonly gemini: GeminiService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async generateAllUsersForToday(): Promise<void> {
    await this.generateForAllUsers(this.todayUTC());
  }

  async generateTodayManual(): Promise<{ generated: number }> {
    const generated = await this.generateForAllUsers(this.todayUTC());
    return { generated };
  }

  async getTodayForUser(userId: string) {
    const today = this.todayUTC();
    const existing = await this.prisma.dailyPrediction.findUnique({
      where: {
        userId_date: {
          userId,
          date: today,
        },
      },
    });

    if (existing) {
      return okResponse(
        await this.enrichPrediction(existing, userId),
        'Today prediction fetched',
      );
    }

    await this.generateForUser(userId, today);
    const generated = await this.prisma.dailyPrediction.findUnique({
      where: {
        userId_date: {
          userId,
          date: today,
        },
      },
    });

    return okResponse(
      generated ? await this.enrichPrediction(generated, userId) : null,
      'Today prediction generated and fetched',
    );
  }

  async submitFeedback(
    predictionId: string,
    userId: string,
    dto: SubmitPredictionFeedbackDto,
  ) {
    const prediction = await this.prisma.dailyPrediction.findUnique({
      where: { id: predictionId },
      select: { id: true, userId: true },
    });
    if (!prediction || prediction.userId !== userId) {
      throw new NotFoundException('Prediction not found for user');
    }

    const touch = {
      feedback: dto.feedback,
      actualOutcome: dto.actualOutcome,
      contextType: dto.contextType,
      timeSlot: dto.timeSlot,
      timestamp: new Date(),
    };

    const updated = await this.prisma.predictionFeedback.updateMany({
      where: { predictionId, userId },
      data: touch,
    });

    const saved =
      updated.count > 0
        ? await this.prisma.predictionFeedback.findFirstOrThrow({
            where: { predictionId, userId },
            orderBy: { timestamp: 'desc' },
          })
        : await this.prisma.predictionFeedback.create({
            data: {
              predictionId,
              userId,
              feedback: dto.feedback,
              actualOutcome: dto.actualOutcome,
              contextType: dto.contextType,
              timeSlot: dto.timeSlot,
            },
          });

    await this.feedbackLearning.recomputeUserAccuracy(userId);
    // Make feedback affect the very next read by regenerating today's prediction.
    await this.generateForUser(userId, this.todayUTC(), { forceRegenerate: true });

    return okResponse(saved, 'Feedback captured');
  }

  async getFeedback(predictionId: string, userId: string) {
    const feedback = await this.prisma.predictionFeedback.findFirst({
      where: { predictionId, userId },
      orderBy: { timestamp: 'desc' },
    });

    return okResponse(feedback, 'Feedback fetched');
  }

  async getFeedbackStats(userId: string) {
    const grouped = await this.prisma.predictionFeedback.groupBy({
      by: ['contextType', 'feedback'],
      where: { userId },
      _count: { _all: true },
    });

    const byContext: Record<
      string,
      { good: number; bad: number; total: number; helpfulRate: number }
    > = {};

    for (const item of grouped) {
      const context = item.contextType ?? 'overall';
      const existing =
        byContext[context] ?? { good: 0, bad: 0, total: 0, helpfulRate: 0 };
      if (item.feedback === 'good') {
        existing.good += item._count._all;
      } else {
        existing.bad += item._count._all;
      }
      existing.total += item._count._all;
      byContext[context] = existing;
    }

    for (const context of Object.keys(byContext)) {
      const item = byContext[context];
      item.helpfulRate =
        item.total == 0 ? 0 : Number((item.good / item.total).toFixed(4));
    }

    const totalGood = Object.values(byContext).reduce(
      (sum, item) => sum + item.good,
      0,
    );
    const totalBad = Object.values(byContext).reduce(
      (sum, item) => sum + item.bad,
      0,
    );
    const total = totalGood + totalBad;

    return okResponse(
      {
        total,
        totalGood,
        totalBad,
        overallHelpfulRate:
          total == 0 ? 0 : Number((totalGood / total).toFixed(4)),
        byContext,
      },
      'Feedback stats fetched',
    );
  }

  async explainPrediction(userId: string, predictionId: string) {
    const p = await this.prisma.dailyPrediction.findUnique({
      where: { id: predictionId },
    });
    if (!p || p.userId !== userId) {
      throw new NotFoundException('Prediction not found');
    }

    const contextWeights = await this.feedbackLearning.getUserContextWeights(userId);
    const userRow = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        preferences: true,
        birthProfile: { select: { onboardingIntent: true } },
      },
    });
    const personalization = this.buildPersonalization(
      contextWeights,
      userRow?.birthProfile?.onboardingIntent,
      this.readOnboardingMoodsFromPreferences(userRow?.preferences),
    );

    const facts = {
      date: this.toDateString(p.date),
      summary: p.summary,
      goodTimes: p.goodTimes,
      badTimes: p.badTimes,
      confidenceScore: p.confidenceScore,
      personalization,
    };

    let explanation: string;
    let usedGemini = false;

    if (this.gemini.isConfigured()) {
      try {
        const system = [
          'Explain why the app produced this daily forecast.',
          'Use ONLY the JSON facts — window lists, confidence score, personalization focus.',
          'Describe how weighted scoring surfaces good vs cautious periods; do not invent new times.',
          'Plain English, 4–8 sentences, no markdown.',
          `Facts: ${JSON.stringify(facts)}`,
        ].join('\n');
        explanation = await this.gemini.generateContent(
          system,
          'Explain this prediction clearly for the user.',
        );
        usedGemini = true;
      } catch (e) {
        this.logger.warn(`Gemini prediction explain failed: ${String(e)}`);
        explanation = this.ruleExplainPrediction(facts);
      }
    } else {
      explanation = this.ruleExplainPrediction(facts);
    }

    return okResponse(
      {
        explanation: explanation.trim(),
        usedGemini,
      },
      'Prediction explained',
    );
  }

  /**
   * Lower confidence when birth time quality is weak (unknown time → softer prediction envelope).
   */
  private dataQualityFromBirthProfile(bp: {
    birthTimeAccuracy?: string | null;
    predictionTier?: string | null;
  }): number {
    const acc = (bp.birthTimeAccuracy ?? '').toLowerCase();
    if (acc === 'exact') return 0.91;
    if (acc === 'approx') return 0.76;
    if (acc === 'unknown') return 0.61;
    const tier = (bp.predictionTier ?? '').toLowerCase();
    if (tier === 'veryaccurate') return 0.9;
    if (tier === 'accurate') return 0.8;
    if (tier === 'quick') return 0.72;
    return 0.84;
  }

  private async generateForAllUsers(date: Date): Promise<number> {
    const users = await this.prisma.user.findMany({
      select: { id: true },
    });

    for (const user of users) {
      await this.generateForUser(user.id, date, { forceRegenerate: true });
    }

    this.logger.log(`Generated predictions for ${users.length} users on ${date.toISOString()}`);
    return users.length;
  }

  /**
   * @param opts.polishSummary When false, skips Gemini summary polish (faster for calendar month backfill).
   * @param opts.forceRegenerate When true, skips the DB cache and recomputes (cron, feedback refresh).
   */
  async generateForUser(
    userId: string,
    date: Date,
    opts?: { polishSummary?: boolean; forceRegenerate?: boolean },
  ): Promise<DailyPredictionOutput | null> {
    const polishSummary = opts?.polishSummary !== false;
    const predictionDay = this.normalizeDate(date);

    if (!opts?.forceRegenerate) {
      const cached = await this.prisma.dailyPrediction.findUnique({
        where: {
          userId_date: {
            userId,
            date: predictionDay,
          },
        },
      });
      if (cached) {
        return this.enrichPrediction(cached, userId);
      }
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        birthProfile: true,
      },
    });

    if (!user?.birthProfile) {
      this.logger.warn(`Skipped prediction for user ${userId}: missing birth profile`);
      return null;
    }

    const existingChart = await this.prisma.astrologyChart.findFirst({
      where: { birthProfileId: user.birthProfile.id },
      orderBy: { version: 'desc' },
    });

    const generatedChart = this.chartService.generate(this.buildChartDto(user.name, user.birthProfile));
    const chart =
      existingChart ??
      (await this.prisma.astrologyChart.create({
        data: {
          birthProfileId: user.birthProfile.id,
          version: 1,
          chartData: generatedChart.chartData as Prisma.InputJsonValue,
          planetaryData: generatedChart.planetaryData,
        },
      }));

    const cd = chart.chartData as Record<string, unknown>;
    const lagna = String(cd?.lagna ?? generatedChart.lagna);
    const nakshatra = String(cd?.nakshatra ?? generatedChart.nakshatra);
    const blocks = this.buildTimeBlocks();
    const planetaryData = (chart.planetaryData as Record<string, unknown>) ?? {};
    const weightAdjustment = await this.feedbackLearning.getWeightAdjustment(userId);
    const contextWeights = await this.feedbackLearning.getUserContextWeights(userId);
    const personalization = this.buildPersonalization(
      contextWeights,
      user.birthProfile?.onboardingIntent,
      this.readOnboardingMoodsFromPreferences(user.preferences),
    );
    const dataQuality = this.dataQualityFromBirthProfile(user.birthProfile);
    const scored = this.scoringEngine.scoreBlocks({
      blocks,
      lagna,
      nakshatra,
      date: predictionDay,
      planetaryData,
      feedbackWeightAdjustment: weightAdjustment,
      primaryContextWeight: personalization.primaryContextScoreMultiplier,
      chartData: cd,
      dataQuality,
    });

    const goodTimes = [...scored].sort((a, b) => b.score - a.score).slice(0, 2).map((s) => s.block);
    const badTimes = [...scored].sort((a, b) => a.score - b.score).slice(0, 2).map((s) => s.block);
    const sortedByScore = [...scored].sort((a, b) => b.score - a.score);
    const scoreSpread = Number(
      (
        (sortedByScore[0]?.score ?? 0.5) -
        (sortedByScore[sortedByScore.length - 1]?.score ?? 0.5)
      ).toFixed(4),
    );
    const baseConfidence = this.scoringEngine.calculateConfidence(scored, 0.88);
    const confidenceScore = Number(
      Math.min(0.98, Math.max(0.2, baseConfidence * (contextWeights.overall ?? 0.7))).toFixed(4),
    );
    const transits = this.scoringEngine.deriveDailyTransits({
      date: predictionDay,
      userId,
      onboardingIntent: user.birthProfile?.onboardingIntent ?? null,
      lagna,
      nakshatra,
    });
    let summary = this.buildSummary(
      lagna,
      nakshatra,
      goodTimes[0],
      confidenceScore,
      personalization.mostRelevantContext,
    );
    let summaryMethod: DailyPredictionOutput['meta']['method'] = 'weighted-score-v3';
    if (polishSummary && this.gemini.isConfigured()) {
      try {
        summary = await this.refineSummaryWithGemini({
          baselineSummary: summary,
          lagna,
          nakshatra,
          goodTimes,
          badTimes,
          confidenceScore,
          focus: personalization.mostRelevantContext,
        });
        summaryMethod = 'weighted-score-v3+gemini';
      } catch (err) {
        this.logger.warn(
          `Gemini daily summary polish failed for user ${userId}: ${String(err)}`,
        );
      }
    }
    const predictionDate = predictionDay;

    const dailyPrediction = await this.prisma.dailyPrediction.upsert({
      where: {
        userId_date: {
          userId,
          date: predictionDate,
        },
      },
      update: {
        summary,
        goodTimes,
        badTimes,
        transits: transits as unknown as Prisma.InputJsonValue,
        confidenceScore,
        scoreSpread,
        dominantContext: personalization.mostRelevantContext,
      },
      create: {
        userId,
        date: predictionDate,
        summary,
        goodTimes,
        badTimes,
        transits: transits as unknown as Prisma.InputJsonValue,
        confidenceScore,
        scoreSpread,
        dominantContext: personalization.mostRelevantContext,
      },
    });

    const lagnaTrim = lagna.trim();
    const janmaRasi = String(planetaryData['moon'] ?? '').trim();
    const dateStr = this.toDateString(predictionDate);
    const tzNoon = user.birthProfile?.timezone ?? 'UTC';
    const ayanamsaMode =
      typeof cd?.ayanamsaMode === 'string' ? (cd.ayanamsaMode as string) : undefined;
    const taraNoon = this.computeTaraAtLocalNoon(nakshatra, dateStr, tzNoon, ayanamsaMode);

    const metaBase = {
      predictionId: dailyPrediction.id,
      date: this.toDateString(predictionDate),
      ...(lagnaTrim.length ? { userLagna: lagnaTrim } : {}),
    } as const;

    const dayparts = this.buildDaypartBodies(summary, goodTimes, badTimes);
    let morningPayload = await this.buildDailyPushPayload(summary, { ...metaBase });
    const windowLead = this.formatBestWindowLead(goodTimes[0]);
    if (windowLead) {
      const merged = `${windowLead} ${String(morningPayload.body ?? '').trim()}`.trim();
      morningPayload = {
        ...morningPayload,
        body: merged.length > 160 ? `${merged.slice(0, 157).trim()}…` : merged,
        slot: 'morning',
        windowHint: windowLead,
      };
    } else {
      morningPayload = { ...morningPayload, slot: 'morning' };
    }

    const clip = (t: string, n: number) => (t.length <= n ? t : `${t.slice(0, Math.max(0, n - 1)).trim()}…`);
    const middayPayload: Record<string, unknown> = {
      ...metaBase,
      slot: 'midday',
      title: 'Midday read',
      body: clip(summary.trim(), 130),
      summary: summary.length > 200 ? `${summary.slice(0, 197)}…` : summary,
    };

    const eveningPayload: Record<string, unknown> = {
      ...metaBase,
      slot: 'evening',
      title: 'Evening check-in',
      body: dayparts.evening,
      summary: summary.length > 200 ? `${summary.slice(0, 197)}…` : summary,
    };
    const nightPayload: Record<string, unknown> = {
      ...metaBase,
      slot: 'night',
      title: 'Night wind-down',
      body: dayparts.night,
      summary: summary.length > 200 ? `${summary.slice(0, 197)}…` : summary,
    };

    const muteLearningTips = this.muteLearningTipsFromPreferences(user.preferences);
    const tz = (tzNoon ?? '').trim() || 'UTC';

    // Local civil times (birth-profile timezone) so pushes align with morning / noon / evening, not fixed UTC.
    await this.upsertDaypartNotification(userId, 'daily', predictionDate, tz, 10, 0, morningPayload);
    if (!muteLearningTips) {
      await this.upsertDaypartNotification(userId, 'daily_evening', predictionDate, tz, 12, 0, middayPayload);
      await this.upsertDaypartNotification(userId, 'daily_evening', predictionDate, tz, 18, 0, eveningPayload);
      await this.upsertDaypartNotification(userId, 'daily_night', predictionDate, tz, 21, 30, nightPayload);
    }

    return {
      predictionId: dailyPrediction.id,
      userId,
      date: this.toDateString(predictionDate),
      summary,
      goodTimes,
      badTimes,
      transits,
      confidenceScore,
      personalization,
      meta: {
        lagna,
        nakshatra,
        scoreSpread,
        method: summaryMethod,
        ...(janmaRasi.length ? { janmaRasi } : {}),
        ...(taraNoon ? { taraAtBirthTimezoneNoon: taraNoon } : {}),
      },
    };
  }

  private buildChartDto(
    fullName: string,
    profile: {
      dateOfBirth: Date;
      timeOfBirth: Date;
      placeOfBirth: string;
      latitude: number;
      longitude: number;
      timezone: string | null;
      userKnownLagna?: string | null;
    },
  ): GenerateChartDto {
    return {
      fullName,
      birthDate: this.toDateString(profile.dateOfBirth),
      birthTime: profile.timeOfBirth.toISOString().slice(11, 16),
      birthPlace: profile.placeOfBirth,
      latitude: profile.latitude,
      longitude: profile.longitude,
      timezone: profile.timezone ?? undefined,
      lagnaUserOverride: profile.userKnownLagna?.trim() || undefined,
    };
  }

  private readOnboardingMoodsFromPreferences(raw: unknown): string[] {
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const m = (raw as Record<string, unknown>).onboardingMoods;
    if (!Array.isArray(m)) return [];
    return m.map((x) => String(x).trim()).filter(Boolean);
  }

  private buildTimeBlocks(): TimeBlock[] {
    return [
      { start: '06:00', end: '08:00', label: 'Early Morning' },
      { start: '08:00', end: '10:00', label: 'Morning Focus' },
      { start: '10:00', end: '12:00', label: 'Late Morning' },
      { start: '12:00', end: '14:00', label: 'Noon Window' },
      { start: '14:00', end: '16:00', label: 'Afternoon Push' },
      { start: '16:00', end: '18:00', label: 'Evening Start' },
      { start: '18:00', end: '20:00', label: 'Evening Prime' },
      { start: '20:00', end: '22:00', label: 'Night Calm' },
    ];
  }

  private async refineSummaryWithGemini(args: {
    baselineSummary: string;
    lagna: string;
    nakshatra: string;
    goodTimes: TimeBlock[];
    badTimes: TimeBlock[];
    confidenceScore: number;
    focus: ContextKey;
  }): Promise<string> {
    const facts = JSON.stringify({
      lagna: args.lagna,
      nakshatra: args.nakshatra,
      goodTimes: args.goodTimes.map((b) => ({
        start: b.start,
        end: b.end,
        label: b.label,
      })),
      badTimes: args.badTimes.map((b) => ({
        start: b.start,
        end: b.end,
        label: b.label,
      })),
      confidenceScore: args.confidenceScore,
      focusContext: args.focus,
    });

    const system = [
      'You polish short daily astrology summaries for an app.',
      'Facts below are authoritative — keep lagna, nakshatra, named time windows, and focus context aligned.',
      'Do not invent different signs, nakshatras, or time ranges.',
      'Output plain English only: 2–4 sentences, warm and concise. No bullet lists or markdown.',
      `Structured facts (JSON): ${facts}`,
    ].join('\n');

    const userMsg = [
      'Rewrite this baseline summary with clearer, friendlier wording only.',
      'Preserve the same recommendations and time emphasis.',
      `Baseline:\n${args.baselineSummary}`,
    ].join('\n');

    const raw = await this.gemini.generateContent(system, userMsg);
    const cleaned = raw.replace(/\*\*|__/g, '').trim();
    const singleParagraph = cleaned.replace(/\s+/g, ' ');
    if (singleParagraph.length < 40 || singleParagraph.length > 1200) {
      throw new Error('Gemini summary length out of expected range');
    }
    return singleParagraph.slice(0, 1200);
  }

  private buildSummary(
    lagna: string,
    nakshatra: string,
    bestBlock: TimeBlock | undefined,
    confidenceScore: number,
    mostRelevantContext: ContextKey,
  ): string {
    const blockLabel = bestBlock ? `${bestBlock.start}-${bestBlock.end}` : '06:00-08:00';
    const tone =
      confidenceScore >= 0.75
        ? 'action-oriented'
        : confidenceScore <= 0.6
          ? 'cautionary but empowering'
          : 'balanced';
    const angle =
      tone === 'action-oriented'
        ? 'Take decisive steps in high-impact tasks.'
        : tone === 'cautionary but empowering'
          ? 'Move carefully and prioritize low-risk decisions.'
          : 'Use a steady pace and avoid overcommitting.';
    const contextLine =
      mostRelevantContext === 'career'
        ? 'Career decisions carry the strongest relevance today.'
        : mostRelevantContext === 'love'
          ? 'Relationship communication has the strongest relevance today.'
          : mostRelevantContext === 'health'
            ? 'Health and balance choices have the strongest relevance today.'
            : 'General day-planning has the strongest relevance today.';
    return `Based on ${lagna} lagna and ${nakshatra}, your strongest action window is ${blockLabel}. ${angle} ${contextLine}`;
  }

  private muteLearningTipsFromPreferences(raw: unknown): boolean {
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const n = (raw as Record<string, unknown>).notifications;
    if (n == null || typeof n !== 'object' || Array.isArray(n)) return false;
    const m = (n as Record<string, unknown>).muteLearningTips;
    return m === true || m === 'true';
  }

  private buildPersonalization(
    contextWeights: Record<string, number>,
    onboardingIntent?: string | null,
    onboardingMoods?: string[] | null,
  ): PredictionPersonalization {
    const boosted: Record<string, number> = { ...contextWeights };
    const bump = (key: ContextKey, delta: number) => {
      boosted[key] = Number(
        Math.min(0.95, Math.max(0.15, (boosted[key] ?? 0.5) + delta)).toFixed(4),
      );
    };
    const intents = (onboardingIntent ?? '')
      .split(/[,]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    for (const intent of intents) {
      switch (intent) {
        case 'love':
          bump('love', 0.22);
          break;
        case 'career':
          bump('career', 0.22);
          break;
        case 'growth':
          bump('health', 0.14);
          bump('overall', 0.1);
          break;
        case 'dreams':
          bump('overall', 0.18);
          break;
        default:
          break;
      }
    }

    for (const raw of onboardingMoods ?? []) {
      const id = raw.trim().toLowerCase();
      switch (id) {
        case 'calm':
          bump('overall', 0.08);
          bump('health', 0.06);
          break;
        case 'anxious':
          bump('health', 0.14);
          bump('overall', 0.04);
          break;
        case 'focused':
          bump('career', 0.14);
          break;
        case 'tired':
          bump('health', 0.12);
          break;
        case 'open':
          bump('love', 0.1);
          bump('overall', 0.08);
          break;
        case 'stressed':
          bump('health', 0.14);
          break;
        default:
          break;
      }
    }

    const contexts: ContextKey[] = ['career', 'love', 'health', 'overall'];
    const sorted = [...contexts].sort(
      (a, b) => (boosted[b] ?? 0.5) - (boosted[a] ?? 0.5),
    );
    const rawPrimary = boosted[sorted[0]] ?? 0.5;
    return {
      mostRelevantContext: sorted[0],
      lowerSignalContexts: sorted.slice(2),
      contextWeights: boosted,
      primaryContextScoreMultiplier: this.accentMultiplierFromContextWeight(rawPrimary),
    };
  }

  /**
   * Maps raw dominant-context weight (same numeric band as `contextWeights`, ~0.15–0.95)
   * to a gentle score accent in [0.90, 1.10] so sparse feedback softens/boosts slightly
   * instead of acting as a hard dampener on transit math.
   */
  private accentMultiplierFromContextWeight(raw: number): number {
    const lo = 0.15;
    const hi = 0.95;
    const clamped = Math.min(hi, Math.max(lo, raw));
    const t = (clamped - lo) / (hi - lo);
    return Number((0.9 + t * 0.2).toFixed(4));
  }

  private async enrichPrediction(
    prediction: {
      userId: string;
      date: Date;
      summary: string;
      goodTimes: unknown;
      badTimes: unknown;
      transits?: unknown;
      confidenceScore: number;
      scoreSpread: number;
      createdAt: Date;
      updatedAt: Date;
      id: string;
    },
    userId: string,
  ) {
    const contextWeights = await this.feedbackLearning.getUserContextWeights(userId);
    const [profile, prefsRow] = await Promise.all([
      this.prisma.birthProfile.findUnique({
        where: { userId },
        select: {
          id: true,
          onboardingIntent: true,
          updatedAt: true,
          placeOfBirth: true,
          latitude: true,
          longitude: true,
          timezone: true,
          birthLocalDate: true,
          birthLocalTime: true,
          dateOfBirth: true,
          timeOfBirth: true,
          userKnownLagna: true,
        },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { preferences: true },
      }),
    ]);
    const personalization = this.buildPersonalization(
      contextWeights,
      profile?.onboardingIntent,
      this.readOnboardingMoodsFromPreferences(prefsRow?.preferences),
    );

    let lagna = '';
    let nakshatra = '';
    let siderealMoon = '';
    let taraNoon: { index1To9: number; name: string } | undefined;
    if (profile?.id) {
      let chart = await this.prisma.astrologyChart.findFirst({
        where: { birthProfileId: profile.id },
        orderBy: { version: 'desc' },
      });
      const needsRefresh =
        !chart || (profile.updatedAt && chart.createdAt < profile.updatedAt);
      if (needsRefresh) {
        const generated = this.chartService.generate({
          fullName: 'User',
          birthDate:
            profile.birthLocalDate?.trim() || profile.dateOfBirth.toISOString().slice(0, 10),
          birthTime:
            profile.birthLocalTime?.trim() || profile.timeOfBirth.toISOString().slice(11, 16),
          birthPlace: profile.placeOfBirth,
          latitude: profile.latitude,
          longitude: profile.longitude,
          timezone: profile.timezone ?? 'UTC',
          ayanamsa: 'lahiri',
          lagnaUserOverride: profile.userKnownLagna ?? undefined,
        });
        const version = (chart?.version ?? 0) + 1;
        chart = await this.prisma.astrologyChart.create({
          data: {
            birthProfileId: profile.id,
            version,
            chartData: generated.chartData as Prisma.InputJsonValue,
            planetaryData: generated.planetaryData as Prisma.InputJsonValue,
          },
        });
      }
      const cd = chart?.chartData as Record<string, unknown> | undefined;
      if (cd?.lagna != null) lagna = String(cd.lagna);
      if (cd?.nakshatra != null) nakshatra = String(cd.nakshatra);
      const pd = chart?.planetaryData as Record<string, unknown> | undefined;
      if (pd?.moon != null) siderealMoon = String(pd.moon);
      const dateStr = prediction.date.toISOString().slice(0, 10);
      const tz = profile.timezone ?? 'UTC';
      const ay = typeof cd?.ayanamsaMode === 'string' ? (cd.ayanamsaMode as string) : undefined;
      if (nakshatra.trim().length > 0) {
        taraNoon = this.computeTaraAtLocalNoon(nakshatra, dateStr, tz, ay);
      }
    }

    const goodTimes = (prediction.goodTimes as unknown as TimeBlock[]) ?? [];
    const badTimes = (prediction.badTimes as unknown as TimeBlock[]) ?? [];
    const spread = Number.isFinite(prediction.scoreSpread)
      ? Number(prediction.scoreSpread)
      : 0.35;

    const out: DailyPredictionOutput = {
      predictionId: prediction.id,
      userId: prediction.userId,
      date: this.toDateString(prediction.date),
      summary: prediction.summary,
      goodTimes,
      badTimes,
      transits: this.normalizeStoredTransits(prediction.transits),
      confidenceScore: prediction.confidenceScore,
      personalization,
      meta: {
        lagna,
        nakshatra,
        scoreSpread: spread,
        method: 'weighted-score-v3',
        ...(siderealMoon.trim().length > 0 ? { janmaRasi: siderealMoon.trim() } : {}),
        ...(taraNoon ? { taraAtBirthTimezoneNoon: taraNoon } : {}),
      },
    };
    return out;
  }

  /** Tara Bāla: count nakṣatras from birth star to transiting Moon at local civil noon (birth TZ). */
  private computeTaraAtLocalNoon(
    natalNakName: string,
    dateStr: string,
    tz: string,
    ayanamsaMode?: string,
  ): { index1To9: number; name: string } | undefined {
    const natIdx = (NAKSHATRA_LIST as readonly string[]).indexOf(natalNakName.trim());
    if (natIdx < 0) return undefined;
    const localNoon = DateTime.fromISO(`${dateStr}T12:00:00`, { zone: tz });
    if (!localNoon.isValid) return undefined;
    const moon = this.chartService.moonSiderealLongitudeUtc(localNoon.toUTC().toJSDate(), ayanamsaMode);
    const trIdx = Math.floor(this.normDeg360(moon) / (360 / 27));
    const ti = taraIndex1to9(natIdx, trIdx);
    return { index1To9: ti, name: taraNameEn(ti) };
  }

  private normDeg360(v: number): number {
    const n = v % 360;
    return n < 0 ? n + 360 : n;
  }

  private normalizeStoredTransits(raw: unknown): DayTransitDto[] {
    if (!Array.isArray(raw)) return [];
    const out: DayTransitDto[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      const id = String(o.id ?? '').trim();
      const title = String(o.title ?? '').trim();
      const description = String(o.description ?? '').trim();
      if (!id || !title) continue;
      const intensityRaw = Number(o.intensity);
      const intensity = Number.isFinite(intensityRaw)
        ? Math.min(5, Math.max(1, Math.round(intensityRaw)))
        : 3;
      const t = o.type;
      const type: DayTransitDto['type'] =
        t === 'challenge' || t === 'opportunity' || t === 'neutral' ? t : 'neutral';
      out.push({ id, title, description, intensity, type });
    }
    return out;
  }

  /** One-line lead from top scored “good” window (same data as plan Do). */
  private formatBestWindowLead(block: TimeBlock | undefined): string {
    if (!block) return '';
    const label = (block.label ?? '').trim() || 'Window';
    if (block.start && block.end) {
      return `${label}: best momentum ${block.start}–${block.end}.`;
    }
    return `${label}: favor steady progress in this stretch.`;
  }

  /**
   * Short, actionable copy per day-part from stored windows + summary (no extra LLM calls).
   */
  private buildDaypartBodies(
    summary: string,
    goodTimes: TimeBlock[],
    badTimes: TimeBlock[],
  ): { evening: string; night: string } {
    const s = summary.trim();
    const clip = (t: string, n: number) => (t.length <= n ? t : `${t.slice(0, Math.max(0, n - 1)).trim()}…`);
    const b0 = badTimes[0];
    let evening = '';
    if (b0?.start && b0?.end) {
      const lab = (b0.label ?? '').trim() || 'Caution';
      evening = `Keep stakes light ${b0.start}–${b0.end} (${lab}).`;
      if (s.length) evening += ` ${clip(s, 72)}`;
    } else {
      evening = clip(s, 140);
    }
    evening = clip(evening.trim(), 160);

    let night = '';
    if (s.length) {
      night = clip(`Wind down: ${clip(s, 100)}`, 160);
    } else {
      night = 'Wind down gently; favor rest and soft endings tonight.';
    }
    return { evening, night };
  }

  private async upsertDaypartNotification(
    userId: string,
    type: 'daily' | 'daily_evening' | 'daily_night',
    predictionDate: Date,
    timezone: string,
    localHour: number,
    localMinute: number,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const scheduledAt = this.atUserLocalWallClock(predictionDate, timezone, localHour, localMinute);
    const job = await this.prisma.notificationJob.upsert({
      where: {
        userId_type_scheduledAt: {
          userId,
          type,
          scheduledAt,
        },
      },
      update: {
        payload: payload as Prisma.InputJsonValue,
      },
      create: {
        userId,
        type,
        payload: payload as Prisma.InputJsonValue,
        scheduledAt,
        status: 'pending',
      },
    });
    if (job.status !== 'sent') {
      await this.notificationQueue.enqueueSendNotification(job.id, job.scheduledAt);
    }
  }

  /** Interprets [predictionDate] as the user's plan calendar day (UTC midnight anchor) and [hour]/[minute] as wall time in [timezone]. */
  private atUserLocalWallClock(predictionUtcMidnight: Date, timezone: string, hour: number, minute: number): Date {
    const y = predictionUtcMidnight.getUTCFullYear();
    const mo = predictionUtcMidnight.getUTCMonth() + 1;
    const d = predictionUtcMidnight.getUTCDate();
    const zone = (timezone ?? '').trim() || 'UTC';
    const local = DateTime.fromObject({ year: y, month: mo, day: d, hour, minute }, { zone });
    if (!local.isValid) {
      this.logger.warn(
        `daypart schedule: invalid local wall ${zone} ${y}-${mo}-${d} ${hour}:${minute} (${local.invalidReason ?? 'unknown'}) — using UTC`,
      );
      return this.atUtcTime(predictionUtcMidnight, hour, minute);
    }
    return local.toUTC().toJSDate();
  }

  private ruleExplainPrediction(facts: {
    date: string;
    summary: string;
    goodTimes: unknown;
    badTimes: unknown;
    confidenceScore: number;
    personalization: PredictionPersonalization;
  }): string {
    const focus = facts.personalization.mostRelevantContext;
    return [
      `For ${facts.date}, Subatime ranked each window using transiting sidereal Moon through your whole-sign houses, nakṣatra distance from your birth star, soft aspects to natal Moon/Sun/lagna, mahādaśā lord affinity, and light time-of-day context — then blended with your feedback-informed weights (${focus} emphasized).`,
      `Confidence about ${(facts.confidenceScore * 100).toFixed(0)}% reflects separation between stronger and weaker windows after that blend.`,
      `Good-time slots lean on Moon-supportive geometry; caution slots lean on dusthanas, harder aspects, or weaker tara tiers — still guidance, not fate.`,
    ].join(' ');
  }

  private async buildDailyPushPayload(
    summary: string,
    meta: { predictionId: string; date: string; userLagna?: string },
  ): Promise<Record<string, unknown>> {
    let title = 'Subatime';
    let body =
      summary.length > 140 ? `${summary.slice(0, 137).trim()}…` : summary;

    if (this.gemini.isConfigured()) {
      try {
        const raw = await this.gemini.generateContent(
          [
            'Return ONLY compact JSON: {"title":"","body":""}.',
            'title ≤ 36 characters; body ≤ 140 characters.',
            'Friendly daily forecast teaser for a mobile push. No markdown.',
          ].join('\n'),
          `Forecast summary:\n${summary}`,
        );
        const m = raw.match(/\{[\s\S]*\}/);
        if (m) {
          const j = JSON.parse(m[0]) as { title?: string; body?: string };
          if (j.title?.trim()) title = j.title.trim().slice(0, 40);
          if (j.body?.trim()) body = j.body.trim().slice(0, 160);
        }
      } catch (e) {
        this.logger.warn(`Gemini notification polish failed: ${String(e)}`);
      }
    }

    return {
      ...meta,
      title,
      body,
      summary,
    };
  }

  private todayUTC(): Date {
    return this.normalizeDate(new Date());
  }

  private normalizeDate(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }

  private atUtcTime(baseDate: Date, hour: number, minute: number): Date {
    return new Date(
      Date.UTC(
        baseDate.getUTCFullYear(),
        baseDate.getUTCMonth(),
        baseDate.getUTCDate(),
        hour,
        minute,
        0,
      ),
    );
  }

  private toDateString(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}
