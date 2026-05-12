import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { okResponse } from '../../common/utils/response.util';
import { PrismaService } from '../../database/prisma.service';
import { DreamExtractionService } from '../ai/services/dream-extraction.service';
import { GeminiLanguageService } from '../ai/services/gemini-language.service';
import { MatchingService } from '../matching/matching.service';
import { FeedbackLearningService } from '../prediction/services/feedback-learning.service';
import {
  DailyPredictionOutput,
  DailyPredictionService,
} from '../prediction/services/daily-prediction.service';
import {
  astroCodesForDream,
  computeDreamStress,
  computeSymbolRepetition,
  dreamStressBand,
  dreamStressBandLabel,
  type DreamStressBand,
} from './dream-engine';
import { WellnessSnapshotService } from '../user/wellness-snapshot.service';

type SubatimeDayRating = 'great' | 'good' | 'mixed' | 'tense';
type WindowLabel = 'morning' | 'afternoon' | 'evening' | 'night';

@Injectable()
export class SubatimeService {
  private readonly logger = new Logger(SubatimeService.name);

  constructor(
    private readonly dailyPredictionService: DailyPredictionService,
    private readonly prisma: PrismaService,
    private readonly matchingService: MatchingService,
    private readonly feedbackLearning: FeedbackLearningService,
    private readonly geminiLanguage: GeminiLanguageService,
    private readonly dreamExtraction: DreamExtractionService,
    private readonly wellnessSnapshots: WellnessSnapshotService,
  ) {}

  async getPlanDay(userId: string, date?: string, lang?: string) {
    const targetDate = this.parseDateOrToday(date);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    const prediction = await this.dailyPredictionService.generateForUser(
      userId,
      targetDate,
    );
    if (!prediction) {
      return okResponse(null, 'Birth profile required to generate plan');
    }
    const base = this.toDayPayload(prediction, user?.name);
    const normalizedLang = (lang ?? 'en').toLowerCase();
    if (normalizedLang === 'si') {
      const localized = await this.localizeDailyPayloadSi(base, prediction);
      return okResponse(localized, 'Plan day fetched');
    }
    return okResponse(base, 'Plan day fetched');
  }

  async getPersonalizedPlanDay(
    userId: string,
    input: {
      date?: string;
      sleepQuality?: number;
      stressLevel?: number;
      fatigueLevel?: number;
      focusArea?: 'overall' | 'career' | 'love' | 'health';
    },
  ) {
    const targetDate = this.parseDateOrToday(input.date);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    const prediction = await this.dailyPredictionService.generateForUser(
      userId,
      targetDate,
    );
    if (!prediction) {
      return okResponse(null, 'Birth profile required to generate plan');
    }
    const sleep = this.clampScore(input.sleepQuality ?? 3);
    const stress = this.clampScore(input.stressLevel ?? 3);
    const fatigue = this.clampScore(input.fatigueLevel ?? 3);
    const focusArea = input.focusArea ?? 'overall';
    const base = this.toDayPayload(prediction, user?.name);

    return okResponse(
      {
        ...base,
        personalizationInput: {
          sleepQuality: sleep,
          stressLevel: stress,
          fatigueLevel: fatigue,
          focusArea,
        },
        extraPredictions: this.buildExtraPredictions(prediction, {
          sleep,
          stress,
          fatigue,
          focusArea,
        }),
      },
      'Personalized plan fetched',
    );
  }

  async getPlanMonth(userId: string, month?: string) {
    const { year, monthIndex } = this.parseMonthOrCurrent(month);
    const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    const monthStart = new Date(Date.UTC(year, monthIndex, 1));
    const monthEnd = new Date(Date.UTC(year, monthIndex, daysInMonth));

    const existing = await this.prisma.dailyPrediction.findMany({
      where: {
        userId,
        date: { gte: monthStart, lte: monthEnd },
      },
      select: {
        date: true,
        summary: true,
        confidenceScore: true,
        scoreSpread: true,
        dominantContext: true,
      },
    });

    const isoKey = (d: Date) => d.toISOString().slice(0, 10);
    type MonthRow = {
      date: Date;
      confidenceScore: number;
      scoreSpread: number;
      dominantContext: string;
      summary: string;
    };
    const byIso = new Map<string, MonthRow>(
      existing.map((r) => [
        isoKey(r.date),
        {
          date: r.date,
          confidenceScore: r.confidenceScore,
          scoreSpread: r.scoreSpread,
          dominantContext: r.dominantContext,
          summary: (r.summary ?? '').trim(),
        },
      ]),
    );

    const missingDates: Date[] = [];
    for (let d = 1; d <= daysInMonth; d += 1) {
      const date = new Date(Date.UTC(year, monthIndex, d));
      if (!byIso.has(isoKey(date))) {
        missingDates.push(date);
      }
    }

    const concurrency = 4;
    for (let i = 0; i < missingDates.length; i += concurrency) {
      const chunk = missingDates.slice(i, i + concurrency);
      await Promise.all(
        chunk.map(async (date) => {
          // Match `/plan/day` quality (Gemini polish when configured); month slots stay consistent with list/detail.
          const prediction = await this.dailyPredictionService.generateForUser(userId, date, {
            polishSummary: true,
          });
          if (!prediction) return;
          byIso.set(prediction.date, {
            date,
            confidenceScore: prediction.confidenceScore,
            scoreSpread: prediction.meta.scoreSpread,
            dominantContext: prediction.personalization.mostRelevantContext,
            summary: (prediction.summary ?? '').trim(),
          });
        }),
      );
    }

    const slots = [];
    for (let d = 1; d <= daysInMonth; d += 1) {
      const date = new Date(Date.UTC(year, monthIndex, d));
      let row = byIso.get(isoKey(date));
      if (!row) {
        row = {
          date,
          confidenceScore: 0.5,
          scoreSpread: 0.35,
          dominantContext: 'overall',
          summary: '',
        };
      }
      const phase = this.moonPhaseForDate(date);
      const spread = Number.isFinite(row.scoreSpread) ? row.scoreSpread : 0.35;
      const rating = this.deriveRating(row.confidenceScore, spread);
      const primaryContext =
        typeof row.dominantContext === 'string' && row.dominantContext.trim().length > 0
          ? row.dominantContext.trim()
          : 'overall';
      const guidance =
        row.summary.length > 160 ? `${row.summary.slice(0, 157).trim()}…` : row.summary;
      slots.push({
        date: isoKey(date),
        day: d,
        dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getUTCDay()],
        moonPhase: phase,
        rating,
        primaryContext,
        guidance,
      });
    }

    return okResponse(
      {
        month: `${year}-${String(monthIndex + 1).padStart(2, '0')}`,
        slots,
      },
      'Plan month fetched',
    );
  }

  async getFeed(userId: string, limit: number, lang?: string) {
    const safeLimit = Math.min(80, Math.max(8, limit || 30));
    const contentLang =
      typeof lang === 'string' && lang.toLowerCase().trim().startsWith('si') ? 'si' : 'en';
    const today = this.normalizeDate(new Date());
    const sevenDaysAgo = new Date(today.getTime() - 6 * 86_400_000);
    /** Each day expands into several cards (Do, Avoid, …); fetch enough parent rows before slicing. */
    const predictionTake = Math.min(18, Math.max(7, Math.ceil(safeLimit / 5)));
    const predictions = await this.prisma.dailyPrediction.findMany({
      where: { userId, date: { gte: sevenDaysAgo, lte: today } },
      orderBy: { date: 'desc' },
      take: predictionTake,
    });
    const dreams = await this.prisma.dreamEntry.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 6,
    });
    const summarizePreview = (text: string): string => {
      const t = text.trim();
      if (!t.length) return '';
      return t.length > 160 ? `${t.slice(0, 157)}…` : t;
    };

    const userLagna = await this.resolveUserLagna(userId);

    const predictionRows: Array<{
      id: string;
      type: 'good' | 'avoid' | 'quote' | 'weekly' | 'prediction' | 'charm';
      title: string;
      preview: string;
      body: string;
      date: string;
      dateLabel: string;
      source: string;
      userLagna?: string | null;
      luckyNumber?: number;
      luckyColor?: string;
      luckyColorHex?: string;
    }> = [];

    for (const p of predictions) {
      const summary = p.summary.trim();
      const goodBlocks = this.parseStoredTimeBlocks(p.goodTimes);
      const badBlocks = this.parseStoredTimeBlocks(p.badTimes);
      const transitList = Array.isArray(p.transits) ? p.transits : [];
      const feedDoLines = this.buildFeedDoLinesFromBlocks(goodBlocks);
      const feedAvoidLines = this.buildFeedAvoidLinesFromBlocks(badBlocks);
      const feedQuote = this.buildFeedQuoteLine(summary, transitList);
      const feedReflection = this.buildFeedReflectionLine(p.confidenceScore);
      const feedGrowth = this.buildFeedGrowthLine(p.confidenceScore, transitList.length);
      const dateStr = p.date.toISOString().slice(0, 10);
      const dateLabel = this.relativeDayLabel(p.date, contentLang);

      if (feedDoLines.length) {
        const body = feedDoLines.join('\n\n');
        predictionRows.push({
          id: `pred-${p.id}-do`,
          type: 'good',
          title: contentLang === 'si' ? 'කරන්න' : 'Do',
          preview: summarizePreview(body),
          body,
          date: dateStr,
          dateLabel,
          source: this.feedDoWindowsSource(contentLang),
          ...(userLagna ? { userLagna } : {}),
        });
      }
      if (feedAvoidLines.length) {
        const body = feedAvoidLines.join('\n\n');
        predictionRows.push({
          id: `pred-${p.id}-avoid`,
          type: 'avoid',
          title: contentLang === 'si' ? 'වළක්වන්න' : 'Avoid',
          preview: summarizePreview(body),
          body,
          date: dateStr,
          dateLabel,
          source: this.feedAvoidWindowsSource(contentLang),
          ...(userLagna ? { userLagna } : {}),
        });
      }
      if (feedQuote.trim().length) {
        predictionRows.push({
          id: `pred-${p.id}-signal`,
          type: 'quote',
          title: contentLang === 'si' ? 'අද සංඥාව' : "Today's signal",
          preview: summarizePreview(feedQuote),
          body: feedQuote,
          date: dateStr,
          dateLabel,
          source: this.feedTransitSignalSource(contentLang),
          ...(userLagna ? { userLagna } : {}),
        });
      }
      if (feedReflection.trim().length) {
        predictionRows.push({
          id: `pred-${p.id}-heart`,
          type: 'quote',
          title: contentLang === 'si' ? 'හදවත සහ සංවරය' : 'Heart & gentle ritual',
          preview: summarizePreview(feedReflection),
          body: feedReflection,
          date: dateStr,
          dateLabel,
          source: this.feedGroundingSource(contentLang),
          ...(userLagna ? { userLagna } : {}),
        });
      }
      if (feedGrowth.trim().length) {
        predictionRows.push({
          id: `pred-${p.id}-how`,
          type: 'weekly',
          title: contentLang === 'si' ? 'මෙය කියවන්නේ මෙසේය' : 'How to read this',
          preview: summarizePreview(feedGrowth),
          body: feedGrowth,
          date: dateStr,
          dateLabel,
          source: this.feedModelNoteSource(contentLang),
          ...(userLagna ? { userLagna } : {}),
        });
      }
      const rhythmBody = this.buildFeedDaypartRhythmBody(summary, goodBlocks, badBlocks, contentLang);
      if (rhythmBody.trim().length) {
        predictionRows.push({
          id: `pred-${p.id}-rhythm`,
          type: 'quote',
          title: contentLang === 'si' ? 'උදෑසන · සවස · රාත්‍රිය' : 'Morning · Evening · Night',
          preview: summarizePreview(rhythmBody),
          body: rhythmBody,
          date: dateStr,
          dateLabel,
          source: this.feedDaypartRhythmSource(contentLang),
          ...(userLagna ? { userLagna } : {}),
        });
      }
      predictionRows.push({
        id: `pred-${p.id}`,
        type: 'prediction',
        title: summary,
        preview: summarizePreview(summary),
        body: summary,
        date: dateStr,
        dateLabel,
        source: this.feedPredictionSource(contentLang),
        ...(userLagna ? { userLagna } : {}),
      });
    }

    const todayIso = today.toISOString().slice(0, 10);
    const todayPred = predictions.find((p) => p.date.toISOString().slice(0, 10) === todayIso);
    const charmRow = todayPred
      ? this.buildTodayCharmFeedRow(userId, todayPred, contentLang, userLagna ?? undefined)
      : null;

    const feedItems = [
      ...(charmRow ? [charmRow] : []),
      ...predictionRows,
      ...dreams.map((d) => this.buildDreamFeedRow(d, contentLang)),
    ].sort((a, b) => (a.date < b.date ? 1 : -1));

    const sliced = feedItems.slice(0, safeLimit);

    if (contentLang === 'si' && sliced.length > 0) {
      const payloads = sliced.map((row) => ({
        title: row.title,
        preview: row.preview,
        body: row.body,
        source: row.source,
        dreamStateLabel:
          row.type === 'dream' ? ((row as { dreamStateLabel?: string | null }).dreamStateLabel ?? null) : null,
        dreamInsight:
          row.type === 'dream' ? ((row as { dreamInsight?: string | null }).dreamInsight ?? null) : null,
        dreamGrounding:
          row.type === 'dream' ? ((row as { dreamGrounding?: string | null }).dreamGrounding ?? null) : null,
        dreamThemes:
          row.type === 'dream' ? ((row as { dreamThemes?: string[] }).dreamThemes ?? undefined) : undefined,
      }));
      const translated = await this.geminiLanguage.localizeFeedRowsSi(payloads);
      if (translated) {
        for (let i = 0; i < sliced.length; i++) {
          const t = translated[i];
          const cur = sliced[i] as Record<string, unknown>;
          sliced[i] = {
            ...cur,
            title: t.title,
            preview: t.preview,
            body: t.body,
            source: t.source,
            ...(cur.type === 'dream'
              ? {
                  dreamStateLabel: t.dreamStateLabel,
                  dreamInsight: t.dreamInsight,
                  dreamGrounding: t.dreamGrounding,
                  dreamThemes: t.dreamThemes ?? cur.dreamThemes,
                }
              : {}),
          } as (typeof feedItems)[number];
        }
      }
    }

    return okResponse(sliced, 'Feed fetched');
  }

  private parseStoredTimeBlocks(raw: unknown): Array<{ label: string; start: string; end: string }> {
    if (!Array.isArray(raw)) return [];
    const out: Array<{ label: string; start: string; end: string }> = [];
    for (const x of raw) {
      if (!x || typeof x !== 'object') continue;
      const o = x as Record<string, unknown>;
      const label = typeof o.label === 'string' ? o.label.trim() : '';
      const start = typeof o.start === 'string' ? o.start.trim() : '';
      const end = typeof o.end === 'string' ? o.end.trim() : '';
      if (!label && !start) continue;
      out.push({ label, start, end });
    }
    return out;
  }

  private buildFeedDoLinesFromBlocks(
    blocks: Array<{ label: string; start: string; end: string }>,
  ): string[] {
    return blocks.slice(0, 2).map((b) => {
      if (b.start && b.end) {
        return `${b.label || 'Window'}: strongest momentum ${b.start}–${b.end}—schedule what matters here.`;
      }
      return `${b.label || 'Window'}: favor steady progress while this stretch feels supportive.`;
    });
  }

  private buildFeedAvoidLinesFromBlocks(
    blocks: Array<{ label: string; start: string; end: string }>,
  ): string[] {
    return blocks.slice(0, 2).map((b) => {
      if (b.start && b.end) {
        return `${b.label || 'Window'}: lighter stakes ${b.start}–${b.end}; delay confrontations if you can.`;
      }
      return `${b.label || 'Window'}: keep demands low while signals feel heavier.`;
    });
  }

  private buildFeedQuoteLine(summary: string, transits: unknown[]): string {
    for (const x of transits) {
      if (!x || typeof x !== 'object') continue;
      const o = x as Record<string, unknown>;
      const title = typeof o.title === 'string' ? o.title.trim() : '';
      const description = typeof o.description === 'string' ? o.description.trim() : '';
      const line = [title, description].filter((s) => s.length > 0).join(' — ');
      if (line.length > 24) {
        return line.length > 280 ? `${line.slice(0, 277)}…` : line;
      }
    }
    const s = summary.trim();
    if (s.length > 48) {
      const cut = s.indexOf('.', 40);
      const slice = cut > 20 ? s.slice(0, cut + 1) : s.slice(0, 200);
      return slice.trim();
    }
    return 'Carry today lightly: one honest step is enough.';
  }

  private buildFeedReflectionLine(confidenceScore: number): string {
    const c = Number.isFinite(confidenceScore) ? confidenceScore : 0.65;
    if (c >= 0.72) {
      return 'Heart: take a quiet moment for someone you love—a short prayer, warm wish, or blessing steadies the nervous system more than rushing.';
    }
    if (c >= 0.56) {
      return 'Grounding: if a temple, mosque, church, shrine, or calm outdoor spot has helped you before, consider a brief visit—or reserve a few minutes today for that same stillness at home.';
    }
    return 'Gentleness: when the mind feels crowded, small rituals (light, breath, prayer, or writing one line of gratitude) make room to care for others without burning out.';
  }

  private buildFeedGrowthLine(confidenceScore: number, transitCount: number): string {
    const c = Number.isFinite(confidenceScore) ? confidenceScore : 0.65;
    const n = Math.max(0, transitCount);
    const band = c >= 0.7 ? 'stronger alignment' : c >= 0.55 ? 'mixed signals' : 'heavier friction windows';
    return (
      `How to read this: scores blend your chart transits with past feedback (${n} transit highlight${n === 1 ? '' : 's'} in this pack). ` +
      `Today leans ${band}. Use the feed as scheduling weather—helpful context, not fate. Stress and sleep still move outcomes more than any single aspect.`
    );
  }

  private feedDoWindowsSource(lang: string): string {
    return lang === 'si' ? 'දිනපතා · ශක්තිමත් කාල' : 'Daily · Favored windows';
  }

  private feedAvoidWindowsSource(lang: string): string {
    return lang === 'si' ? 'දිනපතා · ප්‍රවේශම් කාල' : 'Daily · Caution windows';
  }

  private feedTransitSignalSource(lang: string): string {
    return lang === 'si' ? 'දිනපතා · සංක්‍රමණ' : 'Daily · Transit highlight';
  }

  private feedGroundingSource(lang: string): string {
    return lang === 'si' ? 'දිනපතා · සංවරය' : 'Daily · Grounding';
  }

  private feedModelNoteSource(lang: string): string {
    return lang === 'si' ? 'දිනපතා · කියවීම' : 'Daily · Reading the model';
  }

  private feedPredictionSource(lang: string): string {
    return lang === 'si' ? 'දිනපතා අනාවැකිය' : 'Daily prediction';
  }

  private feedDreamSource(lang: string): string {
    return lang === 'si' ? 'සිහින දිනපොත' : 'Dream journal';
  }

  private feedCharmSource(lang: string): string {
    return lang === 'si' ? 'දිනපතා · සුළු ආශීර්වාද' : 'Daily · Micro-charm';
  }

  private feedDaypartRhythmSource(lang: string): string {
    return lang === 'si' ? 'දිනපතා · දින කාලය' : 'Daily · Day parts';
  }

  /** Same highlights as morning / evening / night notifications: top window, caution, wind-down. */
  private buildFeedDaypartRhythmBody(
    summary: string,
    good: Array<{ label: string; start: string; end: string }>,
    bad: Array<{ label: string; start: string; end: string }>,
    lang: string,
  ): string {
    const s = summary.trim();
    const clip = (t: string, max: number) => (t.length <= max ? t : `${t.slice(0, Math.max(0, max - 1)).trim()}…`);
    const g0 = good[0];
    const b0 = bad[0];
    let morning = '';
    if (g0?.start && g0?.end) {
      const lab = (g0.label ?? '').trim() || 'Window';
      morning =
        lang === 'si'
          ? `උදෑසන: ${lab} ${g0.start}–${g0.end} හොඳම ප්‍රවේගය.`
          : `Morning: ${lab} — strongest flow ${g0.start}–${g0.end}.`;
    } else if (s.length) {
      morning = lang === 'si' ? `උදෑසන: ${clip(s, 90)}` : `Morning: ${clip(s, 100)}`;
    }
    let evening = '';
    if (b0?.start && b0?.end) {
      const lab = (b0.label ?? '').trim() || 'Caution';
      evening =
        lang === 'si'
          ? `සවස: ${b0.start}–${b0.end} ලාභ තීරණ (${lab}).`
          : `Evening: lighter stakes ${b0.start}–${b0.end} (${lab}).`;
    } else if (s.length) {
      evening = lang === 'si' ? `සවස: ${clip(s, 80)}` : `Evening: ${clip(s, 90)}`;
    }
    let night = '';
    if (s.length) {
      night =
        lang === 'si'
          ? `රාත්‍රිය: ${clip(s, 85)} නිශ්චලතාව තෝරන්න.`
          : `Night: ${clip(s, 90)} Wind down; favor rest.`;
    }
    const parts = [morning, evening, night].filter((x) => x.trim().length > 0);
    return parts.join('\n\n');
  }

  /** Sidereal ascendant for feed/notifications; mirrors chart / birth profile used for scoring. */
  private async resolveUserLagna(userId: string): Promise<string | null> {
    const profile = await this.prisma.birthProfile.findUnique({
      where: { userId },
      select: { id: true, lagna: true },
    });
    if (!profile) return null;
    const fromProfile = typeof profile.lagna === 'string' ? profile.lagna.trim() : '';
    if (fromProfile.length) return fromProfile;
    const chart = await this.prisma.astrologyChart.findFirst({
      where: { birthProfileId: profile.id },
      orderBy: { version: 'desc' },
      select: { chartData: true },
    });
    const cd = chart?.chartData as Record<string, unknown> | undefined;
    const fromChart = typeof cd?.lagna === 'string' ? cd.lagna.trim() : '';
    return fromChart.length ? fromChart : null;
  }

  async getNotifications(userId: string, limit: number) {
    const safeLimit = Math.min(50, Math.max(5, limit || 30));
    const jobs = await this.prisma.notificationJob.findMany({
      where: { userId },
      orderBy: { scheduledAt: 'desc' },
      take: safeLimit,
    });
    const items = jobs.map((j, idx) => {
      const payload = (j.payload as Record<string, unknown>) ?? {};
      const title =
        typeof payload.title === 'string'
          ? payload.title
          : `${String(j.type).toUpperCase()} update`;
      const body = typeof payload.body === 'string' ? payload.body : 'Your latest guidance is ready.';
      const ulRaw = payload.userLagna;
      const userLagna =
        typeof ulRaw === 'string' && ulRaw.trim().length > 0 ? ulRaw.trim() : null;
      const slotRaw = payload.slot;
      const slot = typeof slotRaw === 'string' && slotRaw.trim().length > 0 ? slotRaw.trim() : null;
      const pidRaw = payload.predictionId;
      const predictionId =
        typeof pidRaw === 'string' && pidRaw.trim().length > 0 ? pidRaw.trim() : null;
      const dateRaw = payload.date;
      const planDate = typeof dateRaw === 'string' && dateRaw.trim().length > 0 ? dateRaw.trim() : null;
      return {
        id: j.id,
        type: String(j.type),
        title,
        body,
        time: this.relativeTimeLabel(j.scheduledAt),
        unread: !j.isRead,
        ...(userLagna ? { userLagna } : {}),
        ...(slot ? { slot } : {}),
        ...(predictionId ? { predictionId } : {}),
        ...(planDate ? { planDate } : {}),
      };
    });
    return okResponse(items, 'Notifications fetched');
  }

  async markAllNotificationsRead(userId: string) {
    await this.prisma.notificationJob.updateMany({
      where: { userId },
      data: { isRead: true },
    });
    return okResponse({ success: true }, 'Notifications marked read');
  }

  async interpretDream(userId: string, text: string, mood?: string, lang?: string) {
    const trimmed = text.trim();
    if (!trimmed.length) {
      throw new BadRequestException('Dream text is required');
    }
    const contentLang: 'en' | 'si' =
      typeof lang === 'string' && lang.toLowerCase().trim().startsWith('si') ? 'si' : 'en';

    const prior = await this.prisma.dreamEntry.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: { analysis: true },
    });

    let usedGemini = false;
    let extraction = await this.dreamExtraction.extractFromDreamText(trimmed, contentLang);
    if (extraction) {
      usedGemini = true;
    } else {
      extraction = this.dreamExtraction.extractHeuristic(trimmed, contentLang);
    }

    const repetitionIndex = computeSymbolRepetition(extraction.symbols, prior);
    const dreamStress = computeDreamStress({
      negativity: extraction.negativity,
      intensity: extraction.intensity,
      repetitionIndex,
      clarity: extraction.clarity,
    });
    const band = dreamStressBand(dreamStress);

    await this.prisma.dreamEntry.create({
      data: {
        userId,
        title: trimmed.slice(0, 60) || 'Dream entry',
        body: trimmed,
        mood: mood?.trim() || 'reflective',
        analysis: {
          engineVersion: 1,
          usedGemini,
          extraction,
          repetitionIndex,
          dreamStress,
          band,
        },
      },
    });

    return okResponse(
      {
        themes: extraction.themes,
        symbols: extraction.symbols,
        patternHints: extraction.pattern_hints,
        emotion: extraction.emotion,
        dreamStress,
        stateBand: band,
        stateLabel: dreamStressBandLabel(band, contentLang === 'si' ? 'si' : undefined),
        repetitionIndex,
        astroCodes: astroCodesForDream(extraction, contentLang === 'si' ? 'si' : undefined),
        insight: extraction.summary_line,
        connection: extraction.grounding_tip,
        usedGemini,
      },
      'Dream interpreted',
    );
  }

  async getDreamMemory(userId: string, limit: number) {
    const safeLimit = Math.min(40, Math.max(5, limit || 20));
    const dreams = await this.prisma.dreamEntry.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: safeLimit,
    });
    const entries = dreams.map((d) => {
      const analysis = (d.analysis ?? null) as Record<string, unknown> | null;
      const ext = analysis?.extraction as Record<string, unknown> | undefined;
      const themeList = ext?.themes;
      const themeArr = Array.isArray(themeList) ? themeList.map((t) => String(t)) : [];
      const themesJoin = themeArr.join(' · ');
      const symbols = ext?.symbols;
      const symbolList = Array.isArray(symbols)
        ? symbols.map((s) => String(s)).filter(Boolean)
        : [];
      const bandRaw = analysis?.band;
      const stateLabel =
        typeof bandRaw === 'string' && this.isDreamStressBand(bandRaw)
          ? dreamStressBandLabel(bandRaw)
          : '';

      return {
        id: d.id,
        type: 'dream',
        date: d.createdAt.toISOString().slice(0, 10),
        title: d.title,
        connected: true,
        interpretation: themesJoin || d.body.slice(0, 180),
        symbols: symbolList,
        themes: themeArr,
        stateBand: typeof analysis?.band === 'string' ? analysis.band : null,
        stateLabel,
        insight:
          typeof ext?.summary_line === 'string' ? String(ext.summary_line).trim() : '',
        grounding:
          typeof ext?.grounding_tip === 'string' ? String(ext.grounding_tip).trim() : '',
      };
    });
    return okResponse(entries, 'Dream memory fetched');
  }

  async getDreamStressAnalytics(userId: string, days?: 30 | 90) {
    const windowDays = days === 90 ? 90 : 30;
    const today = this.normalizeDate(new Date());
    const from = new Date(today.getTime() - (windowDays - 1) * 86_400_000);
    const toExclusive = new Date(today.getTime() + 86_400_000);

    const rows = await this.prisma.dreamEntry.findMany({
      where: {
        userId,
        createdAt: {
          gte: from,
          lt: toExclusive,
        },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        createdAt: true,
        analysis: true,
      },
    });

    const bandCounts: Record<DreamStressBand, number> = {
      stable: 0,
      mild: 0,
      elevated: 0,
      overload: 0,
    };
    const themeCounts = new Map<string, number>();
    const symbolCounts = new Map<string, number>();
    const dayAcc = new Map<string, { sum: number; count: number }>();
    let analyzedEntries = 0;

    for (const row of rows) {
      const analysis = (row.analysis ?? null) as Record<string, unknown> | null;
      if (!analysis) continue;
      analyzedEntries += 1;
      const stressRaw = analysis.dreamStress;
      const stress =
        typeof stressRaw === 'number' && Number.isFinite(stressRaw)
          ? Math.max(0, Math.min(1, stressRaw))
          : null;
      const bandRaw = analysis.band;
      const band =
        typeof bandRaw === 'string' && this.isDreamStressBand(bandRaw)
          ? bandRaw
          : null;
      if (band) {
        bandCounts[band] += 1;
      }
      const extraction = analysis.extraction as Record<string, unknown> | undefined;
      const themes = Array.isArray(extraction?.themes)
        ? extraction!.themes.map((t) => String(t).trim()).filter(Boolean)
        : [];
      const symbols = Array.isArray(extraction?.symbols)
        ? extraction!.symbols.map((s) => String(s).trim()).filter(Boolean)
        : [];
      for (const t of themes) {
        themeCounts.set(t, (themeCounts.get(t) ?? 0) + 1);
      }
      for (const s of symbols) {
        symbolCounts.set(s, (symbolCounts.get(s) ?? 0) + 1);
      }
      if (stress != null) {
        const key = row.createdAt.toISOString().slice(0, 10);
        const prev = dayAcc.get(key) ?? { sum: 0, count: 0 };
        dayAcc.set(key, { sum: prev.sum + stress, count: prev.count + 1 });
      }
    }

    const trendSeries = Array.from({ length: windowDays }, (_, i) => {
      const date = new Date(from.getTime() + i * 86_400_000);
      const key = date.toISOString().slice(0, 10);
      const acc = dayAcc.get(key);
      const averageStress =
        !acc || acc.count === 0 ? null : Number((acc.sum / acc.count).toFixed(4));
      return {
        date: key,
        entryCount: acc?.count ?? 0,
        averageStress,
      };
    }).map((row, idx, all) => {
      const start = Math.max(0, idx - 6);
      const win = all.slice(start, idx + 1).map((x) => x.averageStress).filter((x): x is number => x != null);
      const movingAverage7 =
        win.length === 0
          ? null
          : Number((win.reduce((sum, x) => sum + x, 0) / win.length).toFixed(4));
      return {
        ...row,
        movingAverage7,
      };
    });

    const avgStressValues = trendSeries
      .map((x) => x.averageStress)
      .filter((x): x is number => x != null);
    const averageStress =
      avgStressValues.length === 0
        ? null
        : Number((avgStressValues.reduce((sum, x) => sum + x, 0) / avgStressValues.length).toFixed(4));

    const last7Values = trendSeries
      .slice(-7)
      .map((x) => x.averageStress)
      .filter((x): x is number => x != null);
    const first7Values = trendSeries
      .slice(0, Math.min(7, trendSeries.length))
      .map((x) => x.averageStress)
      .filter((x): x is number => x != null);
    const last7AverageStress =
      last7Values.length === 0
        ? null
        : Number((last7Values.reduce((sum, x) => sum + x, 0) / last7Values.length).toFixed(4));
    const first7AverageStress =
      first7Values.length === 0
        ? null
        : Number((first7Values.reduce((sum, x) => sum + x, 0) / first7Values.length).toFixed(4));
    const stressDelta =
      last7AverageStress == null || first7AverageStress == null
        ? null
        : Number((last7AverageStress - first7AverageStress).toFixed(4));

    const toBreakdown = (src: Map<string, number>, top = 12) =>
      [...src.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, top)
        .map(([label, count]) => ({ label, count }));

    const mostCommonBandEntry = Object.entries(bandCounts).sort((a, b) => b[1] - a[1])[0];
    const mostCommonBand =
      !mostCommonBandEntry || mostCommonBandEntry[1] === 0
        ? null
        : (mostCommonBandEntry[0] as DreamStressBand);

    return okResponse(
      {
        summaryStats: {
          windowDays,
          totalEntries: rows.length,
          analyzedEntries,
          daysWithEntries: trendSeries.filter((x) => x.entryCount > 0).length,
          averageStress,
          last7AverageStress,
          first7AverageStress,
          stressDelta,
          mostCommonBand,
        },
        trendSeries,
        stressBands: bandCounts,
        themeBreakdown: toBreakdown(themeCounts),
        symbolBreakdown: toBreakdown(symbolCounts),
      },
      'Dream stress analytics fetched',
    );
  }

  private isDreamStressBand(b: string): b is DreamStressBand {
    return b === 'stable' || b === 'mild' || b === 'elevated' || b === 'overload';
  }

  private buildDreamFeedRow(
    d: {
      id: string;
      title: string;
      body: string;
      createdAt: Date;
      analysis?: unknown;
    },
    contentLang: string,
  ) {
    const analysis = (d.analysis ?? null) as Record<string, unknown> | null;
    const ext = analysis?.extraction as Record<string, unknown> | undefined;
    const themes = Array.isArray(ext?.themes) ? ext!.themes.map((t) => String(t)) : [];
    const symbols = Array.isArray(ext?.symbols)
      ? ext!.symbols.map((s) => String(s)).filter(Boolean)
      : [];
    const insight =
      typeof ext?.summary_line === 'string' ? String(ext.summary_line).trim() : '';
    const grounding =
      typeof ext?.grounding_tip === 'string' ? String(ext.grounding_tip).trim() : '';
    const bandRaw = analysis?.band;
    const stateLabel =
      typeof bandRaw === 'string' && this.isDreamStressBand(bandRaw)
        ? dreamStressBandLabel(bandRaw, contentLang === 'si' ? 'si' : undefined)
        : null;

    let preview = d.body.slice(0, 120);
    if (insight) {
      preview = insight.length > 160 ? `${insight.slice(0, 157)}…` : insight;
    } else if (themes.length) {
      preview = themes.slice(0, 5).join(' · ');
      if (preview.length > 160) preview = `${preview.slice(0, 157)}…`;
    }
    if (stateLabel && preview.length < 40) {
      preview = `${stateLabel} — ${preview}`.slice(0, 170);
    }

    return {
      id: `dream-${d.id}`,
      type: 'dream',
      title: d.title,
      preview,
      body: d.body,
      date: d.createdAt.toISOString().slice(0, 10),
      dateLabel: this.relativeDayLabel(d.createdAt, contentLang),
      source: this.feedDreamSource(contentLang),
      dreamStateLabel: stateLabel,
      dreamThemes: themes,
      dreamSymbols: symbols,
      dreamInsight: insight || null,
      dreamGrounding: grounding || null,
    };
  }

  /** Deterministic “lucky” anchor from user + date + prediction id (playful ritual, not fate). */
  private luckyCharmFields(
    userId: string,
    dateIso: string,
    predictionId: string,
  ): { luckyNumber: number; luckyColor: string; luckyColorHex: string } {
    const palette = [
      { name: 'Emerald', hex: '#10B981' },
      { name: 'Amber', hex: '#F59E0B' },
      { name: 'Ocean', hex: '#0EA5E9' },
      { name: 'Rose', hex: '#F43F5E' },
      { name: 'Violet', hex: '#8B5CF6' },
      { name: 'Gold', hex: '#EAB308' },
      { name: 'Teal', hex: '#14B8A6' },
      { name: 'Coral', hex: '#FB7185' },
      { name: 'Sapphire', hex: '#3B82F6' },
      { name: 'Jade', hex: '#22C55E' },
      { name: 'Lilac', hex: '#C084FC' },
      { name: 'Copper', hex: '#D97706' },
    ] as const;
    const seed = `${userId}|${dateIso}|${predictionId}`;
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const u = h >>> 0;
    const luckyNumber = (u % 99) + 1;
    const luckyColor = palette[u % palette.length];
    return { luckyNumber, luckyColor: luckyColor.name, luckyColorHex: luckyColor.hex };
  }

  private buildTodayCharmFeedRow(
    userId: string,
    p: { id: string; date: Date; confidenceScore: number; scoreSpread: number },
    contentLang: string,
    userLagna?: string | null,
  ) {
    const dateStr = p.date.toISOString().slice(0, 10);
    const luck = this.luckyCharmFields(userId, dateStr, p.id);
    const dateLabel = this.relativeDayLabel(p.date, contentLang);
    const title =
      contentLang === 'si'
        ? `අදේ සුළු ආශීර්වාද · ${luck.luckyNumber}`
        : `Today’s micro-charm · ${luck.luckyNumber}`;
    const preview =
      contentLang === 'si'
        ? `${luck.luckyColor} — අද ඔබේ රිද්මයට මෘදු සලකුණක්.`
        : `${luck.luckyColor} — a soft anchor for your rhythm today.`;
    const body =
      contentLang === 'si'
        ? `අංකය ${luck.luckyNumber}. වර්ණය ${luck.luckyColor}. මෙය විනෝදාත්මක සංඥාවක් පමණක්—තීරණ ඔබේමය.`
        : `Number ${luck.luckyNumber}. Color ${luck.luckyColor}. A playful ritual anchor, not destiny—your choices stay yours.`;
    return {
      id: `lucky-${p.id}`,
      type: 'charm' as const,
      title,
      preview,
      body,
      date: dateStr,
      dateLabel,
      source: this.feedCharmSource(contentLang),
      luckyNumber: luck.luckyNumber,
      luckyColor: luck.luckyColor,
      luckyColorHex: luck.luckyColorHex,
      ...(userLagna ? { userLagna } : {}),
    };
  }

  async getMatchProfiles(userId: string) {
    const items = await (this.prisma as any).compatibilityProfile.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return okResponse(
      items.map((p: any) => ({
        id: p.id,
        name: p.fullName,
        sign: p.zodiacSign,
        overall: p.compatibilityScore ?? null,
      })),
      'Match profiles fetched',
    );
  }

  async compareMatch(
    userId: string,
    partner: {
      fullName?: string;
      zodiacSign?: string;
      dateOfBirth?: string;
      birthLocation?: string;
      timeOfBirth?: string;
    },
  ) {
    const me = await this.prisma.birthProfile.findUnique({ where: { userId } });
    if (!me) {
      return okResponse(null, 'Birth profile required for compatibility');
    }
    const partnerSign = partner.zodiacSign?.trim();
    if (!partnerSign) {
      return okResponse(null, 'Partner zodiac sign is required for this comparison.');
    }

    const chart = await this.prisma.astrologyChart.findFirst({
      where: { birthProfileId: me.id },
      orderBy: { version: 'desc' },
    });
    const cd = (chart?.chartData as Record<string, unknown>) ?? {};
    const lagnaMe = String(me.lagna ?? cd?.lagna ?? '').trim();
    const nakshatraMe = String(me.nakshatra ?? cd?.nakshatra ?? '').trim();
    if (!lagnaMe || !nakshatraMe) {
      return okResponse(
        null,
        'Your chart is missing ascendant or nakshatra. Update birth details from Profile.',
      );
    }

    const compare = this.matchingService.compare({
      profileA: {
        lagna: lagnaMe,
        nakshatra: nakshatraMe,
        moonSign: lagnaMe,
      },
      profileB: {
        lagna: partnerSign,
        nakshatra: partnerSign,
        moonSign: partnerSign,
      },
    });
    const data = compare.data;
    return okResponse(
      {
        summary: data.summary,
        userLagna: lagnaMe,
        userElement: this.lagnaElement(lagnaMe),
        partnerName: partner.fullName ?? 'Partner',
        partnerSign: partnerSign,
        partnerElement: this.signElement(partnerSign),
        overall: data.score,
        breakdown: [
          { label: 'Communication', value: data.breakdown.communication },
          { label: 'Intimacy', value: data.breakdown.intimacy },
          { label: 'Long-term', value: data.breakdown.longTerm },
          { label: 'Emotional', value: data.breakdown.emotional },
          { label: 'Friction', value: Math.max(10, 100 - data.score) },
        ],
        strengths: data.recommendations.slice(0, 2),
        challenges: ['Different pacing styles can create friction.', 'Use explicit check-ins for emotional clarity.'],
        commYours: 'Direct, practical, grounding.',
        commTheirs: 'Emotion-first, layered, intuitive.',
        commBridge: 'State feelings early and summarize intent in one sentence.',
        loveYou: 'Acts of Service',
        loveThem: 'Quality Time',
        loveOverlap: 'Both respond best to clear presence and reliability.',
        bestDates: [
          { label: 'Most romantic', date: 'Friday evening', reason: 'Venus harmony.' },
          { label: 'Best for talking', date: 'Sunday morning', reason: 'Mercury support.' },
          { label: 'Avoid for big talks', date: 'Wednesday', reason: 'Moon-Mars tension.' },
        ],
        frictionTip:
          'When tension rises, slow the pace before solving. Name emotion, then propose action.',
      },
      'Match compared',
    );
  }

  async submitNightlyCheckin(
    userId: string,
    input: {
      moodStability: number;
      focusQuality: number;
      socialEase: number;
      stressIntensity: number;
      bestEnergyWindow: WindowLabel;
      mostStressfulWindow: WindowLabel;
      sleepQuality?: number;
      unusualStress?: number;
      fatigueLevel?: number;
      notes?: string;
    },
  ) {
    const today = this.normalizeDate(new Date());
    const generated = await this.dailyPredictionService.generateForUser(userId, today);
    const prediction = await this.prisma.dailyPrediction.findUnique({
      where: {
        userId_date: {
          userId,
          date: today,
        },
      },
    });
    if (!prediction || !generated) {
      return okResponse(null, 'Prediction required before check-in');
    }

    const good = generated.goodTimes.map((b) => this.windowFromClock(b.start));
    const bad = generated.badTimes.map((b) => this.windowFromClock(b.start));
    const topWindowHit = good.includes(input.bestEnergyWindow);
    const stressWindowHit = bad.includes(input.mostStressfulWindow);

    const sleepPenalty = ((input.sleepQuality ?? 3) - 3) * 0.04;
    const stressPenalty = ((input.unusualStress ?? 3) - 3) * -0.05;
    const fatiguePenalty = ((input.fatigueLevel ?? 3) - 3) * -0.04;

    const selfReported =
      (input.moodStability + input.focusQuality + input.socialEase + (6 - input.stressIntensity)) / 20;
    const predicted = Math.min(1, Math.max(0, prediction.confidenceScore + sleepPenalty + stressPenalty + fatiguePenalty));
    const proximity = 1 - Math.min(1, Math.abs(selfReported - predicted));
    const timingBonus = (topWindowHit ? 0.2 : 0) + (stressWindowHit ? 0.2 : 0);
    const calibrationScore = Number(Math.min(1, Math.max(0, proximity * 0.6 + timingBonus)).toFixed(4));
    const feedback: 'good' | 'bad' = calibrationScore >= 0.62 ? 'good' : 'bad';

    const outcome = {
      version: 'nightly-checkin-v1',
      scales: {
        moodStability: input.moodStability,
        focusQuality: input.focusQuality,
        socialEase: input.socialEase,
        stressIntensity: input.stressIntensity,
      },
      windows: {
        bestEnergyWindow: input.bestEnergyWindow,
        mostStressfulWindow: input.mostStressfulWindow,
        predictedBestWindows: good,
        predictedStressWindows: bad,
      },
      context: {
        sleepQuality: input.sleepQuality ?? null,
        unusualStress: input.unusualStress ?? null,
        fatigueLevel: input.fatigueLevel ?? null,
      },
      notes: input.notes ?? null,
      calibration: {
        selfReported,
        predicted,
        topWindowHit,
        stressWindowHit,
        calibrationScore,
      },
    };

    const existing = await this.prisma.predictionFeedback.findFirst({
      where: { predictionId: prediction.id, userId, contextType: 'overall' },
      orderBy: { timestamp: 'desc' },
    });

    const saved = existing
      ? await this.prisma.predictionFeedback.update({
          where: { id: existing.id },
          data: {
            feedback,
            actualOutcome: JSON.stringify(outcome),
            contextType: 'overall',
            timeSlot: input.bestEnergyWindow,
            timestamp: new Date(),
          },
        })
      : await this.prisma.predictionFeedback.create({
          data: {
            predictionId: prediction.id,
            userId,
            feedback,
            actualOutcome: JSON.stringify(outcome),
            contextType: 'overall',
            timeSlot: input.bestEnergyWindow,
          },
        });

    const accuracyScore = await this.feedbackLearning.recomputeUserAccuracy(userId);

    try {
      await this.wellnessSnapshots.recordNightlyCheckin(userId, today, {
        sleepQuality: input.sleepQuality ?? 3,
        unusualStress: input.unusualStress ?? 3,
        fatigueLevel: input.fatigueLevel ?? 3,
      });
    } catch (err) {
      this.logger.warn(`Wellness nightly snapshot skipped: ${String(err)}`);
    }

    return okResponse(
      {
        predictionId: prediction.id,
        feedbackId: saved.id,
        feedback,
        calibrationScore,
        topWindowHit,
        stressWindowHit,
        accuracyScore,
      },
      'Nightly check-in captured',
    );
  }

  async getNightlySummary(userId: string, days: number) {
    const safeDays = Math.min(90, Math.max(7, days || 30));
    const since = new Date(Date.now() - safeDays * 86_400_000);
    const rows = await this.prisma.predictionFeedback.findMany({
      where: { userId, contextType: 'overall', timestamp: { gte: since } },
      orderBy: { timestamp: 'desc' },
      take: 400,
    });
    const parsed = rows
      .map((r) => {
        try {
          return {
            feedback: r.feedback,
            payload: JSON.parse(r.actualOutcome ?? '{}') as Record<string, any>,
          };
        } catch {
          return null;
        }
      })
      .filter((x): x is { feedback: 'good' | 'bad'; payload: Record<string, any> } => x != null);

    const total = parsed.length;
    const good = parsed.filter((p) => p.feedback === 'good').length;
    const topWindowHits = parsed.filter((p) => p.payload?.calibration?.topWindowHit === true).length;
    const stressWindowHits = parsed.filter((p) => p.payload?.calibration?.stressWindowHit === true).length;
    const avgCalibration =
      total === 0
        ? 0
        : Number(
            (
              parsed.reduce((sum, p) => sum + Number(p.payload?.calibration?.calibrationScore ?? 0), 0) /
              total
            ).toFixed(4),
          );

    return okResponse(
      {
        windowDays: safeDays,
        totalCheckins: total,
        calibrationHitRate: total === 0 ? 0 : Number((good / total).toFixed(4)),
        topWindowHitRate: total === 0 ? 0 : Number((topWindowHits / total).toFixed(4)),
        stressWindowHitRate: total === 0 ? 0 : Number((stressWindowHits / total).toFixed(4)),
        averageCalibrationScore: avgCalibration,
      },
      'Nightly summary fetched',
    );
  }

  private toDayPayload(prediction: DailyPredictionOutput, userName?: string) {
    const rating = this.deriveRating(
      prediction.confidenceScore,
      prediction.meta.scoreSpread,
    );
    const bestWindow = prediction.goodTimes[0];
    const cautionWindow = prediction.badTimes[0];
    const dateObj = new Date(`${prediction.date}T00:00:00.000Z`);
    const moonPhase = this.moonPhaseForDate(dateObj);
    const phaseMeta = this.moonPhaseMeta(moonPhase);
    const contextWeight =
      prediction.personalization.contextWeights[
        prediction.personalization.mostRelevantContext
      ] ?? 0;
    const focusPct = Math.round(contextWeight * 100);
    const luck = this.luckyCharmFields(
      prediction.userId,
      prediction.date,
      prediction.predictionId,
    );
    const predictionSpotlight =
      rating === 'great' ||
      (rating === 'good' && prediction.confidenceScore >= 0.72);

    return {
      predictionId: prediction.predictionId,
      date: prediction.date,
      // Sidereal ascendant (Lagna); anchor for whole-sign house scoring (not tropical Sun sign).
      userLagna: (prediction.meta.lagna ?? '').trim() || null,
      userName: userName ?? 'Friend',
      headerLabel: `TODAY · ${dateObj
        .toLocaleDateString('en-US', {
          weekday: 'short',
          day: '2-digit',
          timeZone: 'UTC',
        })
        .toUpperCase()}`,
      dayLabel: dateObj.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }),
      moonPhase,
      rating,
      guidance: prediction.summary,
      bestWindow: bestWindow
        ? `${bestWindow.label} (${bestWindow.start}-${bestWindow.end})`
        : null,
      cautionWindow: cautionWindow
        ? `${cautionWindow.label} (${cautionWindow.start}-${cautionWindow.end})`
        : null,
      confidence: prediction.confidenceScore,
      luckyNumber: luck.luckyNumber,
      luckyColor: luck.luckyColor,
      luckyColorHex: luck.luckyColorHex,
      predictionSpotlight,
      spotlightWindowLabel: bestWindow?.label?.trim() || null,
      scoreSpread: prediction.meta.scoreSpread,
      focus: prediction.personalization.mostRelevantContext,
      reasoning: {
        summary: [
          {
            type: 'context',
            text: `Your strongest context today is ${prediction.personalization.mostRelevantContext} (${focusPct}% weight).`,
          },
        ],
        focus: bestWindow
          ? [
              {
                type: 'timing',
                text: `${bestWindow.label} is strongest for momentum and clear decisions.`,
              },
            ]
          : [],
        avoid: cautionWindow
          ? [
              {
                type: 'timing',
                text: `${cautionWindow.label} may feel heavier; use low-stakes tasks.`,
              },
            ]
          : [],
        timing: [
          {
            type: 'window-model',
            text: 'Timing score is derived from transit windows, context weighting, and stability spread.',
          },
        ],
      },
      actions: {
        do: prediction.goodTimes.slice(0, 3).map((w, idx) => ({
          id: `do-${idx + 1}`,
          text: `${w.label}: prioritize meaningful work between ${w.start} and ${w.end}.`,
          category: prediction.personalization.mostRelevantContext,
        })),
        avoid: prediction.badTimes.slice(0, 3).map((w, idx) => ({
          id: `avoid-${idx + 1}`,
          text: `${w.label}: avoid emotionally loaded decisions between ${w.start} and ${w.end}.`,
          category: 'stability',
        })),
      },
      moon: {
        phase: moonPhase,
        phaseLabel: phaseMeta.label,
        sign: prediction.meta.lagna,
        illumination: phaseMeta.illumination,
        energy: phaseMeta.energy,
      },
      transits: prediction.transits ?? [],
    };
  }

  private moonPhaseCopySi(phase: string): { label: string; energy: string } {
    switch (phase) {
      case 'new-moon':
        return {
          label: 'නව සඳ',
          energy: 'නැවත අරඹන්නට සුදුසු මෘදු බලයක්. සැලැස්ම් කෙටියෙන් තබන්න.',
        };
      case 'waxing-crescent':
        return {
          label: 'වැඩෙන අරුණ සඳ',
          energy: 'කුඩා පියවරෙන් හොඳට ගොඩ එන්න පුළුවන්.',
        };
      case 'first-quarter':
        return {
          label: 'පළමු කැලැය්ම',
          energy: 'ක්‍රියාමාර්ග බලය උපරිමයට එයි. නැවත නැවත සලකා බලන්නෙන් තොරව තීරණ ගන්න.',
        };
      case 'waxing-gibbous':
        return {
          label: 'වැඩෙන ගිබස් සඳ',
          energy: 'සංවිධානය කර දියුණු කරන්න. ප්‍රකාශයට පෙර සකස් වීම සුදුසුයි.',
        };
      case 'full':
        return {
          label: 'පුර්ණ සඳ',
          energy: 'සංවේදී මොහොතක් — ප්‍රතික්‍රියා කිරීමට පෙර මුලට හැරී අත්පොලොස්පහක් ගන්න.',
        };
      case 'waning-gibbous':
        return {
          label: 'අඩු වන ගිබස් සඳ',
          energy: 'ලබාගත් දේ ඒකාබද්ධ කර නුදුරු කාර්ය අවසන් කරන්න.',
        };
      case 'last-quarter':
        return {
          label: 'අවසන් කැලැය්ම',
          energy: 'අඩු වටිනා බැඳීම් ලිහිල් කර තීරණ පහසු කරන්න.',
        };
      case 'waning-crescent':
      default:
        return {
          label: 'අඩු වන අරුණ සඳ',
          energy: 'නිවුණු සහ විමර්ශන කාලයක්—විවේකය සහ සැලැස්ම් කෙටියෙන්.',
        };
    }
  }

  private siCalendarParts(dateIso: string): { weekday: string; day: number; monthShort: string } {
    const d = new Date(`${dateIso}T12:00:00.000Z`);
    const weekdays = ['ඉරිදා', 'සඳුදා', 'අඟහරුවාදා', 'බදාදා', 'බ්‍රහස්පතින්දා', 'සිකුරාදා', 'සෙනසුරාදා'];
    const months = ['ජන', 'පෙබ', 'මාර්', 'අප්‍රේ', 'මැයි', 'ජූනි', 'ජූලි', 'අගෝ', 'සැප්', 'ඔක්', 'නොවැ', 'දෙසැ'];
    return {
      weekday: weekdays[d.getUTCDay()],
      day: d.getUTCDate(),
      monthShort: months[d.getUTCMonth()],
    };
  }

  private async localizeDailyPayloadSi(
    base: any,
    prediction: DailyPredictionOutput,
  ): Promise<any> {
    const signal = {
      date: prediction.date,
      lagna: prediction.meta.lagna || 'Unknown',
      nakshatra: prediction.meta.nakshatra || 'Unknown',
      bestWindow: base.bestWindow as string | null,
      cautionWindow: base.cautionWindow as string | null,
      focus: prediction.personalization.mostRelevantContext,
      rating: base.rating as 'great' | 'good' | 'mixed' | 'tense',
    };
    const rendered = await this.geminiLanguage.renderDailySinhala(signal, {
      guidance: String(base.guidance ?? ''),
      bestWindow: base.bestWindow ?? null,
      cautionWindow: base.cautionWindow ?? null,
      focus: String(base.focus ?? ''),
      actions: {
        do: Array.isArray(base.actions?.do) ? base.actions.do : [],
        avoid: Array.isArray(base.actions?.avoid) ? base.actions.avoid : [],
      },
    });
    if (!rendered) {
      return this.fallbackSinhala(base, prediction);
    }
    const phaseKey = String(base.moonPhase ?? base.moon?.phase ?? 'waxing-gibbous');
    const siMoon = this.moonPhaseCopySi(phaseKey);
    const cal = this.siCalendarParts(prediction.date);
    return {
      ...base,
      headerLabel: `අද · ${cal.weekday} ${cal.day}`,
      dayLabel: `${cal.weekday} · ${cal.day} ${cal.monthShort}`,
      guidance: rendered.summary,
      bestWindow: rendered.lucky_window || base.bestWindow,
      cautionWindow:
        rendered.stress_window?.trim() ||
        base.cautionWindow,
      reasoning: {
        summary: [{ type: 'main_insight', text: rendered.main_insight }],
        focus: [],
        avoid: [],
        timing: [],
      },
      actions: {
        do: rendered.do.map((text, idx) => ({
          id: `do-si-${idx + 1}`,
          text,
          category: 'overall',
        })),
        avoid: rendered.avoid.map((text, idx) => ({
          id: `avoid-si-${idx + 1}`,
          text,
          category: 'overall',
        })),
      },
      moon: {
        ...(base.moon ?? {}),
        phase: phaseKey,
        phaseLabel: siMoon.label,
        energy: siMoon.energy,
      },
      localized: { lang: 'si', title: rendered.title, warningLevel: rendered.warning_level },
    };
  }

  private fallbackSinhala(base: any, prediction: DailyPredictionOutput): any {
    const phaseKey = String(base.moonPhase ?? base.moon?.phase ?? 'waxing-gibbous');
    const siMoon = this.moonPhaseCopySi(phaseKey);
    const cal = this.siCalendarParts(prediction.date);
    return {
      ...base,
      headerLabel: `අද · ${cal.weekday} ${cal.day}`,
      dayLabel: `${cal.weekday} · ${cal.day} ${cal.monthShort}`,
      guidance:
        'අද දවසේ කාලය සන්සුන්ව තෝරාගත්තොත් හොඳ ප්‍රතිඵල අපේක්ෂා කරන්න පුළුවන්. වැදගත් කාර්ය සඳහා ශක්තියෙන් පිරුණු වේලාවක් තෝරාගෙන, දැඩි තීරණ ලිහිල් කාලයට කල් තබන්න.',
      reasoning: {
        summary: [
          {
            type: 'main_insight',
            text: 'අද වඩාත් ගැලපෙන්නේ සැලසුමකට අනුව සන්සුන්ව වැඩ කරන ආකාරයටයි.',
          },
        ],
        focus: [],
        avoid: [],
        timing: [],
      },
      moon: {
        ...(base.moon ?? {}),
        phase: phaseKey,
        phaseLabel: siMoon.label,
        energy: siMoon.energy,
      },
      localized: { lang: 'si', title: 'දිනපතා මාර්ගෝපදේශය', warningLevel: 'medium' },
      cautionWindow: base.cautionWindow
        ? `${base.cautionWindow} — මෙම කාලයේ බර දැනීමට ඉඩ ඇත; ලිහිල් කාර්ය සහ විවේකය ප්‍රමුඛ කරන්න.`
        : base.cautionWindow,
    };
  }

  private moonPhaseMeta(phase: string): {
    label: string;
    illumination: number;
    energy: string;
  } {
    switch (phase) {
      case 'new-moon':
        return {
          label: 'New Moon',
          illumination: 5,
          energy: 'Low-light reset energy. Keep plans intentional and simple.',
        };
      case 'waxing-crescent':
        return {
          label: 'Waxing Crescent',
          illumination: 22,
          energy: 'Gentle growth energy. Start small and build consistency.',
        };
      case 'first-quarter':
        return {
          label: 'First Quarter',
          illumination: 50,
          energy: 'Action energy rises. Commit and reduce indecision.',
        };
      case 'waxing-gibbous':
        return {
          label: 'Waxing Gibbous',
          illumination: 73,
          energy: 'Refine, organize, and prepare for visible output.',
        };
      case 'full':
        return {
          label: 'Full Moon',
          illumination: 99,
          energy: 'Peak intensity window. Stay grounded before reacting.',
        };
      case 'waning-gibbous':
        return {
          label: 'Waning Gibbous',
          illumination: 76,
          energy: 'Integrate lessons and close loops with clarity.',
        };
      case 'last-quarter':
        return {
          label: 'Last Quarter',
          illumination: 48,
          energy: 'Release low-value commitments and simplify decisions.',
        };
      case 'waning-crescent':
      default:
        return {
          label: 'Waning Crescent',
          illumination: 20,
          energy: 'Recovery and reflection window. Prioritize rest and planning.',
        };
    }
  }

  private deriveRating(
    confidenceScore: number,
    scoreSpread: number,
  ): SubatimeDayRating {
    const normalizedGap = Math.min(1, Math.max(0, scoreSpread / 0.5));
    const composite = confidenceScore * 0.7 + normalizedGap * 0.3;
    if (composite >= 0.8) return 'great';
    if (composite >= 0.68) return 'good';
    if (composite >= 0.54) return 'mixed';
    return 'tense';
  }

  private parseDateOrToday(date?: string): Date {
    if (!date) return this.normalizeDate(new Date());
    const parsed = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) return this.normalizeDate(new Date());
    return this.normalizeDate(parsed);
  }

  private parseMonthOrCurrent(month?: string): { year: number; monthIndex: number } {
    const current = new Date();
    if (!month) {
      return { year: current.getUTCFullYear(), monthIndex: current.getUTCMonth() };
    }
    const match = month.match(/^(\d{4})-(\d{2})$/);
    if (!match) {
      return { year: current.getUTCFullYear(), monthIndex: current.getUTCMonth() };
    }
    const year = Number(match[1]);
    const monthIndex = Math.min(11, Math.max(0, Number(match[2]) - 1));
    return { year, monthIndex };
  }

  private moonPhaseForDate(date: Date): string {
    const baseNewMoon = Date.UTC(2000, 0, 6, 18, 14, 0);
    const synodicDays = 29.530588853;
    const dayMs = 86_400_000;
    const ageDays = ((date.getTime() - baseNewMoon) / dayMs) % synodicDays;
    const normalizedAge = ageDays < 0 ? ageDays + synodicDays : ageDays;
    if (normalizedAge < 1.84566) return 'new-moon';
    if (normalizedAge < 5.53699) return 'waxing-crescent';
    if (normalizedAge < 9.22831) return 'first-quarter';
    if (normalizedAge < 12.91963) return 'waxing-gibbous';
    if (normalizedAge < 16.61096) return 'full';
    if (normalizedAge < 20.30228) return 'waning-gibbous';
    if (normalizedAge < 23.99361) return 'last-quarter';
    if (normalizedAge < 27.68493) return 'waning-crescent';
    return 'new-moon';
  }

  private relativeDayLabel(date: Date, lang: string): string {
    const d = this.normalizeDate(date);
    const today = this.normalizeDate(new Date());
    const diff = Math.round((today.getTime() - d.getTime()) / 86_400_000);
    if (lang === 'si') {
      if (diff === 0) return 'අද';
      if (diff === 1) return 'ඊයේ';
      return `දින ${diff} කට පෙර`;
    }
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return `${diff} days ago`;
  }

  private relativeTimeLabel(date: Date): string {
    const ms = Date.now() - date.getTime();
    const min = Math.floor(ms / 60000);
    if (min < 60) return `${Math.max(1, min)}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    return `${day}d ago`;
  }

  private signElement(sign: string): string {
    const s = sign.toLowerCase();
    if (['aries', 'leo', 'sagittarius'].includes(s)) return 'Fire';
    if (['taurus', 'virgo', 'capricorn'].includes(s)) return 'Earth';
    if (['gemini', 'libra', 'aquarius'].includes(s)) return 'Air';
    return 'Water';
  }

  /** Element for ascendant label (Western English or common Sanskrit spellings). */
  private lagnaElement(lagna: string): string {
    const s = lagna.trim().toLowerCase();
    const ved: Record<string, string> = {
      mesha: 'Fire',
      vrishabha: 'Earth',
      mithuna: 'Air',
      karka: 'Water',
      simha: 'Fire',
      kanya: 'Earth',
      tula: 'Air',
      vrischika: 'Water',
      dhanu: 'Fire',
      makara: 'Earth',
      kumbha: 'Air',
      meena: 'Water',
    };
    if (ved[s]) return ved[s];
    return this.signElement(lagna);
  }

  private clampScore(value: number): number {
    const v = Number.isFinite(value) ? Math.round(value) : 3;
    return Math.max(1, Math.min(5, v));
  }

  private buildExtraPredictions(
    prediction: DailyPredictionOutput,
    input: {
      sleep: number;
      stress: number;
      fatigue: number;
      focusArea: 'overall' | 'career' | 'love' | 'health';
    },
  ): Array<{ title: string; text: string }> {
    const best = prediction.goodTimes[0];
    const caution = prediction.badTimes[0];
    const bestLabel = best
      ? `${best.label} (${best.start}-${best.end})`
      : 'your strongest window';
    const cautionLabel = caution
      ? `${caution.label} (${caution.start}-${caution.end})`
      : 'the lower-energy period';
    const out: Array<{ title: string; text: string }> = [];

    if (input.sleep <= 2 || input.fatigue >= 4) {
      out.push({
        title: 'Energy pacing',
        text: `Protect your energy early, then use ${bestLabel} for one meaningful task. Keep ${cautionLabel} for lighter work.`,
      });
    } else {
      out.push({
        title: 'Momentum window',
        text: `Your current state supports momentum. Push deeper work into ${bestLabel} and reserve ${cautionLabel} for routine tasks.`,
      });
    }

    if (input.stress >= 4) {
      out.push({
        title: 'Stress guardrail',
        text: `Shorten decision loops today. During ${cautionLabel}, avoid emotionally heavy commitments or difficult conversations.`,
      });
    } else {
      out.push({
        title: 'Communication flow',
        text: `Social tone looks steadier. Important conversations are best scheduled around ${bestLabel}.`,
      });
    }

    const focusTextByArea: Record<string, string> = {
      career: `Career focus: block one focused sprint during ${bestLabel} and batch meetings around lower-intensity slots.`,
      love: `Connection focus: keep communication direct and calm, especially near ${bestLabel}.`,
      health: `Health focus: prioritize hydration, movement, and earlier recovery around ${cautionLabel}.`,
      overall: `General focus: choose one high-impact action in ${bestLabel} and one deliberate reset in ${cautionLabel}.`,
    };
    out.push({
      title: 'Focus area guidance',
      text: focusTextByArea[input.focusArea] ?? focusTextByArea.overall,
    });

    return out;
  }

  private windowFromClock(clock: string): WindowLabel {
    const hour = Number(clock.split(':')[0] ?? 0);
    if (hour >= 6 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 22) return 'evening';
    return 'night';
  }

  /** UTC calendar lunar phase for “today” — same astronomy helpers as personalized plans; not tied to a user chart. */
  getPublicSkyToday(lang?: string) {
    const date = this.normalizeDate(new Date());
    const moonPhase = this.moonPhaseForDate(date);
    const meta = this.moonPhaseMeta(moonPhase);
    const normalizedLang = (lang ?? 'en').toLowerCase().trim();
    let phaseLabel = meta.label;
    let energy = meta.energy;
    if (normalizedLang === 'si') {
      const si = this.moonPhaseCopySi(moonPhase);
      phaseLabel = si.label;
      energy = si.energy;
    }
    const dateUtc = date.toISOString().slice(0, 10);
    return okResponse(
      {
        dateUtc,
        moonPhase,
        phaseLabel,
        illumination: meta.illumination,
        energy,
      },
      'Public sky context',
    );
  }

  private normalizeDate(date: Date): Date {
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
  }
}
