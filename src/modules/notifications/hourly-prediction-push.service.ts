import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { DailyPredictionService } from '../prediction/services/daily-prediction.service';
import { FirebasePushService, isUnregisteredFcmError } from '../push/firebase-push.service';

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
 * Fires at the START of each engine time block in the user's local timezone.
 * Content is built purely from the prediction engine output — no external AI.
 * Scales to any number of users with zero per-user API cost.
 */
@Injectable()
export class HourlyPredictionPushService {
  private readonly logger = new Logger(HourlyPredictionPushService.name);
  private readonly _sent = new Set<string>(); // userId:blockStart:dateISO

  constructor(
    private readonly prisma: PrismaService,
    private readonly dailyPrediction: DailyPredictionService,
    private readonly push: FirebasePushService,
  ) {}

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
        const prefs  = user.preferences as Record<string, unknown> | null;
        const notifs = prefs?.['notifications'] as Record<string, unknown> | undefined;
        if (notifs?.['muteLearningTips'] === true) continue;

        const tz    = user.birthProfile?.timezone ?? 'Asia/Colombo';
        const local = this.localTime(now, tz);
        const block = this.blockStartingNow(local);
        if (!block) continue;

        const dateKey  = this.localDateKey(now, tz);
        const dedupKey = `${user.id}:${block.start}:${dateKey}`;
        if (this._sent.has(dedupKey)) continue;

        // Get today's prediction
        const output = await this.dailyPrediction.generateForUser(user.id, now);
        if (!output) continue;

        const goodTimes = output.goodTimes as Block[];
        const badTimes  = output.badTimes  as Block[];

        const isPeak    = goodTimes.some(b => b.start === block.start);
        const isPeak2   = goodTimes[1]?.start === block.start;
        const isCaution = badTimes.some(b => b.start === block.start);

        // Pull do/avoid from the stored prediction payload
        const stored = await this.prisma.dailyPrediction.findUnique({
          where: { userId_date: { userId: user.id, date: this.startOfDay(now, tz) } },
          select: { goodTimes: true, badTimes: true, summary: true },
        });

        const content = this.buildContent({
          block, isPeak, isPeak2, isCaution,
          summary: output.summary,
          lagna: String(output.meta.lagna ?? ''),
          nakshatra: String(output.meta.nakshatra ?? ''),
          context: output.personalization.mostRelevantContext,
          confidence: output.confidenceScore,
        });

        const tokens = user.deviceTokens.map(t => t.token);
        const result = await this.push.sendEachToTokens({
          tokens,
          title: content.title,
          body:  content.body,
          data: { type: 'feed', alertType: 'BLOCK_START', blockLabel: block.label, planDate: dateKey },
        });

        if (result.successCount > 0) {
          sent += result.successCount;
          this._sent.add(dedupKey);
          this.logger.log(`[${block.label}] ${user.name ?? user.id.slice(0,8)}: "${content.title}"`);
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

    if (sent > 0) this.logger.log(`BlockPush: ${sent} sent`);
  }

  // ── Content — pure prediction engine data, no AI ─────────────────────────

  private buildContent(p: {
    block: Block;
    isPeak: boolean; isPeak2: boolean; isCaution: boolean;
    summary: string;
    lagna: string; nakshatra: string; context: string; confidence: number;
  }): { title: string; body: string } {
    const rating = this.ratingFromScore(p.confidence);
    const nakSign = this.nakshatraSign(p.nakshatra); // Moon sign from nakshatra
    const lagnaEmoji = this.lagnaEmoji(p.lagna);

    // ── Peak hora — best scored block ──────────────────────────────────────
    if (p.isPeak) {
      const actionLine = this.actionFromContext(p.context, rating, true);
      return {
        title: `${lagnaEmoji} ${p.block.label} — ✨ Peak hora`,
        body:  actionLine,
      };
    }

    // ── Second-best block ──────────────────────────────────────────────────
    if (p.isPeak2) {
      return {
        title: `✦ ${p.block.label} — Strong window`,
        body:  this.contextLine(p.context, p.block.start, rating),
      };
    }

    // ── Caution hora — worst scored block ─────────────────────────────────
    if (p.isCaution) {
      const avoidLine = this.actionFromContext(p.context, rating, false);
      return {
        title: `⚠️ ${p.block.label} — Low energy`,
        body:  avoidLine,
      };
    }

    // ── Neutral — time-of-day + rating guidance ────────────────────────────
    return {
      title: `· ${p.block.label}`,
      body:  this.neutralLine(p.block.start, rating, p.context),
    };
  }

  // ── Copy tables — prediction engine data as notification copy ─────────────

  private actionFromContext(context: string, rating: string, isDo: boolean): string {
    const lines: Record<string, Record<string, [string, string]>> = {
      career: {
        great:  ['Lead the meeting. Your presence is at its sharpest now.', 'Skip the risky pitch. Prepare it instead.'],
        good:   ['Move the most important work item forward now.', 'Stick to known tasks. Avoid new commitments.'],
        mixed:  ['One focused task only — no multitasking.', 'Postpone decisions that need full clarity.'],
        tense:  ['Protect your energy. Finish, don\'t start.', 'Delay negotiations. Low confidence window.'],
      },
      love: {
        great:  ['Reach out to someone who matters. Connection flows now.', 'Avoid difficult conversations — wait for a better time.'],
        good:   ['Express appreciation. Small gestures land well.', 'Don\'t push for answers. Let things unfold.'],
        mixed:  ['Listen more than you speak in relationships now.', 'Avoid making promises you\'re unsure about.'],
        tense:  ['Keep heart matters gentle today. Rest together.', 'Avoid heavy emotional conversations now.'],
      },
      health: {
        great:  ['Move your body. High physical energy — use it.', 'Avoid overexertion. Rest is progress too.'],
        good:   ['Consistent routine works best right now.', 'Don\'t skip recovery time today.'],
        mixed:  ['Light activity only. Mixed signals from the body.', 'Avoid stimulants. Energy is uneven today.'],
        tense:  ['Rest is the most healing act right now.', 'Avoid intense workouts. Body needs recovery.'],
      },
      overall: {
        great:  ['Best energy of the day is here. Act on what matters most.', 'Save complex decisions for later.'],
        good:   ['Steady progress. Take one clear step forward.', 'Avoid spreading attention. One thing at a time.'],
        mixed:  ['Grounded action over speed. Quality over quantity.', 'Let ambiguous situations breathe.'],
        tense:  ['Patience. Low energy — protect what you have.', 'Avoid new commitments. Hold steady.'],
      },
    };
    const ctx = lines[context] ?? lines['overall'];
    const pair = ctx[rating] ?? ctx['good'];
    return isDo ? pair[0] : pair[1];
  }

  private contextLine(context: string, start: string, rating: string): string {
    const hour = parseInt(start, 10);
    if (hour < 12) return `Strong ${context} energy this morning. Keep moving.`;
    if (hour < 16) return `${rating === 'great' ? 'Momentum is building' : 'Stay focused'} — ${context} window is open.`;
    return `${context === 'love' ? 'Connection flows' : 'Good flow'} in the ${hour < 18 ? 'late afternoon' : 'evening'}.`;
  }

  private neutralLine(start: string, rating: string, context: string): string {
    const lines: Record<string, string> = {
      '06:00': `${rating === 'tense' ? 'Ease in slowly.' : 'Set your intention for the day.'}`,
      '08:00': `${rating === 'great' ? 'First energy, best work.' : 'Tackle your most important task now.'}`,
      '10:00': `${context === 'career' ? 'Keep the work momentum going.' : 'Late morning — stay with what matters.'}`,
      '12:00': `${rating === 'tense' ? 'Rest if you can. Midday is heavy.' : 'Midday check — are you on track?'}`,
      '14:00': `${rating === 'mixed' ? 'Steady the afternoon.' : 'Creative energy rises now.'}`,
      '16:00': `${context === 'love' ? 'Good time to reconnect.' : 'Wrap up open tasks before evening.'}`,
      '18:00': `${rating === 'great' ? 'Strong evening. Good for connection.' : 'Wind down and reflect.'}`,
      '20:00': `${rating === 'tense' ? 'Rest fully. Tomorrow resets.' : 'Night window. Restore and prepare.'}`,
    };
    return lines[start] ?? 'Stay present this hora.';
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private ratingFromScore(score: number): string {
    if (score >= 0.8) return 'great';
    if (score >= 0.65) return 'good';
    if (score >= 0.5) return 'mixed';
    return 'tense';
  }

  private lagnaEmoji(lagna: string): string {
    const map: Record<string, string> = {
      Mesha: '♈', Vrishabha: '♉', Mithuna: '♊', Karka: '♋',
      Simha: '♌', Kanya: '♍', Tula: '♎', Vrischika: '♏',
      Dhanu: '♐', Makara: '♑', Kumbha: '♒', Meena: '♓',
    };
    return map[lagna] ?? '✦';
  }

  private nakshatraSign(nakshatra: string): string {
    // Return short nakshatra abbreviation for titles
    return nakshatra.split(' ')[0];
  }

  private blockStartingNow(local: { h: number; m: number }): Block | null {
    const nowMin = local.h * 60 + local.m;
    for (const b of ENGINE_BLOCKS) {
      const [bh, bm] = b.start.split(':').map(Number);
      const bMin = bh * 60 + bm;
      if (nowMin >= bMin && nowMin < bMin + 5) return b;
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
    const key = this.localDateKey(utc, tz);
    return new Date(`${key}T00:00:00Z`);
  }
}
