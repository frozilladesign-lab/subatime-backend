import { Injectable, Logger } from '@nestjs/common';
import type { MonthlyDigest, WeeklyDigest } from '@subatime/jyotisha-engine';
import { GeminiService } from '../../../ai/services/gemini.service';
import { buildMonthlyDigestPrompt, buildWeeklyDigestPrompt } from './digest-ai.prompt';
import { mergeMonthlyAiContent, mergeWeeklyAiContent } from './digest-ai.merge';
import {
  validateMonthlyAiContent,
  validateWeeklyAiContent,
} from './digest-ai.validation';
import {
  DIGEST_AI_PROMPT_VERSION,
  type DigestContentProvider,
  type DigestContentStatus,
  type DigestLocale,
  type MonthlyFactPack,
  type WeeklyDayAiContent,
  type WeeklyFactPack,
} from './digest-ai.types';

export interface WeeklyEnrichResult {
  digest: WeeklyDigest;
  /** Per-day copy for the daily activation overlay. Empty on template fallback. */
  dailyContent: WeeklyDayAiContent[];
  provider: DigestContentProvider;
  status: DigestContentStatus;
  promptVersion: string;
}

export interface MonthlyEnrichResult {
  digest: MonthlyDigest;
  provider: DigestContentProvider;
  status: DigestContentStatus;
  promptVersion: string;
}

/**
 * AI-first content layer over the deterministic digests. `enrichWeekly`/`enrichMonthly` take an
 * already-built deterministic digest plus a compact, privacy-safe fact pack, ask Gemini once to
 * rewrite the wording, validate it strictly, and merge it back. On a missing key, a Gemini error,
 * or invalid output (retried once), the deterministic digest is returned unchanged as the
 * template fallback. These methods never throw — a failure only downgrades to the template.
 */
@Injectable()
export class DigestAiService {
  private readonly logger = new Logger(DigestAiService.name);

  constructor(private readonly gemini: GeminiService) {}

  isEnabled(): boolean {
    return this.gemini.isConfigured();
  }

  async enrichWeekly(
    base: WeeklyDigest,
    pack: WeeklyFactPack,
    locale: DigestLocale,
  ): Promise<WeeklyEnrichResult> {
    const template: WeeklyEnrichResult = {
      digest: base,
      dailyContent: [],
      provider: 'template',
      status: 'fallback',
      promptVersion: DIGEST_AI_PROMPT_VERSION,
    };
    if (!this.gemini.isConfigured()) return template;

    const expectedDates = pack.days.map((d) => d.date);
    const { system, user } = buildWeeklyDigestPrompt(pack);
    const result = await this.tryTwice(system, user, (raw) => {
      const v = validateWeeklyAiContent(raw, expectedDates);
      return v.ok ? { ok: true, value: v.value } : { ok: false, reason: v.reason };
    });
    if (!result.ok) {
      this.logger.warn(`Weekly digest AI fell back to template: ${result.reason}`);
      return { ...template, status: 'failed' };
    }
    return {
      digest: mergeWeeklyAiContent(base, result.value, locale),
      dailyContent: result.value.days,
      provider: 'gemini',
      status: 'generated',
      promptVersion: DIGEST_AI_PROMPT_VERSION,
    };
  }

  async enrichMonthly(
    base: MonthlyDigest,
    pack: MonthlyFactPack,
    locale: DigestLocale,
  ): Promise<MonthlyEnrichResult> {
    const template: MonthlyEnrichResult = {
      digest: base,
      provider: 'template',
      status: 'fallback',
      promptVersion: DIGEST_AI_PROMPT_VERSION,
    };
    if (!this.gemini.isConfigured()) return template;

    const { system, user } = buildMonthlyDigestPrompt(pack);
    const result = await this.tryTwice(system, user, (raw) => {
      const v = validateMonthlyAiContent(raw);
      return v.ok ? { ok: true, value: v.value } : { ok: false, reason: v.reason };
    });
    if (!result.ok) {
      this.logger.warn(`Monthly digest AI fell back to template: ${result.reason}`);
      return { ...template, status: 'failed' };
    }
    return {
      digest: mergeMonthlyAiContent(base, result.value, locale),
      provider: 'gemini',
      status: 'generated',
      promptVersion: DIGEST_AI_PROMPT_VERSION,
    };
  }

  /**
   * Call Gemini and validate; if the call errors or validation fails, retry exactly once. A
   * second failure returns the last reason so the caller can fall back to the template.
   */
  private async tryTwice<T>(
    system: string,
    user: string,
    validate: (raw: string) => { ok: true; value: T } | { ok: false; reason: string },
  ): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
    let lastReason = 'unknown';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const raw = await this.gemini.generateContent(system, user);
        const validated = validate(raw);
        if (validated.ok) return validated;
        lastReason = validated.reason;
      } catch (err) {
        lastReason = err instanceof Error ? err.message : String(err);
      }
    }
    return { ok: false, reason: lastReason };
  }
}
