import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

const LEAD_MS = 8 * 60 * 1000;
const MIN_LEAD_AHEAD_MS = 90 * 1000;
const MAX_SCHEDULE_HORIZON_MS = 36 * 60 * 60 * 1000;

type DayRating = 'great' | 'good' | 'mixed' | 'tense';

/**
 * Schedules one push per user per day: shortly before the first "good" prediction window
 * (from daily prediction JSON), when the day is rated strong enough. Uses `NotificationType.event`
 * and FCM `type: guide` so the client opens the Guide tab.
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
            goodTimes: true,
            confidenceScore: true,
            scoreSpread: true,
          },
        });
        if (!pred) continue;

        const rating = this.deriveRating(pred.confidenceScore, pred.scoreSpread ?? 0);
        const strongEnough =
          rating === 'great' || (rating === 'good' && pred.confidenceScore >= 0.74);
        if (!strongEnough) continue;

        const first = this.firstGoodTimeBlock(pred.goodTimes);
        if (!first?.start) continue;

        const dateIso = todayUtc.toISOString().slice(0, 10);
        const startMs = this.utcHmOnDateMs(dateIso, first.start);
        if (startMs == null) continue;

        const alertAt = new Date(startMs - LEAD_MS);
        const tAlert = alertAt.getTime();
        if (tAlert <= now + MIN_LEAD_AHEAD_MS) continue;
        if (tAlert > now + MAX_SCHEDULE_HORIZON_MS) continue;
        if (startMs <= now) continue;

        const label = (first.label ?? 'Strong window').trim() || 'Strong window';
        const title = '✨ Your strongest window soon';
        const body = `${label} opens soon — tap for today’s line and timing.`;
        const fcmData: Record<string, string> = {
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
          type: 'guide',
          predictionId: pred.id,
          planDate: dateIso,
          slot: 'best_window',
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

        if (existing == null) {
          await this.prisma.notificationJob.create({
            data: {
              userId: u.id,
              type: NotificationType.event,
              scheduledAt: alertAt,
              status: 'pending',
              payload: { title, body, fcmData } as Prisma.InputJsonValue,
            },
          });
        } else {
          await this.prisma.notificationJob.update({
            where: whereUnique,
            data: {
              status: 'pending',
              payload: { title, body, fcmData } as Prisma.InputJsonValue,
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

  private firstGoodTimeBlock(raw: unknown): { label?: string; start?: string } | null {
    if (!Array.isArray(raw) || raw.length === 0) return null;
    const g = raw[0];
    if (!g || typeof g !== 'object') return null;
    const o = g as Record<string, unknown>;
    const start = typeof o.start === 'string' ? o.start.trim() : '';
    const label = typeof o.label === 'string' ? o.label.trim() : '';
    if (!start) return null;
    return { label: label || undefined, start };
  }

  private utcHmOnDateMs(dateIso: string, hm: string): number | null {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
    if (!m) return null;
    const hh = Math.min(23, Math.max(0, parseInt(m[1], 10)));
    const mm = Math.min(59, Math.max(0, parseInt(m[2], 10)));
    const d = new Date(
      `${dateIso}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00.000Z`,
    );
    const t = d.getTime();
    return Number.isFinite(t) ? t : null;
  }
}
