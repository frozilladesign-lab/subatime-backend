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
  /** Engine digest (localized copy + audit). */
  digest: WeeklyDigest | MonthlyDigest;
  /** Notification category key (weekly | monthly). */
  category: 'weekly' | 'monthly';
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
        preferences: true,
        birthProfile: { select: { timezone: true, onboardingIntent: true, lagna: true } },
      },
    });
    if (!user?.birthProfile) return { weekly: null, monthly: null, dropped: [] };

    const tz = (user.birthProfile.timezone ?? '').trim() || 'UTC';
    const lagna = (user.birthProfile.lagna ?? '').trim();
    const settings = resolveNotificationSettings(
      user.preferences,
      user.birthProfile.onboardingIntent,
    ).settings;

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
      'weekly', weeklySlot, schedule, existingWeekly, userId, tz, lagna, settings.focusAreas, settings.tones,
    );
    const monthly = await this.resolveKind(
      'monthly', monthlySlot, schedule, existingMonthly, userId, tz, lagna, settings.focusAreas, settings.tones,
    );

    return { weekly, monthly, dropped: schedule.dropped };
  }

  private async resolveKind(
    kind: 'weekly' | 'monthly',
    slot: DigestSlot,
    schedule: ReturnType<typeof buildDigestSchedule>,
    existingRow: { periodKey: string; sendAt: Date; timezone: string; payload: Prisma.JsonValue } | undefined,
    userId: string,
    tz: string,
    lagna: string,
    focusAreas: string[],
    tones: string[],
  ): Promise<DigestOutput | null> {
    const planned = schedule.scheduled.find((s) => s.kind === kind);
    if (!planned) return null; // dropped by category/frequency

    // Reuse a persisted digest for this exact period (generated once).
    if (existingRow && existingRow.periodKey === slot.periodKey) {
      const stored = existingRow.payload as unknown as DigestOutput;
      if (stored && stored.digest) return stored;
    }

    const digest = await this.buildDigestForKind(userId, kind, slot, lagna, focusAreas, tones);
    if (!digest) return null;

    const sendAtUtc = this.localToUtc(planned.date, planned.sendAt, tz);
    const output: DigestOutput = {
      kind,
      periodKey: slot.periodKey,
      sendAtLocal: planned.sendAt,
      sendDate: planned.date,
      sendAtUtc: sendAtUtc.toISOString(),
      timezone: tz,
      digest,
      category: kind,
    };

    // Persist (unique userId+kind+periodKey → duplicate-proof). Ignore races.
    try {
      await this.prisma.userDigest.upsert({
        where: { userId_kind_periodKey: { userId, kind, periodKey: slot.periodKey } },
        create: {
          userId, kind, periodKey: slot.periodKey,
          sendAt: sendAtUtc, timezone: tz,
          payload: output as unknown as Prisma.InputJsonValue,
        },
        update: {
          sendAt: sendAtUtc,
          payload: output as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (e) {
      this.logger.warn(`Digest upsert failed (${kind} ${slot.periodKey}) for ${userId}: ${String(e)}`);
    }
    return output;
  }

  private async buildDigestForKind(
    userId: string,
    kind: 'weekly' | 'monthly',
    slot: DigestSlot,
    lagna: string,
    focusAreas: string[],
    tones: string[],
  ): Promise<WeeklyDigest | MonthlyDigest | null> {
    const dates = kind === 'weekly'
      ? this.weekDates(slot.date)
      : this.monthDates(slot.date);
    const days: DigestDayInput[] = (await this.dailyPrediction.getDigestDaySignals(userId, dates))
      .map((d) => ({
        date: d.date,
        dominantTheme: d.dominantTheme as DigestDayInput['dominantTheme'],
        themeScores: d.themeScores,
        confidenceScore: d.confidenceScore,
      }));
    if (days.length === 0) return null;

    return kind === 'weekly'
      ? buildWeeklyDigest({ weekStart: dates[0], days, lagna, focusAreas, tones })
      : buildMonthlyDigest({ monthStart: dates[0], days, lagna, focusAreas, tones });
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
