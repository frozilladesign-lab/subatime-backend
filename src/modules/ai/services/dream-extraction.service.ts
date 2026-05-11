import { Injectable, Logger } from '@nestjs/common';
import {
  clamp01,
  DreamExtractionPayload,
  heuristicDreamExtraction,
} from '../../subatime/dream-engine';
import { GeminiService } from './gemini.service';

@Injectable()
export class DreamExtractionService {
  private readonly logger = new Logger(DreamExtractionService.name);

  constructor(private readonly gemini: GeminiService) {}

  /**
   * Gemini extracts structured tags only. Scores are computed separately in code.
   */
  async extractFromDreamText(text: string, lang: 'en' | 'si' = 'en'): Promise<DreamExtractionPayload | null> {
    const trimmed = text.trim();
    if (!trimmed || !this.gemini.isConfigured()) return null;

    const siRules =
      lang === 'si'
        ? [
            'language must be Sinhala: themes[], summary_line, grounding_tip, emotion — natural spoken Sinhala.',
            'Keep symbols[] snake_case English tokens and pattern_hints[] English snake_case for downstream logic.',
          ]
        : [];

    const systemInstruction = [
      'You structure dream journal text for a wellness reflection app.',
      'Return ONLY valid JSON. No markdown fences. No prose outside JSON.',
      'Do NOT diagnose medical or psychiatric conditions.',
      'Maps are subjective: intensity/negativity/clarity are the dreamer felt sense (0–1 floats).',
      'Use snake_case symbol tokens (e.g. chasing, dark_house, water).',
      ...siRules,
      'Schema:',
      '{',
      lang === 'si'
        ? '"emotion":"short Sinhala label",'
        : '"emotion":"short English label",',
      '"intensity":0-1,',
      '"negativity":0-1,',
      '"clarity":0-1,',
      '"symbols":["snake_case"],',
      lang === 'si'
        ? '"themes":["short Sinhala phrases"],'
        : '"themes":["short human phrases"],',
      '"pattern_hints":["anxiety|loss_of_control|performance_pressure|memory_processing|..."],',
      lang === 'si'
        ? '"summary_line":"one gentle reflective Sinhala sentence",'
        : '"summary_line":"one gentle reflective sentence",',
      lang === 'si'
        ? '"grounding_tip":"one concrete Sinhala self-care suggestion"'
        : '"grounding_tip":"one concrete self-care suggestion"',
      '}',
    ].join('\n');

    const userMessage = `Dream journal (${lang}):\n"""${trimmed.slice(0, 8000)}"""`;

    try {
      const raw = await this.gemini.generateContent(systemInstruction, userMessage);
      const parsed = this.parsePayload(raw, lang);
      if (parsed) return parsed;
      this.logger.warn('Gemini dream JSON parse failed; using heuristic extraction.');
      return null;
    } catch (e) {
      this.logger.warn(`Gemini dream extraction failed: ${String(e)}`);
      return null;
    }
  }

  extractHeuristic(text: string, lang: 'en' | 'si' = 'en'): DreamExtractionPayload {
    return heuristicDreamExtraction(text, lang);
  }

  private parsePayload(raw: string, lang: 'en' | 'si'): DreamExtractionPayload | null {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    let json: unknown;
    try {
      json = JSON.parse(match[0]);
    } catch {
      return null;
    }
    if (json == null || typeof json !== 'object') return null;
    const o = json as Record<string, unknown>;

    const emotion = this.toStr(o.emotion) || 'mixed';
    const intensity = clamp01(this.toNum(o.intensity, NaN));
    const negativity = clamp01(this.toNum(o.negativity, NaN));
    const clarity = clamp01(this.toNum(o.clarity, NaN));
    if (!Number.isFinite(intensity) || !Number.isFinite(negativity) || !Number.isFinite(clarity)) {
      return null;
    }

    const symbols = this.toStrList(o.symbols).map((s) =>
      s
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, ''),
    ).filter(Boolean);

    const themes = this.toStrList(o.themes).slice(0, 12);
    const patternHints = this.toStrList(o.pattern_hints ?? o.patternHints).slice(0, 12);
    let summaryLine = this.toStr(o.summary_line ?? o.summaryLine ?? o.summary);
    let groundingTip = this.toStr(o.grounding_tip ?? o.groundingTip ?? o.connection_tip);

    const fallback = heuristicDreamExtraction('', lang);
    if (!summaryLine) summaryLine = fallback.summary_line;
    if (!groundingTip) groundingTip = fallback.grounding_tip;

    return {
      emotion,
      intensity,
      negativity,
      clarity,
      symbols: symbols.slice(0, 24),
      themes: themes.length ? themes : symbols.map((s) => s.replace(/_/g, ' ')),
      pattern_hints: patternHints.length ? patternHints : symbols.slice(0, 8),
      summary_line: summaryLine,
      grounding_tip: groundingTip,
    };
  }

  private toStr(v: unknown): string {
    return typeof v === 'string' ? v.trim() : '';
  }

  private toNum(v: unknown, fallback: number): number {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const n = Number.parseFloat(v.trim());
      if (Number.isFinite(n)) return n;
    }
    return fallback;
  }

  private toStrList(v: unknown): string[] {
    if (!Array.isArray(v)) return [];
    return v.map((x) => (typeof x === 'string' ? x.trim() : String(x))).filter(Boolean);
  }
}
