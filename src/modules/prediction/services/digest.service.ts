import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import {
  buildMonthlyDigest,
  buildWeeklyDigest,
  type DigestDayInput,
  type MonthlyDigest,
  type WeeklyDigest,
} from '@subatime/jyotisha-engine';
import { PrismaService } from '../../../database/prisma.service';
import { resolveNotificationSettings } from '../../user/notification-settings';
import {
  buildDigestSchedule,
  type DigestSlot,
} from '../../notifications/digest-schedule';
import { DailyPredictionService } from './daily-prediction.service';
import { DigestAiService } from './digest-ai/digest-ai.service';
import { buildChartHash, buildFocusHash } from './digest-ai/digest-ai.hash';
import {
  DIGEST_AI_PROMPT_VERSION,
  type DigestContentProvenance,
  type DigestLocale,
  type DigestRating,
  type MonthlyFactPack,
  type WeeklyDayAiContent,
  type WeeklyFactPack,
} from './digest-ai/digest-ai.types';

/** Everything that decides whether a stored pack can be reused or must be regenerated. */
interface DigestIdentity {
  locale: DigestLocale;
  focusHash: string;
  chartHash: string;
  promptVersion: string;
}

/** One kind of digest exposed to the client + scheduler. */
export interface DigestOutput {
  kind: 'weekly' | 'monthly';
  periodKey: string;
  /** Local send time 'HH:mm' (quiet/spacing adjusted) and the send day (yyyy-MM-dd). */
  sendAtLocal: string;
  sendDate: string;
  /** UTC instant for FCM scheduling. */
  sendAtUtc: string;
  timezone: string;
  /** Engine digest (localized copy + audit), AI-enriched when Gemini is available. */
  digest: WeeklyDigest | MonthlyDigest;
  /** Notification category key (weekly | monthly). */
  category: 'weekly' | 'monthly';
  /** AI-first content provenance (provider, status, hashes) for audit. */
  content?: DigestContentProvenance;
  /** Weekly only: per-day AI copy the daily activation overlay reads. Empty on fallback. */
  dailyContent?: WeeklyDayAiContent[];
}

/** Result of resolving today's AI daily copy from the stored weekly pack (read-only). */
export interface DailyOverlayResult {
  /** Where today's copy should come from. */
  source: 'weekly_pack' | 'deterministic';
  /** Today's AI copy when `source === 'weekly_pack'`; absent on the deterministic fallback. */
  content?: WeeklyDayAiContent | null;
  /** Why the deterministic fallback was chosen (audit). */
  reason?: string;
  /** Provenance of the weekly pack consulted, when one existed. */
  provenance?: DigestContentProvenance & { periodKey: string };
}

export interface UserDigests {
  weekly: DigestOutput | null;
  monthly: DigestOutput | null;
  /** Why a digest was not scheduled (dev audit): category_disabled | frequency_off | already_sent. */
  dropped: { kind: string; periodKey: string; reason: string }[];
}

const WEEKLY_DEFAULT_HM = '19:00';
const MONTHLY_DEFAULT_HM = '07:30';

@Injectable()
export class DigestService {
  private readonly logger = new Logger(DigestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dailyPrediction: DailyPredictionService,
    private readonly digestAi: DigestAiService,
  ) {}

  /**
   * Current weekly + monthly digests for a user. Generates + persists (once per ISO
   * week / calendar month) on first request, then reuses the stored row — the unique
   * (userId, kind, periodKey) makes duplicates impossible. Honors settings (frequency,
   * category toggles, quiet hours) and the Sunday-19:00 / 1st-07:30 timing with spacing.
   */
  async getUserDigests(userId: string, nowUtc: Date = new Date()): Promise<UserDigests> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        language: true,
        preferences: true,
        birthProfile: {
          select: { timezone: true, onboardingIntent: true, lagna: true, nakshatra: true },
        },
      },
    });
    if (!user?.birthProfile) return { weekly: null, monthly: null, dropped: [] };

    const tz = (user.birthProfile.timezone ?? '').trim() || 'UTC';
    const lagna = (user.birthProfile.lagna ?? '').trim();
    const settings = resolveNotificationSettings(
      user.preferences,
      user.birthProfile.onboardingIntent,
    ).settings;

    // Identity that drives AI reuse vs regeneration: language, focus/tone selections, and the
    // derived chart. A change to any of these makes the stored pack stale for the same period.
    const identity = this.buildIdentity(
      user.language,
      settings.focusAreas,
      settings.tones,
      lagna,
      user.birthProfile.nakshatra,
    );

    const nowLocal = DateTime.fromJSDate(nowUtc).setZone(tz);
    if (!nowLocal.isValid) return { weekly: null, monthly: null, dropped: [] };

    const weeklySlot = this.weeklySlot(nowLocal);
    const monthlySlot = this.monthlySlot(nowLocal);

    // Rows already generated for these periods (dedup / reuse).
    const existingRows = await this.prisma.userDigest.findMany({
      where: {
        userId,
        OR: [
          { kind: 'weekly', periodKey: weeklySlot.periodKey },
          { kind: 'monthly', periodKey: monthlySlot.periodKey },
        ],
      },
    });
    const existingWeekly = existingRows.find((r) => r.kind === 'weekly');
    const existingMonthly = existingRows.find((r) => r.kind === 'monthly');

    // Any OTHER period keys already stored count as "already sent" for the rules.
    const alreadySent = new Set(existingRows.map((r) => r.periodKey));

    // Apply the scheduling rules to decide which digests are eligible + final send times.
    const schedule = buildDigestSchedule({
      weekly: weeklySlot,
      monthly: monthlySlot,
      settings: {
        categories: settings.categories,
        frequency: settings.frequency,
        quietHours: settings.quietHours,
      },
      // Don't treat the current period as already-sent (we want to (re)expose it); only
      // prior periods block. Since slots use the CURRENT period keys, pass an empty set
      // here and rely on the persisted row for reuse below.
      alreadySent: new Set([...alreadySent].filter(
        (k) => k !== weeklySlot.periodKey && k !== monthlySlot.periodKey,
      )),
    });

    const weekly = await this.resolveKind(
      'weekly', weeklySlot, schedule, existingWeekly, userId, tz, lagna, settings.focusAreas, settings.tones, identity,
    );
    const monthly = await this.resolveKind(
      'monthly', monthlySlot, schedule, existingMonthly, userId, tz, lagna, settings.focusAreas, settings.tones, identity,
    );

    return { weekly, monthly, dropped: schedule.dropped };
  }

  /**
   * Daily activation bridge (READ-ONLY). Resolves today's AI copy from the already-stored weekly
   * pack for the Guide screen + notifications. It NEVER calls Gemini — that only happens in the
   * weekly generation flow. When no fresh pack covers today (missing, stale identity, template
   * fallback with no per-day copy, or Gemini previously failed) it returns `deterministic` with a
   * reason so the caller shows the engine template copy immediately, and — if AI is enabled — it
   * fires a non-blocking weekly (re)generation so the next read can overlay. Never blocks, never
   * blanks the screen.
   */
  async getWeeklyDailyOverlay(userId: string, dateIso: string): Promise<DailyOverlayResult> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        language: true,
        preferences: true,
        birthProfile: {
          select: { timezone: true, onboardingIntent: true, lagna: true, nakshatra: true },
        },
      },
    });
    if (!user?.birthProfile) return { source: 'deterministic', reason: 'no_birth_profile' };

    const tz = (user.birthProfile.timezone ?? '').trim() || 'UTC';
    const lagna = (user.birthProfile.lagna ?? '').trim();
    const settings = resolveNotificationSettings(
      user.preferences,
      user.birthProfile.onboardingIntent,
    ).settings;
    const identity = this.buildIdentity(
      user.language,
      settings.focusAreas,
      settings.tones,
      lagna,
      user.birthProfile.nakshatra,
    );

    const periodKey = this.weekPeriodKeyFor(dateIso, tz);
    const row = await this.prisma.userDigest.findUnique({
      where: { userId_kind_periodKey: { userId, kind: 'weekly', periodKey } },
    });

    if (!row) {
      this.triggerRegenerationIfEnabled(userId);
      return { source: 'deterministic', reason: 'no_weekly_pack' };
    }
    if (!this.identityMatches(row, identity)) {
      this.triggerRegenerationIfEnabled(userId);
      return {
        source: 'deterministic',
        reason: 'stale_pack',
        provenance: this.rowProvenance(row, periodKey),
      };
    }

    const payload = row.payload as unknown as DigestOutput;
    const today = payload?.dailyContent?.find((d) => d.date === dateIso) ?? null;
    if (!today) {
      // Pack is current but has no per-day copy for today (e.g. template fallback). No regen —
      // the pack is already fresh; a missing day means Gemini didn't produce usable per-day copy.
      return {
        source: 'deterministic',
        reason: payload?.dailyContent?.length ? 'day_not_in_pack' : 'no_daily_content',
        provenance: this.rowProvenance(row, periodKey),
      };
    }

    return { source: 'weekly_pack', content: today, provenance: this.rowProvenance(row, periodKey) };
  }

  /** Build the content identity used for reuse/regeneration decisions. */
  private buildIdentity(
    language: unknown,
    focusAreas: string[],
    tones: string[],
    lagna: string,
    nakshatra: string | null | undefined,
  ): DigestIdentity {
    const locale: DigestLocale = language === 'en' ? 'en' : 'si';
    return {
      locale,
      focusHash: buildFocusHash({ focusAreas, tones, locale }),
      chartHash: buildChartHash({ lagna, nakshatra }),
      promptVersion: DIGEST_AI_PROMPT_VERSION,
    };
  }

  private rowProvenance(
    row: {
      aiProvider: string | null;
      contentStatus: string | null;
      promptVersion: string | null;
      locale: string | null;
      focusHash: string | null;
      chartHash: string | null;
    },
    periodKey: string,
  ): DigestContentProvenance & { periodKey: string } {
    return {
      provider: row.aiProvider === 'gemini' ? 'gemini' : 'template',
      status: (row.contentStatus as DigestContentProvenance['status']) ?? 'fallback',
      promptVersion: row.promptVersion ?? '',
      locale: row.locale === 'en' ? 'en' : 'si',
      focusHash: row.focusHash ?? '',
      chartHash: row.chartHash ?? '',
      periodKey,
    };
  }

  /**
   * Fire-and-forget weekly (re)generation. Only when Gemini is configured — with no key the
   * pack would just be template again, so there is nothing to gain by regenerating. Errors are
   * swallowed: this must never affect the Guide read.
   */
  private triggerRegenerationIfEnabled(userId: string): void {
    if (!this.digestAi.isEnabled()) return;
    void this.getUserDigests(userId).catch((e) => {
      this.logger.warn(`Background weekly regen failed for ${userId}: ${String(e)}`);
    });
  }

  /** ISO week period key ("2026-W28") for a plain date, interpreted in the user's timezone. */
  private weekPeriodKeyFor(dateIso: string, tz: string): string {
    const dt = DateTime.fromISO(dateIso, { zone: tz || 'UTC' });
    const anchor = dt.isValid ? dt : DateTime.fromISO(dateIso, { zone: 'UTC' });
    return `${anchor.weekYear}-W${String(anchor.weekNumber).padStart(2, '0')}`;
  }

  private async resolveKind(
    kind: 'weekly' | 'monthly',
    slot: DigestSlot,
    schedule: ReturnType<typeof buildDigestSchedule>,
    existingRow:
      | {
          periodKey: string;
          sendAt: Date;
          timezone: string;
          payload: Prisma.JsonValue;
          locale: string | null;
          focusHash: string | null;
          chartHash: string | null;
          promptVersion: string | null;
        }
      | undefined,
    userId: string,
    tz: string,
    lagna: string,
    focusAreas: string[],
    tones: string[],
    identity: DigestIdentity,
  ): Promise<DigestOutput | null> {
    const planned = schedule.scheduled.find((s) => s.kind === kind);
    if (!planned) return null; // dropped by category/frequency

    // Reuse a persisted digest ONLY when it is for this exact period AND its content identity
    // (language, focus/tones, chart, prompt version) still matches. A change to any of those
    // makes the stored copy stale and triggers regeneration below — this is what makes the AI
    // pack regenerate on focus/language/tone/birth-detail changes without daily calls.
    if (existingRow && existingRow.periodKey === slot.periodKey && this.identityMatches(existingRow, identity)) {
      const stored = existingRow.payload as unknown as DigestOutput;
      if (stored && stored.digest) return stored;
    }

    const built = await this.buildDigestForKind(userId, kind, slot, lagna, focusAreas, tones, identity);
    if (!built) return null;

    const sendAtUtc = this.localToUtc(planned.date, planned.sendAt, tz);
    const output: DigestOutput = {
      kind,
      periodKey: slot.periodKey,
      sendAtLocal: planned.sendAt,
      sendDate: planned.date,
      sendAtUtc: sendAtUtc.toISOString(),
      timezone: tz,
      digest: built.digest,
      category: kind,
      content: built.content,
      ...(built.dailyContent ? { dailyContent: built.dailyContent } : {}),
    };

    // Persist (unique userId+kind+periodKey → duplicate-proof). Ignore races.
    try {
      const row = {
        sendAt: sendAtUtc,
        timezone: tz,
        payload: output as unknown as Prisma.InputJsonValue,
        aiProvider: built.content.provider,
        contentStatus: built.content.status,
        promptVersion: built.content.promptVersion,
        locale: built.content.locale,
        focusHash: built.content.focusHash,
        chartHash: built.content.chartHash,
      };
      await this.prisma.userDigest.upsert({
        where: { userId_kind_periodKey: { userId, kind, periodKey: slot.periodKey } },
        create: { userId, kind, periodKey: slot.periodKey, ...row },
        update: row,
      });
    } catch (e) {
      this.logger.warn(`Digest upsert failed (${kind} ${slot.periodKey}) for ${userId}: ${String(e)}`);
    }
    return output;
  }

  /** True when a stored row's content identity still matches the current one (reuse-safe). */
  private identityMatches(
    row: { locale: string | null; focusHash: string | null; chartHash: string | null; promptVersion: string | null },
    identity: DigestIdentity,
  ): boolean {
    return (
      row.promptVersion === identity.promptVersion &&
      row.locale === identity.locale &&
      row.focusHash === identity.focusHash &&
      row.chartHash === identity.chartHash
    );
  }

  private async buildDigestForKind(
    userId: string,
    kind: 'weekly' | 'monthly',
    slot: DigestSlot,
    lagna: string,
    focusAreas: string[],
    tones: string[],
    identity: DigestIdentity,
  ): Promise<{
    digest: WeeklyDigest | MonthlyDigest;
    content: DigestContentProvenance;
    dailyContent?: WeeklyDayAiContent[];
  } | null> {
    const dates = kind === 'weekly'
      ? this.weekDates(slot.date)
      : this.monthDates(slot.date);
    const signals = await this.dailyPrediction.getDigestDaySignals(userId, dates);
    const days: DigestDayInput[] = signals.map((d) => ({
      date: d.date,
      dominantTheme: d.dominantTheme as DigestDayInput['dominantTheme'],
      themeScores: d.themeScores,
      confidenceScore: d.confidenceScore,
    }));
    if (days.length === 0) return null;

    // Deterministic engine digest = the FACTS + the template fallback copy.
    if (kind === 'weekly') {
      const base = buildWeeklyDigest({ weekStart: dates[0], days, lagna, focusAreas, tones });
      const pack: WeeklyFactPack = {
        lang: identity.locale,
        tones,
        focusAreas,
        profile: { lagna },
        dominantTheme: base.dominantTheme,
        weekStart: base.weekStart,
        weekEnd: base.weekEnd,
        bestDay: { date: base.bestDay.date, theme: base.dominantTheme },
        cautionDay: { date: base.cautionDay.date },
        reasons: base.audit.reasons,
        days: signals.map((s) => ({
          date: s.date,
          theme: s.dominantTheme as WeeklyFactPack['days'][number]['theme'],
          rating: this.ratingFromConfidence(s.confidenceScore),
        })),
      };
      const enriched = await this.digestAi.enrichWeekly(base, pack, identity.locale);
      return {
        digest: enriched.digest,
        content: this.provenance(enriched, identity),
        dailyContent: enriched.dailyContent,
      };
    }

    const base = buildMonthlyDigest({ monthStart: dates[0], days, lagna, focusAreas, tones });
    const pack: MonthlyFactPack = {
      lang: identity.locale,
      tones,
      focusAreas,
      profile: { lagna },
      dominantTheme: base.dominantTheme,
      monthStart: base.monthStart,
      bestPeriod: base.bestPeriod,
      cautionPeriod: base.cautionPeriod,
      standoutDates: base.standoutDates.map((d) => d.date),
      reasons: base.audit.reasons,
    };
    const enriched = await this.digestAi.enrichMonthly(base, pack, identity.locale);
    return { digest: enriched.digest, content: this.provenance(enriched, identity) };
  }

  /** Coarse day rating from the engine confidence score (never AI-decided). */
  private ratingFromConfidence(confidence: number): DigestRating {
    if (confidence >= 0.72) return 'good';
    if (confidence <= 0.5) return 'caution';
    return 'mixed';
  }

  private provenance(
    enriched: { provider: DigestContentProvenance['provider']; status: DigestContentProvenance['status']; promptVersion: string },
    identity: DigestIdentity,
  ): DigestContentProvenance {
    return {
      provider: enriched.provider,
      status: enriched.status,
      promptVersion: enriched.promptVersion,
      locale: identity.locale,
      focusHash: identity.focusHash,
      chartHash: identity.chartHash,
    };
  }

  // ── Period + time helpers (timezone-aware) ─────────────────────────────────

  /** This ISO week's slot: send on the coming/most-recent Sunday 19:00 local. */
  private weeklySlot(nowLocal: DateTime): DigestSlot {
    // ISO week: Monday=1 … Sunday=7. The digest fires on Sunday of the current ISO week.
    const sunday = nowLocal.set({ weekday: 7 }).startOf('day');
    const periodKey = `${sunday.weekYear}-W${String(sunday.weekNumber).padStart(2, '0')}`;
    return { kind: 'weekly', periodKey, date: sunday.toFormat('yyyy-MM-dd'), hm: WEEKLY_DEFAULT_HM };
  }

  /** This month's slot: send on the 1st 07:30 local. */
  private monthlySlot(nowLocal: DateTime): DigestSlot {
    const first = nowLocal.startOf('month');
    const periodKey = first.toFormat('yyyy-MM');
    return { kind: 'monthly', periodKey, date: first.toFormat('yyyy-MM-dd'), hm: MONTHLY_DEFAULT_HM };
  }

  /** The 7 dates (Mon–Sun) of the ISO week containing `sundayDate`. */
  private weekDates(sundayDate: string): string[] {
    const sunday = DateTime.fromISO(sundayDate);
    const monday = sunday.set({ weekday: 1 });
    return Array.from({ length: 7 }, (_, i) => monday.plus({ days: i }).toFormat('yyyy-MM-dd'));
  }

  /** All calendar dates of the month containing `firstDate`. */
  private monthDates(firstDate: string): string[] {
    const first = DateTime.fromISO(firstDate).startOf('month');
    const n = first.daysInMonth ?? 30;
    return Array.from({ length: n }, (_, i) => first.plus({ days: i }).toFormat('yyyy-MM-dd'));
  }

  private localToUtc(date: string, hm: string, tz: string): Date {
    const dt = DateTime.fromISO(`${date}T${hm}:00`, { zone: tz || 'UTC' });
    return dt.isValid ? dt.toUTC().toJSDate() : new Date(`${date}T${hm}:00.000Z`);
  }
}
