import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../database/prisma.service';
import { translationCacheKey } from '../utils/translation-cache-key';
import { GeminiService } from './gemini.service';

const DAILY_SINHALA_OPERATION = 'daily_sinhala_v1';
const FEED_ROW_SINHALA_OPERATION = 'feed_row_sinhala_v3';

/** English-side payload passed to Gemini for feed Sinhala localization (stable cache input). */
type FeedRowSiPayload = {
  title: string;
  preview: string;
  body: string;
  source: string;
  dreamStateLabel?: string | null;
  dreamInsight?: string | null;
  dreamGrounding?: string | null;
  dreamThemes?: string[];
};

type DayPayload = {
  guidance: string;
  bestWindow: string | null;
  cautionWindow: string | null;
  focus: string;
  actions: {
    do: Array<{ id: string; text: string; category: string }>;
    avoid: Array<{ id: string; text: string; category: string }>;
  };
};

type GeminiDailySchema = {
  title: string;
  summary: string;
  main_insight: string;
  do: string[];
  avoid: string[];
  lucky_window: string;
  stress_window: string;
  warning_level: 'low' | 'medium' | 'high';
};

@Injectable()
export class GeminiLanguageService {
  private readonly logger = new Logger(GeminiLanguageService.name);

  constructor(
    private readonly gemini: GeminiService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async renderDailySinhala(
    signal: {
      date: string;
      lagna: string;
      nakshatra: string;
      bestWindow: string | null;
      cautionWindow: string | null;
      focus: string;
      rating: 'great' | 'good' | 'mixed' | 'tense';
    },
    payload: DayPayload,
  ): Promise<GeminiDailySchema | null> {
    if (!this.gemini.isConfigured()) return null;

    const geminiModel = this.resolvedGeminiModel();
    const englishPayload = {
      type: 'daily_horoscope',
      language: 'si',
      signal,
      content: payload,
    };
    const cacheKey = translationCacheKey({
      operation: DAILY_SINHALA_OPERATION,
      geminiModel,
      englishPayload,
    });

    try {
      const cached = await this.prisma.aiTranslationCache.findUnique({
        where: { cacheKey },
      });
      if (cached && cached.expiresAt > new Date()) {
        const hit = this.validateGeminiDailyObject(cached.resultJson);
        if (hit) {
          void this.prisma.aiTranslationCache
            .update({
              where: { cacheKey },
              data: { hitCount: { increment: 1 } },
            })
            .catch(() => undefined);
          return hit;
        }
      }
    } catch (err) {
      this.logger.warn(`Sinhala cache read skipped (table or DB issue): ${String(err)}`);
    }

    const systemInstruction = [
      'You are a Sinhala astrology writer for Sri Lankan readers.',
      'Input JSON may be English: translate ALL user-visible strings into natural spoken Sinhala (colloquial-but-polite; avoid archaic poetry unless one short flourish fits).',
      'Do NOT invent chart facts not present in the input. Do NOT claim medical certainty.',
      'summary: 2–4 short sentences for mobile.',
      'main_insight: one or two sentences linking today’s tone to the given lagna/nakshatra/rating — reflective, not fortune-telling.',
      'do[] and avoid[]: concrete, culturally normal Sri Lankan advice (3–4 items each). No English leftovers.',
      'lucky_window: translate the favourable timing faithfully (readable clock ranges, e.g. පෙ.ව. 9–12).',
      'stress_window: translate the caution / heavy timing from input cautionWindow into one Sinhala sentence (empty string only if none).',
      'warning_level must be exactly low | medium | high.',
      'Return ONLY JSON. No markdown fences.',
      'Schema:',
      '{"title":"","summary":"","main_insight":"","do":[],"avoid":[],"lucky_window":"","stress_window":"","warning_level":"low|medium|high"}',
    ].join('\n');

    const userMessage = JSON.stringify(englishPayload, null, 2);

    try {
      const raw = await this.gemini.generateContent(systemInstruction, userMessage);
      const parsed = this.parseDailySchema(raw);
      if (!parsed) {
        this.logger.warn('Gemini output failed schema parse; using fallback.');
        return null;
      }

      await this.translationCacheUpsert(
        cacheKey,
        DAILY_SINHALA_OPERATION,
        geminiModel,
        parsed as object,
      );

      return parsed;
    } catch (e) {
      this.logger.warn(`Gemini Sinhala render failed: ${String(e)}`);
      return null;
    }
  }

  private resolvedGeminiModel(): string {
    return this.config.get<string>('GEMINI_MODEL')?.trim() || 'gemini-flash-latest';
  }

  /** Hours from env `AI_TRANSLATION_CACHE_TTL_HOURS` (default 72), capped at 8760. */
  private translationCacheTtlMs(): number {
    const raw = this.config.get<string>('AI_TRANSLATION_CACHE_TTL_HOURS');
    const hours = raw != null && raw.trim() !== '' ? Number(raw.trim()) : 72;
    const safe = Number.isFinite(hours) && hours > 0 ? Math.min(hours, 8760) : 72;
    return safe * 3600 * 1000;
  }

  private async translationCacheUpsert(
    cacheKey: string,
    operation: string,
    geminiModel: string,
    resultJson: object,
  ): Promise<void> {
    const ttlMs = this.translationCacheTtlMs();
    const expiresAt = new Date(Date.now() + ttlMs);
    await this.prisma.aiTranslationCache
      .upsert({
        where: { cacheKey },
        create: {
          cacheKey,
          operation,
          geminiModel,
          sourceLang: 'en',
          targetLang: 'si',
          resultJson,
          expiresAt,
        },
        update: {
          resultJson,
          expiresAt,
          geminiModel,
        },
      })
      .catch((err) => this.logger.warn(`Translation cache write failed: ${String(err)}`));
  }

  private parseDailySchema(raw: string): GeminiDailySchema | null {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    let json: unknown;
    try {
      json = JSON.parse(match[0]);
    } catch {
      return null;
    }
    return this.validateGeminiDailyObject(json);
  }

  /** Validates cached `resultJson` or freshly parsed Gemini output. */
  private validateGeminiDailyObject(json: unknown): GeminiDailySchema | null {
    if (json == null || typeof json !== 'object') return null;
    const o = json as Record<string, unknown>;
    const title = this.toStr(o.title);
    const summary = this.toStr(o.summary);
    const mainInsight = this.toStr(o.main_insight);
    const doList = this.toStrList(o.do);
    const avoidList = this.toStrList(o.avoid);
    const lucky = this.toStr(o.lucky_window);
    const stress = this.toStr(o.stress_window);
    const warning = this.toWarning(o.warning_level);
    if (
      !title ||
      !summary ||
      !mainInsight ||
      !lucky ||
      warning == null ||
      doList.length === 0 ||
      avoidList.length === 0
    ) {
      return null;
    }
    return {
      title,
      summary,
      main_insight: mainInsight,
      do: doList.slice(0, 4),
      avoid: avoidList.slice(0, 4),
      lucky_window: lucky,
      stress_window: stress,
      warning_level: warning,
    };
  }

  private toStr(v: unknown): string {
    return typeof v === 'string' ? v.trim() : '';
  }

  private toStrList(v: unknown): string[] {
    if (!Array.isArray(v)) return [];
    return v.map((x) => this.toStr(x)).filter((x) => x.length > 0);
  }

  private toWarning(v: unknown): 'low' | 'medium' | 'high' | null {
    const s = this.toStr(v).toLowerCase();
    if (s === 'low' || s === 'medium' || s === 'high') return s;
    return null;
  }

  /**
   * Batch-translate feed card user-visible strings to Sinhala. Same length/order as input.
   * Uses per-row cache keys (English payload hash) so static cards stay warm when the feed changes elsewhere.
   */
  async localizeFeedRowsSi(rows: FeedRowSiPayload[]): Promise<FeedRowSiPayload[] | null> {
    if (!this.gemini.isConfigured() || rows.length === 0) return null;

    const geminiModel = this.resolvedGeminiModel();
    const now = new Date();
    const keys = rows.map((row) =>
      translationCacheKey({
        operation: FEED_ROW_SINHALA_OPERATION,
        geminiModel,
        englishPayload: row,
      }),
    );
    const uniqueKeys = [...new Set(keys)];

    let cachedEntries: Awaited<ReturnType<typeof this.prisma.aiTranslationCache.findMany>> = [];
    if (uniqueKeys.length > 0) {
      try {
        cachedEntries = await this.prisma.aiTranslationCache.findMany({
          where: { cacheKey: { in: uniqueKeys }, expiresAt: { gt: now } },
        });
      } catch (err) {
        this.logger.warn(`Feed Sinhala cache batch read skipped (table or DB issue): ${String(err)}`);
      }
    }
    const cacheByKey = new Map(cachedEntries.map((c) => [c.cacheKey, c]));

    const out: FeedRowSiPayload[] = new Array(rows.length);
    const missIndices: number[] = [];

    for (let i = 0; i < rows.length; i++) {
      const key = keys[i];
      const row = rows[i];
      const hitRow = this.tryFeedRowCacheHit(row, key, cacheByKey.get(key));
      if (hitRow) {
        out[i] = hitRow;
        void this.prisma.aiTranslationCache
          .update({ where: { cacheKey: key }, data: { hitCount: { increment: 1 } } })
          .catch(() => undefined);
      } else {
        missIndices.push(i);
      }
    }

    if (missIndices.length === 0) return out;

    const systemInstruction = [
      'You translate app feed cards into natural spoken Sinhala for Sri Lankan readers.',
      'Input JSON has items[] in fixed order. Translate each string field to Sinhala.',
      'Preserve meaning; no medical diagnoses; keep names/places as-is if proper nouns.',
      'dreamThemes: translate each phrase; same array length.',
      'If a field is empty string, keep empty.',
      'Return ONLY JSON: {"items":[{"title":"","preview":"","body":"","source":"","dreamStateLabel":"","dreamInsight":"","dreamGrounding":"","dreamThemes":[]}]}',
      'Use null for optional fields that were null in input; omit dreamThemes key if input item had no themes.',
    ].join('\n');

    const missRows = missIndices.map((i) => rows[i]);
    const userMessage = JSON.stringify({ language: 'si', items: missRows }, null, 2);

    try {
      const raw = await this.gemini.generateContent(systemInstruction, userMessage);
      const items = this.parseFeedGeminiItems(raw, missRows.length);
      if (!items) return null;

      for (let pos = 0; pos < missIndices.length; pos++) {
        const i = missIndices[pos];
        const base = rows[i];
        const merged = this.mergeFeedRowFromGemini(base, items[pos]);
        if (!merged) return null;
        out[i] = merged;
        void this.translationCacheUpsert(keys[i], FEED_ROW_SINHALA_OPERATION, geminiModel, merged as object);
      }

      return out;
    } catch (e) {
      this.logger.warn(`Gemini feed Sinhala localize failed: ${String(e)}`);
      return null;
    }
  }

  private tryFeedRowCacheHit(
    base: FeedRowSiPayload,
    cacheKey: string,
    entry: { resultJson: unknown } | undefined,
  ): FeedRowSiPayload | null {
    if (!entry) return null;
    return this.validateCachedFeedRowPayload(base, entry.resultJson);
  }

  /** Ensures cached JSON still matches the shape expected for this row (schema drift → miss). */
  private validateCachedFeedRowPayload(base: FeedRowSiPayload, cached: unknown): FeedRowSiPayload | null {
    if (cached == null || typeof cached !== 'object') return null;
    const c = cached as Record<string, unknown>;
    const title = this.toStr(c.title);
    const preview = this.toStr(c.preview);
    const body = this.toStr(c.body);
    const source = this.toStr(c.source);
    if (!title || !preview || !body || !source) return null;

    const out: FeedRowSiPayload = { title, preview, body, source };

    if (base.dreamStateLabel !== undefined) {
      if (base.dreamStateLabel == null) out.dreamStateLabel = null;
      else {
        const v = this.toStr(c.dreamStateLabel);
        if (!v) return null;
        out.dreamStateLabel = v;
      }
    }
    if (base.dreamInsight !== undefined) {
      if (base.dreamInsight == null) out.dreamInsight = null;
      else {
        const v = this.toStr(c.dreamInsight);
        if (!v) return null;
        out.dreamInsight = v;
      }
    }
    if (base.dreamGrounding !== undefined) {
      if (base.dreamGrounding == null) out.dreamGrounding = null;
      else {
        const v = this.toStr(c.dreamGrounding);
        if (!v) return null;
        out.dreamGrounding = v;
      }
    }
    if (base.dreamThemes?.length) {
      const themes = Array.isArray(c.dreamThemes)
        ? (c.dreamThemes as unknown[]).map((t) => this.toStr(t)).filter((t) => t.length > 0)
        : [];
      if (themes.length === 0) return null;
      out.dreamThemes = themes;
    }

    return out;
  }

  private parseFeedGeminiItems(raw: string, expectedLen: number): Record<string, unknown>[] | null {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    let json: unknown;
    try {
      json = JSON.parse(match[0]);
    } catch {
      return null;
    }
    if (json == null || typeof json !== 'object') return null;
    const items = (json as { items?: unknown }).items;
    if (!Array.isArray(items) || items.length !== expectedLen) return null;
    const out: Record<string, unknown>[] = [];
    for (const o of items) {
      if (o == null || typeof o !== 'object') return null;
      out.push(o as Record<string, unknown>);
    }
    return out;
  }

  private mergeFeedRowFromGemini(base: FeedRowSiPayload, r: Record<string, unknown>): FeedRowSiPayload | null {
    const themesIn = base.dreamThemes;
    const themesOut = Array.isArray(r.dreamThemes)
      ? (r.dreamThemes as unknown[]).map((t) => this.toStr(t)).filter((t) => t.length > 0)
      : themesIn;
    const title = this.toStr(r.title) || base.title;
    const preview = this.toStr(r.preview) || base.preview;
    const body = this.toStr(r.body) || base.body;
    const source = this.toStr(r.source) || base.source;
    if (!title || !preview || !body || !source) return null;
    return {
      ...base,
      title,
      preview,
      body,
      source,
      dreamStateLabel:
        base.dreamStateLabel == null
          ? base.dreamStateLabel
          : this.toStr(r.dreamStateLabel) || base.dreamStateLabel,
      dreamInsight:
        base.dreamInsight == null
          ? base.dreamInsight
          : this.toStr(r.dreamInsight) || base.dreamInsight,
      dreamGrounding:
        base.dreamGrounding == null
          ? base.dreamGrounding
          : this.toStr(r.dreamGrounding) || base.dreamGrounding,
      dreamThemes: themesIn?.length && themesOut?.length ? themesOut : themesIn,
    };
  }
}

