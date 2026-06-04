import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { DailyPredictionService } from '../prediction/services/daily-prediction.service';
import { FirebasePushService, isUnregisteredFcmError } from '../push/firebase-push.service';

/** The 8 engine-generated time blocks — must match buildTimeBlocks() in daily-prediction.service.ts */
const ENGINE_BLOCKS = [
  { start: '06:00', end: '08:00', label: 'Early Morning' },
  { start: '08:00', end: '10:00', label: 'Morning Focus' },
  { start: '10:00', end: '12:00', label: 'Late Morning' },
  { start: '12:00', end: '14:00', label: 'Noon Window' },
  { start: '14:00', end: '16:00', label: 'Afternoon Push' },
  { start: '16:00', end: '18:00', label: 'Evening Start' },
  { start: '18:00', end: '20:00', label: 'Evening Prime' },
  { start: '20:00', end: '22:00', label: 'Night Calm' },
] as const;

type Block = { start: string; end: string; label: string };

/**
 * Fires at the START of each engine time block in the user's local timezone.
 * Content is derived directly from the prediction engine's scoring:
 *   ✨  goodTimes[0]  — best scored block  → peak hora message
 *   ✦   goodTimes[1]  — second best        → strong window message
 *   ⚠️  badTimes[0]   — worst scored block → caution message
 *   ·   badTimes[1]   — second worst       → gentle nudge
 *   ·   neutral blocks                     → subtle time-of-day line
 */
@Injectable()
export class HourlyPredictionPushService {
  private readonly logger = new Logger(HourlyPredictionPushService.name);
  /** Dedup: `userId:blockStart:dateISO` so each block fires once per day. */
  private readonly _sent = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly dailyPrediction: DailyPredictionService,
    private readonly push: FirebasePushService,
  ) {}

  /** Run every 5 min so we catch each block's :00 start within a short window. */
  @Cron('*/5 * * * *')
  async sendBlockNotifications(): Promise<void> {
    if (process.env.DISABLE_HOURLY_PREDICTION_PUSH === 'true') return;
    if (!this.push.isReady()) return;

    const now = new Date();

    const users = await this.prisma.user.findMany({
      where: { deviceTokens: { some: {} }, birthProfile: { isNot: null } },
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
        const prefs   = user.preferences as Record<string, unknown> | null;
        const notifs  = prefs?.['notifications'] as Record<string, unknown> | undefined;
        if (notifs?.['muteLearningTips'] === true) continue;

        const tz        = user.birthProfile?.timezone ?? 'Asia/Colombo';
        const localNow  = this.localTime(now, tz);          // e.g. { h:8, m:3 }
        const block     = this.blockStartingNow(localNow);  // block whose start is ≤ now < start+5

        if (!block) continue;

        const dateKey  = this.localDateKey(now, tz);
        const dedupKey = `${user.id}:${block.start}:${dateKey}`;
        if (this._sent.has(dedupKey)) continue;

        // Get / generate today's prediction
        const output = await this.dailyPrediction.generateForUser(user.id, now);
        if (!output) continue;

        const content = this.buildContent({
          block,
          goodTimes: output.goodTimes as Block[],
          badTimes:  output.badTimes  as Block[],
          summary:   output.summary,
          name:      user.name ?? 'Friend',
        });

        const tokens = user.deviceTokens.map(t => t.token);
        const result = await this.push.sendEachToTokens({
          tokens,
          title: content.title,
          body:  content.body,
          data:  { type: 'guide', alertType: 'BLOCK_START', blockLabel: block.label },
        });

        if (result.successCount > 0) {
          sent += result.successCount;
          this._sent.add(dedupKey);
          this.logger.log(`Block notification [${block.label}] → user ${user.id}`);
        }

        // Remove dead tokens
        result.responses.forEach((r, i) => {
          if (!r.success && isUnregisteredFcmError((r.error as { code?: string })?.code)) {
            this.prisma.userDeviceToken.deleteMany({ where: { userId: user.id, token: tokens[i] } }).catch(() => {});
          }
        });
      } catch (e) {
        this.logger.error(`BlockPush user ${user.id}: ${String(e)}`);
      }
    }

    if (sent > 0) this.logger.log(`BlockPush: ${sent} sent`);
  }

  // ── Content — driven by engine scores ─────────────────────────────────────

  private buildContent(p: {
    block:     Block;
    goodTimes: Block[];
    badTimes:  Block[];
    summary:   string;
    name:      string;
  }): { title: string; body: string } {
    const { block, goodTimes, badTimes, summary, name } = p;

    const isPeak1   = this.sameBlock(block, goodTimes[0]);
    const isPeak2   = this.sameBlock(block, goodTimes[1]);
    const isCaution = this.sameBlock(block, badTimes[0]);
    const isWeak    = this.sameBlock(block, badTimes[1]);

    if (isPeak1) {
      return {
        title: `✨ ${block.label} — Peak hora`,
        body:  this.clip(summary, 90) || 'Your best energy window is now. Move forward with clarity.',
      };
    }
    if (isPeak2) {
      return {
        title: `✦ ${block.label} — Strong window`,
        body:  'Good energy. Focused work flows well right now.',
      };
    }
    if (isCaution) {
      return {
        title: `⚠️ ${block.label} — Low-energy hora`,
        body:  'Rest, reflect, or handle routine tasks. Avoid big decisions.',
      };
    }
    if (isWeak) {
      return {
        title: `· ${block.label} — Go gently`,
        body:  'Softer energy. Good for light tasks and rest.',
      };
    }

    // Neutral block — time-of-day guidance
    return {
      title: `· ${block.label}`,
      body:  this.neutralBody(block.start),
    };
  }

  private neutralBody(start: string): string {
    return ({
      '06:00': 'Early morning. Set your intention before the day starts.',
      '08:00': 'Morning in motion. Tackle your most important task first.',
      '10:00': 'Late morning momentum. Keep the focus going.',
      '12:00': 'Midday check-in. Are you on track?',
      '14:00': 'Afternoon shift. Creative energy often rises now.',
      '16:00': 'Evening approaches. Wrap up open tasks.',
      '18:00': 'Evening prime. Good time for connection and reflection.',
      '20:00': 'Night window. Wind down and restore.',
    } as Record<string, string>)[start] ?? 'Stay present this hora.';
  }

  // ── Timing helpers ────────────────────────────────────────────────────────

  /** Returns the block whose start time falls within the current 5-min window. */
  private blockStartingNow(local: { h: number; m: number }): Block | null {
    const nowMin = local.h * 60 + local.m;
    for (const b of ENGINE_BLOCKS) {
      const [bh, bm] = b.start.split(':').map(Number);
      const blockMin = bh * 60 + bm;
      // Fire within 5-min window of block start
      if (nowMin >= blockMin && nowMin < blockMin + 5) return b;
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

  private sameBlock(a: Block, b?: Block): boolean {
    return !!b && a.start === b.start;
  }

  private clip(s: string, n: number): string {
    return s && s.length > n ? `${s.slice(0, n - 1).trim()}…` : s;
  }
}
