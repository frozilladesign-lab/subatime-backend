import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { DailyPredictionService } from '../prediction/services/daily-prediction.service';
import { FirebasePushService, isUnregisteredFcmError } from '../push/firebase-push.service';

type Block = { start: string; end: string; label: string };

/**
 * Runs every hour and sends a prediction-based push to every user who has:
 *  - A device token registered
 *  - A birth profile (so predictions exist)
 *  - Not opted out of learning-tip notifications
 *
 * Content is derived from today's daily prediction: the quality of the
 * current time block drives the title/body — peak hora vs caution vs neutral.
 */
@Injectable()
export class HourlyPredictionPushService {
  private readonly logger = new Logger(HourlyPredictionPushService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dailyPrediction: DailyPredictionService,
    private readonly push: FirebasePushService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sendHourlyPredictionPush(): Promise<void> {
    if (process.env.DISABLE_HOURLY_PREDICTION_PUSH === 'true') return;
    if (!this.push.isReady()) {
      this.logger.warn('HourlyPredictionPush: Firebase not ready — skipping.');
      return;
    }

    const now = new Date();
    const currentHour = now.getUTCHours();

    // Only send between 6 AM and 10 PM UTC (adjust for typical SL offset +5:30)
    const slHour = (currentHour + 5) % 24; // rough local hour for Sri Lanka
    if (slHour < 6 || slHour > 22) return;

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
        deviceTokens: { select: { token: true, platform: true } },
      },
    });

    this.logger.log(`HourlyPredictionPush: processing ${users.length} users at ${now.toISOString()}`);
    let sent = 0;
    let skipped = 0;

    for (const user of users) {
      try {
        // Respect mute preferences
        const prefs = user.preferences as Record<string, unknown> | null;
        const notifs = prefs?.['notifications'] as Record<string, unknown> | undefined;
        if (notifs?.['muteLearningTips'] === true) { skipped++; continue; }

        // Get or generate today's prediction
        const output = await this.dailyPrediction.generateForUser(user.id, now);
        if (!output) { skipped++; continue; }

        // Determine user's local hour using their birth profile timezone
        const tz = user.birthProfile?.timezone ?? 'Asia/Colombo';
        const localHour = this.localHourInZone(now, tz);
        if (localHour < 6 || localHour > 22) { skipped++; continue; }

        const { title, body } = this.buildContent({
          goodTimes: output.goodTimes,
          badTimes: output.badTimes,
          localHour,
          rating: this.ratingFromConfidence(output.confidenceScore),
          summary: output.summary,
          userName: user.name ?? 'Friend',
        });

        const tokens = user.deviceTokens.map(t => t.token);
        const result = await this.push.sendEachToTokens({
          tokens,
          title,
          body,
          data: { type: 'guide', alertType: 'HOURLY_PREDICTION' },
        });

        sent += result.successCount;

        // Clean up expired tokens
        for (let i = 0; i < result.responses.length; i++) {
          const r = result.responses[i];
          if (!r.success && isUnregisteredFcmError((r.error as { code?: string })?.code)) {
            await this.prisma.userDeviceToken.deleteMany({
              where: { userId: user.id, token: tokens[i] },
            }).catch(() => {});
          }
        }
      } catch (e) {
        this.logger.error(`HourlyPredictionPush: error for user ${user.id}: ${String(e)}`);
      }
    }

    this.logger.log(`HourlyPredictionPush: sent=${sent} skipped=${skipped}`);
  }

  // ── Content builder ────────────────────────────────────────────────────

  private buildContent(params: {
    goodTimes: Block[];
    badTimes: Block[];
    localHour: number;
    rating: string;
    summary: string;
    userName: string;
  }): { title: string; body: string } {
    const { goodTimes, badTimes, localHour, rating, summary } = params;

    const inGood    = goodTimes.some(b => this.hourInBlock(localHour, b));
    const inBad     = badTimes.some(b => this.hourInBlock(localHour, b));
    const hLabel    = this.hourLabel(localHour);

    // Peak hora
    if (inGood) {
      return {
        title: `✨ ${hLabel} — Peak hora`,
        body: this.clip(summary, 80) || 'Excellent energy window. Move forward with clarity.',
      };
    }

    // Caution hora
    if (inBad) {
      return {
        title: `⚠️ ${hLabel} — Go gently`,
        body: 'Low-energy window. Pause, reflect, avoid major decisions.',
      };
    }

    // Neutral — time-of-day + rating based
    return {
      title: `· ${hLabel}`,
      body: this.neutralBody(localHour, rating),
    };
  }

  private neutralBody(h: number, rating: string): string {
    if (h < 9)  return rating === 'great' ? 'Strong morning. Set your top intention now.' : 'Ease into the morning with intention.';
    if (h < 12) return rating === 'great' ? 'Good flow. Keep moving forward.' : 'Steady morning energy. One task at a time.';
    if (h < 14) return rating === 'tense' ? 'Rest if you can. Midday is heavy today.' : 'Midday check — are you on track?';
    if (h < 17) return 'Afternoon. Creative energy rises now.';
    if (h < 20) return rating === 'great' ? 'Strong evening. Good time for connection.' : 'Wind down and reflect on the day.';
    return 'Night hora. Rest and restore.';
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private hourInBlock(hour: number, block: Block): boolean {
    const start = this.parseHour(block.start);
    const end   = this.parseHour(block.end);
    if (start == null || end == null) return false;
    return hour >= start && hour < end;
  }

  private parseHour(s: string): number | null {
    const m = /^(\d{1,2}):/.exec(s.trim());
    return m ? parseInt(m[1], 10) : null;
  }

  private hourLabel(h: number): string {
    const suffix = h < 12 ? 'AM' : 'PM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:00 ${suffix}`;
  }

  private clip(s: string, n: number): string {
    if (!s) return '';
    return s.length > n ? `${s.slice(0, n - 1).trim()}…` : s;
  }

  private ratingFromConfidence(score: number): string {
    if (score >= 0.8) return 'great';
    if (score >= 0.65) return 'good';
    if (score >= 0.5) return 'mixed';
    return 'tense';
  }

  /** Convert UTC Date to hour in a named IANA timezone. */
  private localHourInZone(utc: Date, tz: string): number {
    try {
      const str = utc.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false });
      const h = parseInt(str, 10);
      return Number.isFinite(h) ? h % 24 : utc.getUTCHours();
    } catch {
      return utc.getUTCHours();
    }
  }
}
