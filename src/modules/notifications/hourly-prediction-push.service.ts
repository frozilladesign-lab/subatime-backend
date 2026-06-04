import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { DailyPredictionService } from '../prediction/services/daily-prediction.service';
import { FirebasePushService, isUnregisteredFcmError } from '../push/firebase-push.service';

type Block = { start: string; end: string; label: string };
type Transit = { id: string; type: string; title: string; description: string; intensity: number };

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
 * Accurate block notifications — content sourced directly from prediction engine:
 *   - goodTimes / badTimes → which block is peak/caution
 *   - transits → the ACTUAL planetary events driving the day's energy
 *   - summary → contains specific best-window timing from the engine
 *   - dominantContext + confidenceScore → personalises the message tone
 *   - Sade Sati / Jupiter transit meta → adds astrological accuracy
 */
@Injectable()
export class HourlyPredictionPushService {
  private readonly logger = new Logger(HourlyPredictionPushService.name);
  private readonly _sent = new Set<string>();

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

        // ── Get stored prediction (has transits, goodTimes, badTimes, meta) ──
        const storedPred = await this.prisma.dailyPrediction.findUnique({
          where: { userId_date: { userId: user.id, date: this.startOfDay(now, tz) } },
          select: {
            goodTimes: true, badTimes: true, transits: true,
            summary: true, confidenceScore: true, dominantContext: true,
            scoreSpread: true,
          },
        });

        // Generate if missing
        const output = storedPred ?? await this.dailyPrediction.generateForUser(user.id, now);
        if (!output) continue;

        const goodTimes = (storedPred?.goodTimes ?? (output as any).goodTimes ?? []) as Block[];
        const badTimes  = (storedPred?.badTimes  ?? (output as any).badTimes  ?? []) as Block[];
        const transits  = (storedPred?.transits  ?? (output as any).transits  ?? []) as Transit[];
        const summary   = storedPred?.summary ?? (output as any).summary ?? '';
        const confidence = storedPred?.confidenceScore ?? (output as any).confidenceScore ?? 0.5;
        const context    = storedPred?.dominantContext ?? (output as any).personalization?.mostRelevantContext ?? 'overall';

        // Fetch meta for Sade Sati / Jupiter transit accuracy
        const chart = await this.prisma.astrologyChart.findFirst({
          where: { birthProfile: { userId: user.id } },
          orderBy: { version: 'desc' },
          select: { chartData: true },
        });
        const chartData = chart?.chartData as Record<string, unknown> | undefined;
        const lagna      = String(chartData?.lagna ?? '');
        const nakshatra  = String(chartData?.nakshatra ?? '');
        const dasha      = chartData?.dasha as Record<string, unknown> | undefined;
        const dashaLord  = String(dasha?.current ?? '');
        const antaraLord = String(dasha?.antara  ?? '');

        const isPeak1   = goodTimes[0]?.start === block.start;
        const isPeak2   = goodTimes[1]?.start === block.start;
        const isCaution = badTimes[0]?.start  === block.start;
        const isWeak    = badTimes[1]?.start  === block.start;

        const content = this.buildContent({
          block, isPeak1, isPeak2, isCaution, isWeak,
          goodTimes, badTimes, transits, summary,
          confidence, context, lagna, nakshatra,
          dashaLord, antaraLord,
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
          this.logger.log(`[${block.label}] ${user.name ?? user.id.slice(0,8)}: "${content.title}" | "${content.body.slice(0,50)}"`);
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

  // ── Accurate content from engine data ────────────────────────────────────

  private buildContent(p: {
    block: Block;
    isPeak1: boolean; isPeak2: boolean; isCaution: boolean; isWeak: boolean;
    goodTimes: Block[]; badTimes: Block[]; transits: Transit[];
    summary: string; confidence: number; context: string;
    lagna: string; nakshatra: string; dashaLord: string; antaraLord: string;
  }): { title: string; body: string } {
    const emoji  = this.lagnaEmoji(p.lagna);
    const rating = this.ratingFromScore(p.confidence);

    // ── PEAK HORA — actual best window from engine ──────────────────────────
    if (p.isPeak1) {
      // Find best matching transit for this block (opportunity type first)
      const transit = this.bestTransitForBlock(p.transits, 'opportunity') ??
                      this.bestTransitForBlock(p.transits, 'neutral');
      const body = transit
        ? this.trimTransit(transit.description, 90)
        : this.peakBodyFromContext(p.context, rating, p.dashaLord);
      return {
        title: `${emoji} ${p.block.label} — ✨ Peak hora`,
        body,
      };
    }

    // ── SECOND BEST ────────────────────────────────────────────────────────
    if (p.isPeak2) {
      const transit = this.bestTransitForBlock(p.transits, 'opportunity');
      return {
        title: `✦ ${p.block.label} — Strong window`,
        body: transit
          ? this.trimTransit(transit.description, 90)
          : `Good ${p.context} energy. Keep steady momentum.`,
      };
    }

    // ── CAUTION HORA — actual worst window from engine ──────────────────────
    if (p.isCaution) {
      // Use challenge transit description for body — it explains WHY
      const transit = this.bestTransitForBlock(p.transits, 'challenge');
      const body = transit
        ? this.trimTransit(transit.description, 90)
        : this.cautionBodyFromContext(p.context, rating, p.dashaLord);
      return {
        title: `⚠️ ${p.block.label} — Low-energy hora`,
        body,
      };
    }

    // ── WEAK BLOCK ──────────────────────────────────────────────────────────
    if (p.isWeak) {
      return {
        title: `· ${p.block.label} — Go gently`,
        body: `${rating === 'tense' ? 'Conserve energy.' : 'Lighter tasks serve you better now.'}`,
      };
    }

    // ── NEUTRAL — time + rating + dasha lord ────────────────────────────────
    return {
      title: `· ${p.block.label}`,
      body:  this.neutralBody(p.block.start, rating, p.context, p.dashaLord),
    };
  }

  // ── Transit helpers ────────────────────────────────────────────────────────

  /** Pick highest-intensity transit of given type. */
  private bestTransitForBlock(transits: Transit[], type: string): Transit | null {
    const candidates = transits
      .filter(t => t.type === type)
      .sort((a, b) => b.intensity - a.intensity);
    return candidates[0] ?? null;
  }

  /** Trim transit description to max chars, removing verbose lead-in phrases. */
  private trimTransit(desc: string, max: number): string {
    let s = desc.trim();
    // Remove common lead-in patterns
    s = s.replace(/^(Emotional tone|Desire and|Words land|This aspect|The)/i, '').trimStart();
    // Capitalise first letter
    s = s.charAt(0).toUpperCase() + s.slice(1);
    return s.length > max ? `${s.slice(0, max - 1).trim()}…` : s;
  }

  // ── Context-based fallback copy (when no matching transit) ───────────────

  private peakBodyFromContext(context: string, rating: string, dashaLord: string): string {
    const dashaBoost = ['Sun','Moon','Jupiter'].includes(dashaLord) ? ' Jupiter dasha amplifies.' : '';
    const lines: Record<string, string> = {
      career: `Best window for decisive work${dashaBoost} Act on what matters most.`,
      love:   `Heart energy is clearest now.${dashaBoost} Express what matters.`,
      health: `Physical energy peaks here. Move your body now.`,
      overall:`Peak hora — best window of the day. Move forward.`,
    };
    return lines[context] ?? lines.overall;
  }

  private cautionBodyFromContext(context: string, rating: string, dashaLord: string): string {
    const lines: Record<string, string> = {
      career: `Avoid risky decisions or new commitments now.`,
      love:   `Emotional sensitivity is high. Pause before reacting.`,
      health: `Low physical energy. Rest is the right choice.`,
      overall:`Low-energy hora. Conserve and observe.`,
    };
    return lines[context] ?? lines.overall;
  }

  private neutralBody(start: string, rating: string, context: string, dashaLord: string): string {
    const hour = parseInt(start, 10);
    if (hour < 8)  return rating === 'tense' ? 'Ease into the day gently.' : 'Set a clear intention before starting.';
    if (hour < 12) return context === 'career' ? 'Focused work flows well now.' : 'Keep the morning energy steady.';
    if (hour < 14) return rating === 'tense' ? 'Midday is heavy. Rest if possible.' : 'Check progress and adjust.';
    if (hour < 18) return context === 'love' ? 'Afternoon is good for connection.' : 'Creative momentum builds now.';
    if (hour < 20) return rating === 'great' ? 'Evening energy is strong. Use it.' : 'Wind down tasks and reflect.';
    return rating === 'tense' ? 'Rest fully. Tomorrow the engine recalculates.' : 'Night hora. Restore and prepare.';
  }

  // ── Utility ────────────────────────────────────────────────────────────────

  private ratingFromScore(score: number): string {
    if (score >= 0.8) return 'great';
    if (score >= 0.65) return 'good';
    if (score >= 0.5) return 'mixed';
    return 'tense';
  }

  private lagnaEmoji(lagna: string): string {
    const map: Record<string, string> = {
      Mesha:'♈', Vrishabha:'♉', Mithuna:'♊', Karka:'♋',
      Simha:'♌', Kanya:'♍', Tula:'♎', Vrischika:'♏',
      Dhanu:'♐', Makara:'♑', Kumbha:'♒', Meena:'♓',
    };
    return map[lagna] ?? '✦';
  }

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
