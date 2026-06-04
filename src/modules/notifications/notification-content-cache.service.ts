import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { GeminiService } from '../ai/services/gemini.service';
import { DailyPredictionService } from '../prediction/services/daily-prediction.service';

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

export type CachedNotification = { title: string; body: string };

/**
 * Pre-generates and caches notification content for the day at midnight.
 *
 * Strategy for scale:
 *   - Groups users by unique (lagna + nakshatra + context + blockType + rating)
 *   - Calls Gemini ONCE per unique combination, not once per user
 *   - At 500 users with ~80 unique combos × 8 blocks = ~640 Gemini calls/day
 *     vs 4,000 if called per user
 *   - Cached in memory with date key — auto-refreshes at midnight
 *
 * Cost estimate at 500 users:
 *   640 calls × 250 tokens = 160K tokens/day ≈ $0.01/day on paid tier
 */
@Injectable()
export class NotificationContentCacheService {
  private readonly logger = new Logger(NotificationContentCacheService.name);

  /** Key: `dateISO:lagna:nakshatra:context:blockLabel:blockType` */
  private readonly _cache = new Map<string, CachedNotification>();
  private _lastGenDate = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly gemini: GeminiService,
    private readonly dailyPrediction: DailyPredictionService,
  ) {}

  /** Pre-generate all notifications at midnight. */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async pregenerateAll(): Promise<void> {
    const dateKey = new Date().toISOString().slice(0, 10);
    this.logger.log(`Pre-generating notification content for ${dateKey}...`);
    await this._generateForDate(dateKey);
    this._lastGenDate = dateKey;
  }

  /**
   * Get cached notification for a user's block.
   * If cache is empty (e.g. first request of the day), generates on demand.
   */
  async getNotification(params: {
    lagna: string;
    nakshatra: string;
    context: string;
    block: Block;
    blockType: 'PEAK' | 'CAUTION' | 'NEUTRAL';
    rating: string;
    doItems: string[];
    avoidItems: string[];
    dateKey: string;
  }): Promise<CachedNotification> {
    const cacheKey = `${params.dateKey}:${params.lagna}:${params.nakshatra}:${params.context}:${params.block.label}:${params.blockType}`;

    if (this._cache.has(cacheKey)) {
      return this._cache.get(cacheKey)!;
    }

    // Generate on demand for this combo
    const content = await this._generateOne(params);
    this._cache.set(cacheKey, content);
    return content;
  }

  // ── Generation ─────────────────────────────────────────────────────────────

  private async _generateForDate(dateKey: string): Promise<void> {
    const today = new Date(`${dateKey}T00:00:00Z`);

    // Get all users with predictions today
    const predictions = await this.prisma.dailyPrediction.findMany({
      where: { date: today },
      include: {
        user: {
          include: {
            birthProfile: {
              include: { charts: { orderBy: { version: 'desc' }, take: 1 } }
            }
          }
        }
      }
    });

    // Collect unique combinations
    const seen = new Set<string>();
    const combos: Array<{
      lagna: string; nakshatra: string; context: string; rating: string;
      doItems: string[]; avoidItems: string[];
      goodTimes: Block[]; badTimes: Block[];
    }> = [];

    for (const pred of predictions) {
      const cd = pred.user.birthProfile?.charts[0]?.chartData as Record<string, unknown> | undefined;
      const lagna     = String(cd?.lagna     ?? 'Unknown');
      const nakshatra = String(cd?.nakshatra ?? 'Unknown');
      const context   = pred.dominantContext ?? 'overall';
      const rating    = this.ratingFromScore(pred.confidenceScore);
      const goodTimes = Array.isArray(pred.goodTimes) ? pred.goodTimes as Block[] : [];
      const badTimes  = Array.isArray(pred.badTimes)  ? pred.badTimes  as Block[] : [];

      // Extract do/avoid from plan payload
      const doItems:    string[] = [];
      const avoidItems: string[] = [];

      const key = `${lagna}:${nakshatra}:${context}:${rating}`;
      if (!seen.has(key)) {
        seen.add(key);
        combos.push({ lagna, nakshatra, context, rating, doItems, avoidItems, goodTimes, badTimes });
      }
    }

    this.logger.log(`Generating for ${combos.length} unique chart combinations × 8 blocks = ${combos.length * 8} Gemini calls`);

    let generated = 0;
    let skipped = 0;

    for (const combo of combos) {
      for (const block of ENGINE_BLOCKS) {
        const blockType = combo.goodTimes.some(b => b.start === block.start) ? 'PEAK'
          : combo.badTimes.some(b => b.start === block.start) ? 'CAUTION' : 'NEUTRAL';

        const cacheKey = `${dateKey}:${combo.lagna}:${combo.nakshatra}:${combo.context}:${block.label}:${blockType}`;
        if (this._cache.has(cacheKey)) { skipped++; continue; }

        try {
          const content = await this._generateOne({
            lagna: combo.lagna, nakshatra: combo.nakshatra,
            context: combo.context, block, blockType,
            rating: combo.rating, doItems: combo.doItems,
            avoidItems: combo.avoidItems, dateKey,
          });
          this._cache.set(cacheKey, content);
          generated++;
          // Small delay to respect rate limits
          await new Promise(r => setTimeout(r, 200));
        } catch (e) {
          this.logger.warn(`Cache gen failed for ${cacheKey}: ${String(e)}`);
        }
      }
    }

    this.logger.log(`Notification cache: ${generated} generated, ${skipped} already cached`);
  }

  private async _generateOne(p: {
    lagna: string; nakshatra: string; context: string;
    block: Block; blockType: string; rating: string;
    doItems: string[]; avoidItems: string[]; dateKey: string;
  }): Promise<CachedNotification> {
    if (!this.gemini.isConfigured()) {
      return this._fallback(p.block, p.blockType as 'PEAK' | 'CAUTION' | 'NEUTRAL', p.doItems, p.avoidItems);
    }

    try {
      const prompt = [
        `Time block: ${p.block.label} (${p.block.start}–${p.block.end})`,
        `Block energy: ${p.blockType}${p.blockType === 'PEAK' ? ' — best window of the day' : p.blockType === 'CAUTION' ? ' — low energy, go gently' : ''}`,
        `Lagna (ascendant): ${p.lagna}`,
        `Nakshatra (birth star): ${p.nakshatra}`,
        `Life focus: ${p.context}`,
        `Day rating: ${p.rating}`,
        p.doItems.length ? `Do today: ${p.doItems.slice(0, 2).join('; ')}` : '',
        p.avoidItems.length ? `Avoid today: ${p.avoidItems.slice(0, 2).join('; ')}` : '',
      ].filter(Boolean).join('\n');

      const raw = await this.gemini.generateContent(
        'You are Subatime — a Sri Lankan Jyotiṣya daily guidance app. ' +
        'Generate ONE push notification. Reply with exactly:\nTITLE: <max 45 chars, include 1 emoji>\nBODY: <max 90 chars, specific and actionable, no emoji>',
        prompt,
      );

      const titleMatch = raw.match(/^TITLE:\s*(.+)$/im);
      const bodyMatch  = raw.match(/^BODY:\s*(.+)$/im);
      if (titleMatch && bodyMatch) {
        return {
          title: titleMatch[1].trim().slice(0, 50),
          body:  bodyMatch[1].trim().slice(0, 100),
        };
      }
    } catch (e) {
      this.logger.warn(`Gemini _generateOne failed: ${String(e)}`);
    }

    return this._fallback(p.block, p.blockType as 'PEAK' | 'CAUTION' | 'NEUTRAL', p.doItems, p.avoidItems);
  }

  private _fallback(block: Block, type: 'PEAK' | 'CAUTION' | 'NEUTRAL', doItems: string[], avoidItems: string[]): CachedNotification {
    if (type === 'PEAK')    return { title: `✨ ${block.label} — Peak hora`, body: doItems[0]    ? this._clip(doItems[0], 90)    : 'Best energy now. Move forward.' };
    if (type === 'CAUTION') return { title: `⚠️ ${block.label} — Go gently`, body: avoidItems[0] ? `Avoid: ${this._clip(avoidItems[0], 80)}` : 'Low energy. Rest and observe.' };
    const neutral: Record<string, string> = {
      '06:00': 'Set your intention before the day begins.',
      '08:00': 'Your most important task deserves your first energy.',
      '10:00': 'Keep the morning momentum going.',
      '12:00': 'Midday — are you on track?',
      '14:00': 'Creative energy rises this afternoon.',
      '16:00': 'Wrap up open tasks before evening.',
      '18:00': 'Good time for connection and reflection.',
      '20:00': 'Wind down. Tomorrow is already computed.',
    };
    return { title: `· ${block.label}`, body: neutral[block.start] ?? 'Stay present this hora.' };
  }

  private ratingFromScore(score: number): string {
    if (score >= 0.8) return 'great';
    if (score >= 0.65) return 'good';
    if (score >= 0.5) return 'mixed';
    return 'tense';
  }

  private _clip(s: string, n: number): string {
    s = s.trim();
    const c = s.indexOf(': ');
    if (c > 0 && c < 25) s = s.substring(c + 2).trim();
    return s.length > n ? `${s.slice(0, n - 1).trim()}…` : s;
  }
}
