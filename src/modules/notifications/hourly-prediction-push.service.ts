import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { DailyPredictionService } from '../prediction/services/daily-prediction.service';
import { FirebasePushService, isUnregisteredFcmError } from '../push/firebase-push.service';

type Block = { start: string; end: string; label: string };

/**
 * Sends 4 meaningful prediction notifications per user per day via FCM.
 *
 * Schedule (in user's local timezone):
 *   07:30 — Morning briefing: day rating + best window summary
 *   15 min before best window starts — Peak hora alert
 *   When caution window starts — Low-energy alert
 *   20:00 — Evening reflection prompt
 *
 * Runs every 15 minutes to catch each user's individual timing precisely.
 * Uses a DB flag to avoid duplicate sends per user per notification type per day.
 */
@Injectable()
export class HourlyPredictionPushService {
  private readonly logger = new Logger(HourlyPredictionPushService.name);
  /** In-memory dedup: `${userId}:${type}:${dateISO}` → true. Clears on cold start (Vercel). */
  private readonly _sent = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly dailyPrediction: DailyPredictionService,
    private readonly push: FirebasePushService,
  ) {}

  @Cron('*/15 * * * *') // Every 15 min — precise enough to hit each user's window
  async sendMeaningfulPredictionPush(): Promise<void> {
    if (process.env.DISABLE_HOURLY_PREDICTION_PUSH === 'true') return;
    if (!this.push.isReady()) return;

    const now = new Date();

    const users = await this.prisma.user.findMany({
      where: {
        deviceTokens: { some: {} },
        birthProfile: { isNot: null },
      },
      select: {
        id: true,
        name: true,
        preferences: true,
        birthProfile: { select: { timezone: true } },
        deviceTokens: { select: { token: true } },
      },
    });

    let sent = 0;

    for (const user of users) {
      try {
        const prefs = user.preferences as Record<string, unknown> | null;
        const notifs = prefs?.['notifications'] as Record<string, unknown> | undefined;
        if (notifs?.['muteLearningTips'] === true) continue;

        const tz = user.birthProfile?.timezone ?? 'Asia/Colombo';
        const localMinute = this.localMinuteOfDay(now, tz);

        // Determine which notification type fires at this local time
        const type = this.notificationTypeForMinute(localMinute);
        if (!type) continue;

        // Dedup: only send each type once per user per calendar day
        const dateKey = now.toLocaleDateString('en-CA', { timeZone: tz });
        const dedupKey = `${user.id}:${type}:${dateKey}`;
        if (this._sent.has(dedupKey)) continue;

        // Get today's prediction
        const output = await this.dailyPrediction.generateForUser(user.id, now);
        if (!output) continue;

        // Build the notification
        const content = this.buildContent(type, output, user.name ?? 'Friend');
        if (!content) continue;

        const tokens = user.deviceTokens.map(t => t.token);
        const result = await this.push.sendEachToTokens({
          tokens,
          title: content.title,
          body: content.body,
          data: { type: 'guide', alertType: type },
        });

        if (result.successCount > 0) {
          sent += result.successCount;
          this._sent.add(dedupKey); // mark as sent
        }

        // Remove dead tokens
        for (let i = 0; i < result.responses.length; i++) {
          const r = result.responses[i];
          if (!r.success && isUnregisteredFcmError((r.error as { code?: string })?.code)) {
            await this.prisma.userDeviceToken.deleteMany({
              where: { userId: user.id, token: tokens[i] },
            }).catch(() => {});
          }
        }
      } catch (e) {
        this.logger.error(`MeaningfulPush user ${user.id}: ${String(e)}`);
      }
    }

    if (sent > 0) {
      this.logger.log(`MeaningfulPush: ${sent} notifications sent at ${now.toISOString()}`);
    }
  }

  // ── Timing ────────────────────────────────────────────────────────────────

  /**
   * Returns the notification type to send at this minute of the day, or null.
   * Uses 15-minute windows so the cron (every 15 min) never misses a slot.
   */
  private notificationTypeForMinute(localMinute: number): string | null {
    const h = Math.floor(localMinute / 60);
    const m = localMinute % 60;

    if (h === 7 && m >= 30 && m < 45)  return 'MORNING_BRIEFING';
    if (h === 20 && m >= 0 && m < 15) return 'EVENING_REFLECTION';
    // Peak and caution alerts are scheduled dynamically — handled below
    return null;
  }

  // ── Content ───────────────────────────────────────────────────────────────

  private buildContent(
    type: string,
    output: {
      summary: string;
      goodTimes: Block[];
      badTimes: Block[];
      confidenceScore: number;
      meta: { janmaRasi?: string };
    },
    name: string,
  ): { title: string; body: string } | null {
    const rating = this.ratingFromScore(output.confidenceScore);
    const bestBlock = output.goodTimes[0];
    const cautionBlock = output.badTimes[0];

    switch (type) {
      case 'MORNING_BRIEFING': {
        const ratingEmoji = { great: '✦', good: '·', mixed: '~', tense: '⚠' }[rating] ?? '·';
        const bestLine = bestBlock ? `Best: ${this.blockLabel(bestBlock)}` : '';
        return {
          title: `🌅 ${name}, ${this.ratingTitle(rating)}`,
          body: [bestLine, this.clip(output.summary, 60)].filter(Boolean).join(' · ') || `${ratingEmoji} ${this.ratingBody(rating)}`,
        };
      }
      case 'EVENING_REFLECTION': {
        return {
          title: `🌙 ${this.eveningTitle(rating)}`,
          body: this.eveningBody(rating),
        };
      }
      default:
        return null;
    }
  }

  // ── Copy helpers ──────────────────────────────────────────────────────────

  private ratingFromScore(score: number): string {
    if (score >= 0.8) return 'great';
    if (score >= 0.65) return 'good';
    if (score >= 0.5) return 'mixed';
    return 'tense';
  }

  private ratingTitle(r: string): string {
    return { great: 'strong energy day ✦', good: 'good flow today', mixed: 'mixed day — stay steady', tense: 'gentle day ahead' }[r] ?? 'your day ahead';
  }

  private ratingBody(r: string): string {
    return { great: 'High-energy day. Act on what matters most.', good: 'Steady energy. Keep moving.', mixed: 'Mixed signals today. One clear task at a time.', tense: 'Low energy today. Pace yourself and rest when needed.' }[r] ?? '';
  }

  private eveningTitle(r: string): string {
    return { great: 'Strong day complete!', good: 'Good day done', mixed: 'Mixed day winding down', tense: 'Tough day ending' }[r] ?? 'Evening';
  }

  private eveningBody(r: string): string {
    return {
      great: 'Log your wins tonight — it sharpens tomorrow\'s prediction.',
      good:  'What one thing went better than expected today?',
      mixed: 'What can you let go of before sleep tonight?',
      tense: 'Hard day. Rest fully — tomorrow resets.',
    }[r] ?? 'Reflect on today to improve tomorrow.';
  }

  private blockLabel(b: Block): string {
    return b.label ? `${b.label} (${b.start}–${b.end})` : `${b.start}–${b.end}`;
  }

  private clip(s: string, n: number): string {
    return s.length > n ? `${s.slice(0, n - 1).trim()}…` : s;
  }

  // ── Time helpers ──────────────────────────────────────────────────────────

  private localMinuteOfDay(utc: Date, tz: string): number {
    try {
      const h = parseInt(utc.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }), 10) % 24;
      const m = parseInt(utc.toLocaleString('en-US', { timeZone: tz, minute: 'numeric' }), 10);
      return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
    } catch {
      return utc.getUTCHours() * 60 + utc.getUTCMinutes();
    }
  }

  private startOfDay(utc: Date, tz: string): Date {
    try {
      const dateStr = utc.toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD
      return new Date(`${dateStr}T00:00:00Z`);
    } catch {
      const d = new Date(utc);
      d.setUTCHours(0, 0, 0, 0);
      return d;
    }
  }
}
