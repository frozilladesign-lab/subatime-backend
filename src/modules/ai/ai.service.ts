import { Injectable, Logger } from '@nestjs/common';
import { okResponse } from '../../common/utils/response.util';
import { PrismaService } from '../../database/prisma.service';
import { ChartService } from '../astrology/services/chart.service';
import { GenerateChartDto } from '../astrology/dto/astrology.dto';
import { MatchingService } from '../matching/matching.service';
import {
  AiChartImageDto,
  AiChatDto,
  AiCompatibilityNarrativeDto,
  AiDayPlannerDto,
  AiGlossaryDto,
  AiLocalizeDto,
  AiPolishDto,
  AiReflectionDto,
} from './dto/ai.dto';
import { GeminiService } from './services/gemini.service';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chartService: ChartService,
    private readonly gemini: GeminiService,
    private readonly matchingService: MatchingService,
  ) {}

  async chat(userId: string, dto: AiChatDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { birthProfile: true },
    });

    if (!user?.birthProfile) {
      return okResponse(
        {
          prompt: dto.prompt,
          reply:
            'Save your birth date, time, and birthplace under Profile first — then interpretations anchor on your sidereal lagna and nakshatra.',
          usedAstrologyContext: false,
          usedGemini: false,
        },
        'AI guidance pending birth profile',
      );
    }

    const bp = user.birthProfile;
    const gen: GenerateChartDto = {
      fullName: user.name,
      birthDate: bp.dateOfBirth.toISOString().slice(0, 10),
      birthTime: bp.timeOfBirth.toISOString().slice(11, 16),
      birthPlace: bp.placeOfBirth,
      latitude: bp.latitude,
      longitude: bp.longitude,
      timezone: bp.timezone ?? undefined,
    };

    const chart = this.chartService.generate(gen);
    const planets = chart.planetaryData as Record<string, string>;
    const chartData = chart.chartData as Record<string, unknown>;
    const planetHouses = chartData.planetHouses as Record<string, number> | undefined;

    const snapshot = {
      lagna: chart.lagna,
      nakshatra: chart.nakshatra,
      planetarySidereal: planets,
      planetHouses,
      placeOfBirth: bp.placeOfBirth,
      onboardingIntent: bp.onboardingIntent ?? null,
      calculationNote:
        'Sidereal whole-sign style from the app rule-engine; not a human astrologer.',
    };

    let usedGemini = false;
    let reply: string;

    if (this.gemini.isConfigured()) {
      try {
        const system = [
          'You are Subatime’s astrology assistant.',
          'Rules:',
          '- Use ONLY the JSON snapshot below for factual chart statements (signs, houses, lagna, nakshatra). Do not invent birth data.',
          '- If the user asks something not supported by the snapshot, say so briefly.',
          '- Tone: practical, respectful, non-alarmist; 2–4 short paragraphs max.',
          '- Do not claim medical or legal authority.',
          '',
          'Chart snapshot (JSON):',
          JSON.stringify(snapshot),
        ].join('\n');

        reply = await this.gemini.generateContent(system, dto.prompt.trim());
        usedGemini = true;
      } catch (e) {
        this.logger.warn(`Gemini failed, using rule fallback: ${String(e)}`);
        reply = this.ruleBasedReply(chart, planets, planetHouses, bp.onboardingIntent, dto.prompt);
      }
    } else {
      reply = this.ruleBasedReply(chart, planets, planetHouses, bp.onboardingIntent, dto.prompt);
    }

    return okResponse(
      {
        prompt: dto.prompt,
        reply: reply.trim(),
        meta: {
          lagna: chart.lagna,
          nakshatra: chart.nakshatra,
          planetarySidereal: planets,
        },
        usedAstrologyContext: true,
        usedGemini,
      },
      usedGemini ? 'Guidance generated (Gemini)' : 'Guidance generated',
    );
  }

  async glossary(userId: string, dto: AiGlossaryDto) {
    const ctx = await this.chartSnapshotForUser(userId);
    if (!ctx) {
      return okResponse(
        {
          term: dto.term,
          explanation:
            'Save your birth profile first — glossary entries are personalized against your sidereal chart snapshot.',
          usedGemini: false,
        },
        'Glossary pending birth profile',
      );
    }

    let explanation: string;
    let usedGemini = false;
    const term = dto.term.trim();
    if (this.gemini.isConfigured()) {
      try {
        const system = [
          'You explain one astrology term for an app user.',
          'Use ONLY the chart snapshot JSON for personalized ties (lagna, nakshatra, houses).',
          'Plain English, 3–6 sentences. No markdown. No medical/legal claims.',
          `Snapshot: ${JSON.stringify(ctx.snapshot)}`,
        ].join('\n');
        explanation = await this.gemini.generateContent(
          system,
          `Explain the term "${term}" for this user.`,
        );
        usedGemini = true;
      } catch (e) {
        this.logger.warn(`Gemini glossary failed: ${String(e)}`);
        explanation = this.ruleGlossary(term, ctx.chart.lagna, ctx.chart.nakshatra);
      }
    } else {
      explanation = this.ruleGlossary(term, ctx.chart.lagna, ctx.chart.nakshatra);
    }

    return okResponse({ term, explanation: explanation.trim(), usedGemini }, 'Glossary entry');
  }

  async dayPlanner(userId: string, dto: AiDayPlannerDto) {
    const ctx = await this.chartSnapshotForUser(userId);
    const today = this.utcDateOnly(new Date());
    const pred = await this.prisma.dailyPrediction.findUnique({
      where: {
        userId_date: { userId, date: today },
      },
    });

    const windows = pred
      ? {
          summary: pred.summary,
          goodTimes: pred.goodTimes,
          badTimes: pred.badTimes,
          confidenceScore: pred.confidenceScore,
        }
      : null;

    const facts = {
      intent: dto.intent.trim(),
      activity: dto.activity?.trim() ?? null,
      chartSnapshot: ctx?.snapshot ?? null,
      scoredDay: windows,
    };

    let plan: string;
    let usedGemini = false;

    if (this.gemini.isConfigured()) {
      try {
        const system = [
          'You write a short day plan for a scheduling app.',
          'Rules:',
          '- Prefer goodTimes windows for important moves; avoid stacking heavy asks in badTimes.',
          '- If scoredDay is null, give gentle generic pacing advice tied only to chartSnapshot.',
          '- Do not invent clock times outside the provided windows.',
          '- Plain text, 3–7 short lines, no markdown.',
          `Facts JSON: ${JSON.stringify(facts)}`,
        ].join('\n');
        plan = await this.gemini.generateContent(system, 'Draft today’s plan for the user.');
        usedGemini = true;
      } catch (e) {
        this.logger.warn(`Gemini day planner failed: ${String(e)}`);
        plan = this.ruleDayPlan(dto.intent, windows);
      }
    } else {
      plan = this.ruleDayPlan(dto.intent, windows);
    }

    return okResponse({ plan: plan.trim(), usedGemini }, 'Day planner');
  }

  async compatibilityNarrative(userId: string, dto: AiCompatibilityNarrativeDto) {
    void userId;
    const { data: compat } = this.matchingService.compare({
      profileA: dto.profileA,
      profileB: dto.profileB,
    });

    let narrative: string;
    let usedGemini = false;

    if (this.gemini.isConfigured()) {
      try {
        const system = [
          'You narrate compatibility for two profiles in a dating/wellness app.',
          'The JSON is authoritative for scores and bullet recommendations.',
          'Write 2 short paragraphs: strengths first, then growth edges.',
          'Warm, non-alarmist; no fortune guarantees; no medical/legal claims.',
          `Structured compatibility JSON: ${JSON.stringify(compat)}`,
        ].join('\n');
        narrative = await this.gemini.generateContent(
          system,
          'Write the narrative for this pair.',
        );
        usedGemini = true;
      } catch (e) {
        this.logger.warn(`Gemini compat narrative failed: ${String(e)}`);
        narrative = [compat.summary, ...(compat.recommendations ?? [])].join(' ');
      }
    } else {
      narrative = [compat.summary, ...(compat.recommendations ?? [])].join(' ');
    }

    return okResponse(
      {
        narrative: narrative.trim(),
        structured: compat,
        usedGemini,
      },
      'Compatibility narrative',
    );
  }

  async reflection(userId: string, dto: AiReflectionDto) {
    void userId;
    let reflection: string;
    let usedGemini = false;

    const moodLine = dto.mood?.trim() ? `Mood tag: ${dto.mood.trim()}` : '';

    if (this.gemini.isConfigured()) {
      try {
        const system = [
          'You help users reflect on their day in a grounded journaling tone.',
          'No astrology fortune-telling; no predicting events.',
          'Offer 3 thoughtful prompts + 2 sentences mirroring their note supportively.',
          'Plain text, no markdown.',
        ].join('\n');
        reflection = await this.gemini.generateContent(
          system,
          [`User note:`, dto.userNote.trim(), moodLine].join('\n'),
        );
        usedGemini = true;
      } catch (e) {
        this.logger.warn(`Gemini reflection failed: ${String(e)}`);
        reflection = this.ruleReflection(dto.userNote, dto.mood);
      }
    } else {
      reflection = this.ruleReflection(dto.userNote, dto.mood);
    }

    return okResponse({ reflection: reflection.trim(), usedGemini }, 'Reflection');
  }

  async chartImageHints(_userId: string, dto: AiChartImageDto) {
    let hints: string;
    let usedGemini = false;

    if (!this.gemini.isConfigured()) {
      return okResponse(
        {
          hints:
            'Add GEMINI_API_KEY to enable chart-image hints. Always confirm extracted birth data manually.',
          usedGemini: false,
        },
        'Chart image hints unavailable',
      );
    }

    try {
      const system = [
        'The user uploaded an astrology chart screenshot.',
        'Reply ONLY with compact JSON keys: detectedLabels (string[]), suggestedDateOfBirth (YYYY-MM-DD or empty),',
        'suggestedTime24h (HH:mm or empty), suggestedPlace (string or empty), confidenceNote (string).',
        'If unreadable, return empty strings/arrays and explain in confidenceNote.',
        'Never claim certainty.',
      ].join('\n');
      hints = await this.gemini.generateContentWithImage(
        system,
        'Extract onboarding hints from this image.',
        dto.imageBase64,
        dto.mimeType,
      );
      usedGemini = true;
    } catch (e) {
      this.logger.warn(`Gemini chart image failed: ${String(e)}`);
      hints = JSON.stringify({
        detectedLabels: [],
        suggestedDateOfBirth: '',
        suggestedTime24h: '',
        suggestedPlace: '',
        confidenceNote: 'Could not read chart image. Try a clearer screenshot.',
      });
    }

    return okResponse({ hints, usedGemini }, 'Chart image hints');
  }

  async polish(userId: string, dto: AiPolishDto) {
    void userId;
    let polished: string;
    let usedGemini = false;

    if (this.gemini.isConfigured()) {
      try {
        const system =
          dto.kind === 'notification'
            ? [
                'Rewrite notification body copy for a wellness app.',
                'Max length 160 characters. Single sentence. No ALL CAPS scare tactics.',
                'No medical/legal promises.',
              ].join('\n')
            : [
                'Polish user-visible astrology copy: calm, respectful, non-alarmist.',
                'Preserve factual meaning; do not add new predictions.',
              ].join('\n');
        polished = await this.gemini.generateContent(system, dto.text.trim());
        usedGemini = true;
        if (dto.kind === 'notification' && polished.length > 200) {
          polished = polished.slice(0, 200);
        }
      } catch (e) {
        this.logger.warn(`Gemini polish failed: ${String(e)}`);
        polished = dto.text.trim();
      }
    } else {
      polished = dto.text.trim();
    }

    return okResponse({ polished: polished.trim(), usedGemini }, 'Polish');
  }

  async localize(userId: string, dto: AiLocalizeDto) {
    void userId;
    let translated: string;
    let usedGemini = false;

    if (this.gemini.isConfigured()) {
      try {
        const system = [
          `Translate the following text to locale "${dto.locale}".`,
          'Keep proper nouns for zodiac names if conventional in target language.',
          'Preserve line breaks approximately; no markdown.',
        ].join('\n');
        translated = await this.gemini.generateContent(system, dto.text.trim());
        usedGemini = true;
      } catch (e) {
        this.logger.warn(`Gemini localize failed: ${String(e)}`);
        translated = dto.text.trim();
      }
    } else {
      translated = dto.text.trim();
    }

    return okResponse({ translated: translated.trim(), locale: dto.locale, usedGemini }, 'Localized');
  }

  private utcDateOnly(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }

  private async chartSnapshotForUser(userId: string): Promise<{
    snapshot: Record<string, unknown>;
    chart: ReturnType<ChartService['generate']>;
  } | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { birthProfile: true },
    });
    if (!user?.birthProfile) return null;

    const bp = user.birthProfile;
    const gen: GenerateChartDto = {
      fullName: user.name,
      birthDate: bp.dateOfBirth.toISOString().slice(0, 10),
      birthTime: bp.timeOfBirth.toISOString().slice(11, 16),
      birthPlace: bp.placeOfBirth,
      latitude: bp.latitude,
      longitude: bp.longitude,
      timezone: bp.timezone ?? undefined,
    };

    const chart = this.chartService.generate(gen);
    const planets = chart.planetaryData as Record<string, string>;
    const chartData = chart.chartData as Record<string, unknown>;
    const planetHouses = chartData.planetHouses as Record<string, number> | undefined;

    return {
      chart,
      snapshot: {
        lagna: chart.lagna,
        nakshatra: chart.nakshatra,
        planetarySidereal: planets,
        planetHouses,
        onboardingIntent: bp.onboardingIntent ?? null,
      },
    };
  }

  private ruleGlossary(term: string, lagna: string, nakshatra: string): string {
    const t = term.toLowerCase();
    if (t.includes('lagna') || t.includes('ascendant')) {
      return `${term}: your rising anchor — for you it is sidereal ${lagna}. It colours first impressions and how you initiate situations; pair it with ${nakshatra} pacing when timing moves.`;
    }
    if (t.includes('nakshatra')) {
      return `${term}: lunar mansion emphasis — yours is ${nakshatra}. It often speaks to emotional rhythm and how momentum builds across the lunar month.`;
    }
    return `${term}: anchor any interpretation to your saved sidereal chart (${lagna} lagna, ${nakshatra}). Ask in AI chat for placement-specific wording once your chart snapshot is saved.`;
  }

  private ruleDayPlan(
    intent: string,
    windows: {
      summary: string;
      goodTimes: unknown;
      badTimes: unknown;
      confidenceScore: number;
    } | null,
  ): string {
    if (!windows) {
      return `Intent “${intent}”: pace steadily today — generate today’s prediction first for timed windows. Hydrate, sequence tasks, and leave buffer between commitments.`;
    }
    return [
      `Intent: ${intent}`,
      `Forecast (${(windows.confidenceScore * 100).toFixed(0)}% confidence): ${windows.summary}`,
      'Lean into your highlighted good windows for momentum; treat caution windows as planning/review rather than confrontation.',
    ].join('\n');
  }

  private ruleReflection(note: string, mood?: string): string {
    const m = mood?.trim() ? ` (${mood.trim()})` : '';
    return [
      `Thanks for checking in${m}.`,
      'Three prompts: What felt most aligned with your intention today? What drained you unnecessarily? What tiny reset helps tonight?',
      `You wrote: “${note.slice(0, 240)}${note.length > 240 ? '…' : ''}” — carry one concrete kindness into tomorrow’s first hour.`,
    ].join('\n');
  }

  private ruleBasedReply(
    chart: {
      lagna: string;
      nakshatra: string;
    },
    planets: Record<string, string>,
    planetHouses: Record<string, number> | undefined,
    onboardingIntent: string | null,
    prompt: string,
  ): string {
    const pLower = prompt.toLowerCase();
    let reply = this.templateOpening(chart.lagna, chart.nakshatra, planets, planetHouses);

    if (/love|relationship|partner|marriage/.test(pLower)) {
      reply += ` Relationship pacing responds strongly to ${planets.moon ?? 'Moon'} and ${planets.venus ?? 'Venus'} placements — favour sincere wording over ambiguous hints today.`;
    } else if (/career|work|money|business/.test(pLower)) {
      reply += ` Career pacing aligns with ${planets.sun ?? 'Sun'} discipline and ${planets.mars ?? 'Mars'} execution windows — sequence commitments instead of stacking risky leaps.`;
    } else if (/health|rest|sleep|stress/.test(pLower)) {
      reply += ` Vitality signals emphasise nervous-system pacing traced through ${planets.moon ?? 'Moon'} — protect hydration and recovery cadence before pushing intensity.`;
    } else if (/spirit|purpose|meaning/.test(pLower)) {
      reply += ` Meaning-making lifts through ${chart.nakshatra} nakshatra tone — revisit rituals that feel embodied rather than performative.`;
    } else {
      reply += ` Ask narrower follow-ups (love / career / health) for sharper layering against today’s transits.`;
    }

    if (onboardingIntent) {
      reply += ` (Weighted lens from onboarding focus: ${onboardingIntent}.)`;
    }

    return reply;
  }

  private templateOpening(
    lagna: string,
    nakshatra: string,
    planets: Record<string, string>,
    planetHouses: Record<string, number> | undefined,
  ): string {
    const mh = planetHouses?.moon;
    const moonFrag =
      mh != null
        ? `Moon sits in whole-sign house ${mh} (${planets.moon ?? '—'})`
        : `${planets.moon ?? 'Moon'} anchors emotional pacing`;

    return (
      `Sidereal snapshot — ${lagna} Lagna with ${nakshatra}: Sun sits in ${planets.sun ?? 'Mesha'}, ${moonFrag}, ` +
      `Mercury ${planets.mercury ?? '—'}, Venus ${planets.venus ?? '—'}, Mars ${planets.mars ?? '—'}, Jupiter ${planets.jupiter ?? '—'}, Saturn ${planets.saturn ?? '—'}.`
    );
  }
}
