import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { DailyPredictionService } from '../prediction/services/daily-prediction.service';
import { FirebasePushService, isUnregisteredFcmError } from '../push/firebase-push.service';
import { GeminiService } from '../ai/services/gemini.service';
import { SubatimeService } from '../subatime/subatime.service';

type Block = { start: string; end: string; label: string };

/**
 * Fires at the START of each engine time block in the user's local timezone.
 * Uses Gemini to generate a short, meaningful, personalized notification
 * based on the user's actual prediction data (lagna, nakshatra, do/avoid, context).
 */
@Injectable()
export class HourlyPredictionPushService {
  private readonly logger = new Logger(HourlyPredictionPushService.name);
  private readonly _sent = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly dailyPrediction: DailyPredictionService,
    private readonly subatime: SubatimeService,
    private readonly push: FirebasePushService,
    private readonly gemini: GeminiService,
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
        birthProfile: { select: { timezone: true, onboardingIntent: true } },
        deviceTokens: { select: { token: true } },
      },
    });

    let sent = 0;

    for (const user of users) {
      try {
        const prefs  = user.preferences as Record<string, unknown> | null;
        const notifs = prefs?.['notifications'] as Record<string, unknown> | undefined;
        if (notifs?.['muteLearningTips'] === true) continue;

        const tz = user.birthProfile?.timezone ?? 'Asia/Colombo';
        const localNow = this.localTime(now, tz);
        const block = this.blockStartingNow(localNow);
        if (!block) continue;

        const dateKey  = this.localDateKey(now, tz);
        const dedupKey = `${user.id}:${block.start}:${dateKey}`;
        if (this._sent.has(dedupKey)) continue;

        // Get today's full plan payload (includes do/avoid/copy contract)
        const planResult = await this.subatime.getPlanDay(user.id, dateKey);
        const planDto = planResult?.data as Record<string, unknown> | undefined;

        // Also get prediction for scoring context
        const output = await this.dailyPrediction.generateForUser(user.id, now);
        if (!output) continue;

        // Build Gemini-powered notification content
        const content = await this.buildGeminiContent({
          block,
          goodTimes:   output.goodTimes as Block[],
          badTimes:    output.badTimes  as Block[],
          planDto,
          lagna:       String(output.meta.lagna ?? ''),
          nakshatra:   String(output.meta.nakshatra ?? ''),
          context:     output.personalization.mostRelevantContext,
          confidence:  output.confidenceScore,
          userName:    user.name ?? 'Friend',
        });

        const tokens = user.deviceTokens.map(t => t.token);
        const result = await this.push.sendEachToTokens({
          tokens,
          title: content.title,
          body:  content.body,
          data: {
            type:      'feed',
            alertType: 'BLOCK_START',
            blockLabel: block.label,
            planDate:  dateKey,
          },
        });

        if (result.successCount > 0) {
          sent += result.successCount;
          this._sent.add(dedupKey);
          this.logger.log(`[${block.label}] → ${user.name}: "${content.title}" — ${content.body.slice(0, 60)}`);
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

  // ── Gemini-powered content ─────────────────────────────────────────────────

  private async buildGeminiContent(p: {
    block:     Block;
    goodTimes: Block[];
    badTimes:  Block[];
    planDto:   Record<string, unknown> | undefined;
    lagna:     string;
    nakshatra: string;
    context:   string;
    confidence: number;
    userName:  string;
  }): Promise<{ title: string; body: string }> {
    const isPeak    = p.goodTimes.some(b => b.start === p.block.start);
    const isCaution = p.badTimes.some(b => b.start === p.block.start);

    // Extract real do/avoid from plan payload
    const actions = p.planDto?.actions as Record<string, unknown> | undefined;
    const doItems  = (actions?.do  as Array<{ text: string }> | undefined)?.map(i => i.text) ?? [];
    const avoidItems = (actions?.avoid as Array<{ text: string }> | undefined)?.map(i => i.text) ?? [];
    const headline = p.planDto?.guidance as string | undefined;

    // Use Gemini when configured, else fall back to structured content
    if (this.gemini.isConfigured()) {
      try {
        const type = isPeak ? 'PEAK' : isCaution ? 'CAUTION' : 'NEUTRAL';
        const prompt = this.buildGeminiPrompt({
          block: p.block, type,
          lagna: p.lagna, nakshatra: p.nakshatra,
          context: p.context, confidence: p.confidence,
          doItems, avoidItems, headline,
        });
        const raw = await this.gemini.generateContent(
          'You are Subatime — a Sri Lankan Jyotiṣya guidance app. ' +
          'Write ONE push notification for this user. ' +
          'Reply with exactly two lines:\nTITLE: <max 45 chars>\nBODY: <max 90 chars>\n' +
          'Be specific, warm, actionable. No asterisks. No emojis in body. Use emoji only in title.',
          prompt,
        );
        const parsed = this.parseGeminiNotification(raw, p.block.label, isPeak, isCaution);
        if (parsed) return parsed;
      } catch (e) {
        this.logger.warn(`Gemini notification failed: ${String(e)} — using fallback`);
      }
    }

    // Fallback: structured content
    return this.fallbackContent(p.block, isPeak, isCaution, doItems, avoidItems);
  }

  private buildGeminiPrompt(p: {
    block: Block; type: string;
    lagna: string; nakshatra: string;
    context: string; confidence: number;
    doItems: string[]; avoidItems: string[];
    headline?: string;
  }): string {
    const conf = Math.round(p.confidence * 100);
    const lines = [
      `Time block: ${p.block.label} (${p.block.start}–${p.block.end})`,
      `Block type: ${p.type} (${p.type === 'PEAK' ? 'best energy window' : p.type === 'CAUTION' ? 'low energy window' : 'neutral window'})`,
      `Lagna (ascendant): ${p.lagna}`,
      `Nakshatra (birth star): ${p.nakshatra}`,
      `Life focus: ${p.context}`,
      `Confidence score: ${conf}%`,
    ];
    if (p.doItems.length) lines.push(`Today's DO items: ${p.doItems.slice(0, 2).join('; ')}`);
    if (p.avoidItems.length) lines.push(`Today's AVOID items: ${p.avoidItems.slice(0, 2).join('; ')}`);
    if (p.headline) lines.push(`Today's guidance: ${p.headline.slice(0, 100)}`);
    return lines.join('\n');
  }

  private parseGeminiNotification(
    raw: string,
    blockLabel: string,
    isPeak: boolean,
    isCaution: boolean,
  ): { title: string; body: string } | null {
    const titleMatch = raw.match(/^TITLE:\s*(.+)$/im);
    const bodyMatch  = raw.match(/^BODY:\s*(.+)$/im);
    if (!titleMatch || !bodyMatch) return null;
    const title = titleMatch[1].trim().slice(0, 50);
    const body  = bodyMatch[1].trim().slice(0, 100);
    if (!title || !body) return null;
    return { title, body };
  }

  private fallbackContent(
    block: Block,
    isPeak: boolean,
    isCaution: boolean,
    doItems: string[],
    avoidItems: string[],
  ): { title: string; body: string } {
    if (isPeak) {
      const doText = doItems[0] ? this.clip(doItems[0], 70) : 'Move forward with clarity.';
      return { title: `✨ ${block.label} — Peak hora`, body: doText };
    }
    if (isCaution) {
      const avoidText = avoidItems[0] ? `Avoid: ${this.clip(avoidItems[0], 65)}` : 'Rest and observe. Low energy window.';
      return { title: `⚠️ ${block.label} — Go gently`, body: avoidText };
    }
    const neutral: Record<string, string> = {
      '06:00': 'Set your intention before the day begins.',
      '08:00': 'Your most important task deserves your first energy.',
      '10:00': 'Keep the momentum from this morning going.',
      '12:00': 'Midday — check: are you on track?',
      '14:00': 'Afternoon shift. Creative energy rises now.',
      '16:00': 'Wrap up open tasks before the evening.',
      '18:00': 'Good time for connection and reflection.',
      '20:00': 'Wind down and restore. Tomorrow is already computed.',
    };
    return { title: `· ${block.label}`, body: neutral[block.start] ?? 'Stay present this hora.' };
  }

  // ── Timing helpers ─────────────────────────────────────────────────────────

  private readonly ENGINE_BLOCKS = [
    { start: '06:00', end: '08:00', label: 'Early Morning' },
    { start: '08:00', end: '10:00', label: 'Morning Focus' },
    { start: '10:00', end: '12:00', label: 'Late Morning' },
    { start: '12:00', end: '14:00', label: 'Noon Window' },
    { start: '14:00', end: '16:00', label: 'Afternoon Push' },
    { start: '16:00', end: '18:00', label: 'Evening Start' },
    { start: '18:00', end: '20:00', label: 'Evening Prime' },
    { start: '20:00', end: '22:00', label: 'Night Calm' },
  ];

  private blockStartingNow(local: { h: number; m: number }): Block | null {
    const nowMin = local.h * 60 + local.m;
    for (const b of this.ENGINE_BLOCKS) {
      const [bh, bm] = b.start.split(':').map(Number);
      const blockMin = bh * 60 + bm;
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

  private clip(s: string, n: number): string {
    s = s.trim();
    const colon = s.indexOf(': ');
    if (colon > 0 && colon < 25) s = s.substring(colon + 2).trim();
    return s.length > n ? `${s.slice(0, n - 1).trim()}…` : s;
  }
}
