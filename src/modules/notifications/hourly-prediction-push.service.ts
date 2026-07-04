import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NotificationType, Prisma } from '@prisma/client';
import type { BlockNotificationCandidate, NotificationCandidates } from '@subatime/jyotisha-engine';
import { PrismaService } from '../../database/prisma.service';
import { DailyPredictionService } from '../prediction/services/daily-prediction.service';
import { FirebasePushService, isUnregisteredFcmError } from '../push/firebase-push.service';
import { anyLocalScheduleFresh } from './local-schedule-freshness';

type Block = { start: string; end: string; label: string };

const ENGINE_BLOCKS: Block[] = [
  { start: '06:00', end: '08:00', label: 'Early Morning' },
  { start: '08:00', end: '10:00', label: 'Morning Focus' },
  { start: '10:00', end: '12:00', label: 'Late Morning' },
  { start: '12:00', end: '14:00', label: 'Noon Window' },
  { start: '14:00', end: '16:00', label: 'Afternoon Push' },
  { start: '16:00', end: '18:00', label: 'Evening Start' },
  { start: '18:00', end: '20:00', label: 'Evening Prime' },
  { start: '20:00', end: '22:00', label: 'Night Calm' },
];

/**
 * Block-start push notifications.
 *
 * Delivery-only: this service decides WHEN a push goes out (block boundary in the user's
 * timezone, dedup, mute preferences, token hygiene). The WHAT — title/body wording — comes
 * exclusively from the stored `DailyPrediction.notificationCandidates` built by the engine's
 * `buildNotificationCandidates`, so FCM pushes, local notifications, and the Guide tab can
 * never disagree about a block's message.
 *
 * FCM here is a FALLBACK: the app schedules the same block candidates as local
 * notifications and reports that state (`UserLocalNotificationSchedule`). When any of the
 * user's devices has a fresh local schedule, this push is skipped
 * (`skipped_local_schedule_fresh`) so recently active users never get local + FCM
 * duplicates; stale/missing/denied-permission users still get the FCM fallback
 * (`sent_fcm_fallback`).
 *
 * Dedup is PERSISTENT (Phase 4): before sending, a `NotificationJob` row with type
 * `prediction_block_fallback` is created under the unique key
 * (userId, date, candidateId, type) — the candidate id encodes category, window, and
 * kind. A unique-constraint hit means another instance/tick/restart already handled it
 * (`skipped_already_sent_or_queued`). Rows are created as `sent` (delivered inline right
 * after) so the NotificationJob dispatcher — which only polls `pending` — never
 * double-sends them; FCM failures downgrade the row to `failed` with error metadata,
 * and there is deliberately NO automatic retry of the same candidate.
 * No delivery correctness depends on process memory.
 */
@Injectable()
export class HourlyPredictionPushService {
  private readonly logger = new Logger(HourlyPredictionPushService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dailyPrediction: DailyPredictionService,
    private readonly push: FirebasePushService,
  ) {}

  @Cron('*/5 * * * *')
  async sendBlockNotifications(now: Date = new Date()): Promise<void> {
    if (process.env.DISABLE_HOURLY_PREDICTION_PUSH === 'true') return;
    if (!this.push.isReady()) return;

    const users = await this.prisma.user.findMany({
      where: { deviceTokens: { some: {} }, birthProfile: { isNot: null } },
      select: {
        id: true,
        name: true,
        preferences: true,
        birthProfile: { select: { timezone: true } },
        deviceTokens: { select: { token: true } },
        localNotificationSchedules: {
          select: {
            lastLocalScheduleAt: true,
            localScheduleThroughDate: true,
            deviceTimezone: true,
            notificationPermissionStatus: true,
          },
        },
      },
    });

    let sent = 0;

    for (const user of users) {
      try {
        const prefs  = user.preferences as Record<string, unknown> | null;
        const notifs = prefs?.['notifications'] as Record<string, unknown> | undefined;
        if (notifs?.['muteLearningTips'] === true) continue;

        const tz    = user.birthProfile?.timezone ?? 'Asia/Colombo';
        const local = this.localTime(now, tz);
        const block = this.blockStartingNow(local);
        if (!block) continue;

        const dateKey = this.localDateKey(now, tz);

        // Local-first dedup: a device with a fresh local schedule already shows this
        // block's notification locally — skip the FCM copy before touching the DB.
        if (anyLocalScheduleFresh(user.localNotificationSchedules, now)) {
          this.logger.log(
            `[${block.label}] ${user.name ?? user.id.slice(0, 8)}: skipped_local_schedule_fresh`,
          );
          continue;
        }

        const candidate = await this.blockCandidateFor(user.id, now, tz, block.start);
        if (!candidate) continue;

        // Persistent dedup: claim the (userId, date, candidateId, type) key BEFORE
        // sending. Safe across restarts, duplicate cron ticks, and multiple instances.
        const job = await this.claimBlockFallbackJob(user.id, dateKey, candidate, now);
        if (!job) {
          this.logger.log(
            `[${block.label}] ${user.name ?? user.id.slice(0, 8)}: skipped_already_sent_or_queued`,
          );
          continue;
        }

        const tokens = user.deviceTokens.map(t => t.token);
        const result = await this.push.sendEachToTokens({
          tokens,
          title: candidate.title,
          body:  candidate.body,
          data: {
            type: 'feed',
            alertType: 'BLOCK_START',
            blockLabel: block.label,
            planDate: dateKey,
            candidateId: candidate.id,
            deepLink: candidate.deepLink,
          },
        });

        if (result.successCount > 0) {
          sent += result.successCount;
          this.logger.log(`[${block.label}] ${user.name ?? user.id.slice(0,8)}: sent_fcm_fallback "${candidate.title}" | "${candidate.body.slice(0,50)}"`);
        } else {
          // Keep the dedup row (no accidental resends) but record the failure.
          await this.prisma.notificationJob.update({
            where: { id: job.id },
            data: {
              status: 'failed',
              payload: {
                title: candidate.title,
                body: candidate.body,
                candidateId: candidate.id,
                error: 'fcm_all_tokens_failed',
              },
            },
          }).catch(() => {});
        }

        result.responses.forEach((r, i) => {
          if (!r.success && isUnregisteredFcmError((r.error as { code?: string })?.code)) {
            this.prisma.userDeviceToken.deleteMany({ where: { userId: user.id, token: tokens[i] } }).catch(() => {});
          }
        });
      } catch (e) {
        this.logger.error(`BlockPush user ${user.id}: ${String(e)}`);
      }
    }

    if (sent > 0) this.logger.log(`BlockPush total: ${sent} sent`);
  }

  /**
   * Stored engine-built candidate for the block starting now. Regenerates the prediction when
   * the stored row is missing or predates the notification-candidates refactor — never
   * composes copy locally.
   */
  private async blockCandidateFor(
    userId: string,
    now: Date,
    tz: string,
    blockStart: string,
  ): Promise<BlockNotificationCandidate | null> {
    const storedPred = await this.prisma.dailyPrediction.findUnique({
      where: { userId_date: { userId, date: this.startOfDay(now, tz) } },
      select: { notificationCandidates: true },
    });

    let candidates = this.parseCandidates(storedPred?.notificationCandidates);
    if (!candidates) {
      // generateForUser treats rows without candidates as stale and rebuilds them.
      const generated = await this.dailyPrediction.generateForUser(userId, now);
      candidates = generated?.notificationCandidates ?? null;
    }
    if (!candidates) return null;

    const candidate = candidates.blocks.find((b) => b.startTime === blockStart) ?? null;
    if (!candidate) return null;

    // Phase B: honor the stored notification PLAN (frequency caps, category toggles,
    // quiet hours, Rahu Kāla). Only planned candidates are delivered; legacy rows
    // without a plan keep the pre-plan behavior.
    const plan = (candidates as unknown as { plan?: { scheduled?: { candidateId?: string }[] } }).plan;
    if (plan?.scheduled && !plan.scheduled.some((s) => s.candidateId === candidate.id)) {
      return null;
    }
    return candidate;
  }

  /**
   * Claims the persistent dedup key by inserting the NotificationJob row (status `sent`,
   * delivered inline immediately after — the dispatcher only polls `pending`). Returns
   * null when the unique constraint reports the key as already claimed.
   */
  private async claimBlockFallbackJob(
    userId: string,
    dateKey: string,
    candidate: BlockNotificationCandidate,
    now: Date,
  ): Promise<{ id: string } | null> {
    try {
      return await this.prisma.notificationJob.create({
        data: {
          userId,
          type: NotificationType.prediction_block_fallback,
          scheduledAt: now,
          status: 'sent',
          date: new Date(`${dateKey}T00:00:00.000Z`),
          candidateId: candidate.id,
          payload: {
            title: candidate.title,
            body: candidate.body,
            candidateId: candidate.id,
            category: candidate.category ?? null,
            importance: candidate.importance ?? null,
            blockStart: candidate.startTime,
          },
        },
        select: { id: true },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return null;
      }
      throw e;
    }
  }

  private parseCandidates(raw: unknown): NotificationCandidates | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const o = raw as Record<string, unknown>;
    if (!Array.isArray(o.blocks)) return null;
    return raw as NotificationCandidates;
  }

  // ── Utility ────────────────────────────────────────────────────────────────

  private blockStartingNow(local: { h: number; m: number }): Block | null {
    const nowMin = local.h * 60 + local.m;
    for (const b of ENGINE_BLOCKS) {
      const [bh, bm] = b.start.split(':').map(Number);
      if (nowMin >= bh * 60 + bm && nowMin < bh * 60 + bm + 5) return b;
    }
    return null;
  }

  private localTime(utc: Date, tz: string): { h: number; m: number } {
    try {
      const h = parseInt(utc.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }), 10) % 24;
      const m = parseInt(utc.toLocaleString('en-US', { timeZone: tz, minute: 'numeric' }), 10);
      return { h: isFinite(h) ? h : 0, m: isFinite(m) ? m : 0 };
    } catch { return { h: utc.getUTCHours(), m: utc.getUTCMinutes() }; }
  }

  private localDateKey(utc: Date, tz: string): string {
    try { return utc.toLocaleDateString('en-CA', { timeZone: tz }); }
    catch { return utc.toISOString().slice(0, 10); }
  }

  private startOfDay(utc: Date, tz: string): Date {
    return new Date(`${this.localDateKey(utc, tz)}T00:00:00Z`);
  }
}
