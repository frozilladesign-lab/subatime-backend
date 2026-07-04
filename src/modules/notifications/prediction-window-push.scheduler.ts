import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationType, Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import type { NotificationCandidates } from '@subatime/jyotisha-engine';
import { PrismaService } from '../../database/prisma.service';

const MIN_LEAD_AHEAD_MS = 90 * 1000;
const MAX_SCHEDULE_HORIZON_MS = 36 * 60 * 60 * 1000;

type DayRating = 'great' | 'good' | 'mixed' | 'tense';

/**
 * Schedules one push per user per day shortly before the first "good" prediction window,
 * when the day is rated strong enough. Uses `NotificationType.event` and FCM `type: guide`
 * so the client opens the Guide tab.
 *
 * Delivery-only: whether/when to send is decided here (rating gate, lead time, horizon);
 * the wording and send-at offset come from the stored engine-built
 * `DailyPrediction.notificationCandidates.bestWindow` — never composed locally.
 */
@Injectable()
export class PredictionWindowPushSchedulerService {
  private readonly logger = new Logger(PredictionWindowPushSchedulerService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async scheduleBestWindowAlerts(): Promise<void> {
    if (process.env.DISABLE_PREDICTION_WINDOW_SCHEDULER === 'true') {
      return;
    }

    const now = Date.now();
    let jobsTouched = 0;
    let usersConsidered = 0;

    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);

    const rows = await this.prisma.user.findMany({
      where: {
        deviceTokens: { some: {} },
        birthProfile: { isNot: null },
      },
      select: {
        id: true,
        preferences: true,
      },
    });

    for (const u of rows) {
      try {
        if (!this.userWantsPredictionWindowAlerts(u.preferences)) continue;

        const pred = await this.prisma.dailyPrediction.findUnique({
          where: { userId_date: { userId: u.id, date: todayUtc } },
          select: {
            id: true,
            confidenceScore: true,
            scoreSpread: true,
            notificationCandidates: true,
          },
        });
        if (!pred) continue;

        const rating = this.deriveRating(pred.confidenceScore, pred.scoreSpread ?? 0);
        const strongEnough =
          rating === 'great' || (rating === 'good' && pred.confidenceScore >= 0.74);
        if (!strongEnough) continue;

        const candidates = this.parseCandidates(pred.notificationCandidates);
        const bestWindow = candidates?.bestWindow;
        if (!bestWindow) continue;

        const block = candidates.blocks.find((b) => b.id === bestWindow.blockId);
        const startMs = this.localHmToUtcMs(candidates.date, block?.startTime, candidates.timezone);
        const alertMs = this.localHmToUtcMs(candidates.date, bestWindow.sendAt, candidates.timezone);
        if (startMs == null || alertMs == null) continue;

        const alertAt = new Date(alertMs);
        if (alertMs <= now + MIN_LEAD_AHEAD_MS) continue;
        if (alertMs > now + MAX_SCHEDULE_HORIZON_MS) continue;
        if (startMs <= now) continue;

        const fcmData: Record<string, string> = {
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
          type: 'guide',
          predictionId: pred.id,
          planDate: candidates.date,
          slot: 'best_window',
          deepLink: bestWindow.deepLink,
        };

        const whereUnique = {
          userId_type_scheduledAt: {
            userId: u.id,
            type: NotificationType.event,
            scheduledAt: alertAt,
          },
        };

        const existing = await this.prisma.notificationJob.findUnique({ where: whereUnique });
        if (existing?.status === 'sent') continue;

        const payload = { title: bestWindow.title, body: bestWindow.body, fcmData };
        if (existing == null) {
          await this.prisma.notificationJob.create({
            data: {
              userId: u.id,
              type: NotificationType.event,
              scheduledAt: alertAt,
              status: 'pending',
              payload,
            },
          });
        } else {
          await this.prisma.notificationJob.update({
            where: whereUnique,
            data: {
              status: 'pending',
              payload,
            },
          });
        }
        jobsTouched += 1;
        usersConsidered += 1;
      } catch (e) {
        this.logger.warn(`Prediction window push: skipped user ${u.id}: ${String(e)}`);
      }
    }

    if (jobsTouched > 0) {
      this.logger.log(
        `Prediction-window scheduler: touched ${jobsTouched} job(s) across ${usersConsidered} user(s).`,
      );
    }
  }

  private parseCandidates(raw: Prisma.JsonValue | null): NotificationCandidates | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const o = raw as Record<string, unknown>;
    if (!Array.isArray(o.blocks)) return null;
    return raw as unknown as NotificationCandidates;
  }

  private userWantsPredictionWindowAlerts(prefs: Prisma.JsonValue): boolean {
    if (prefs == null || typeof prefs !== 'object' || Array.isArray(prefs)) return true;
    const o = prefs as Record<string, unknown>;
    if (o['predictionWindowAlerts'] === false) return false;
    const n = o['notifications'];
    if (n != null && typeof n === 'object' && !Array.isArray(n)) {
      const nr = n as Record<string, unknown>;
      if (nr['predictionWindowAlerts'] === false) return false;
    }
    return true;
  }

  private deriveRating(confidenceScore: number, scoreSpread: number): DayRating {
    const normalizedGap = Math.min(1, Math.max(0, scoreSpread / 0.5));
    const composite = confidenceScore * 0.7 + normalizedGap * 0.3;
    if (composite >= 0.8) return 'great';
    if (composite >= 0.68) return 'good';
    if (composite >= 0.54) return 'mixed';
    return 'tense';
  }

  /**
   * 'HH:mm' local wall-clock on `dateIso` in `timezone` → UTC epoch ms. Candidate times are
   * local to the user's timezone (previously this scheduler treated them as UTC — pushes for
   * non-UTC users fired hours off).
   */
  private localHmToUtcMs(dateIso: string, hm: string | undefined, timezone: string): number | null {
    if (!hm) return null;
    const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
    if (!m) return null;
    const dt = DateTime.fromISO(
      `${dateIso}T${m[1].padStart(2, '0')}:${m[2]}:00`,
      { zone: timezone || 'UTC' },
    );
    if (!dt.isValid) return null;
    return dt.toUTC().toMillis();
  }
}
