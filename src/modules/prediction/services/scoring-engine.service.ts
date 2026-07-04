import { Injectable } from '@nestjs/common';
import { JyotishaScoringEngine } from '@subatime/jyotisha-engine';
import type { ScoredBlock, TimeBlock } from '@subatime/jyotisha-engine';
import { ChartService } from '../../astrology/services/chart.service';
import type { DayTransitDto } from './day-transits';

export type { DayTransitDto, DayTransitType } from './day-transits';
export type { ScoreParts, ScoredBlock } from '@subatime/jyotisha-engine';

/**
 * Thin NestJS wrapper around the pure `@subatime/jyotisha-engine` scoring engine.
 * Keep this file free of calculation logic — that lives in the engine package so it
 * can be reused outside this backend (and tested without NestJS).
 */
@Injectable()
export class ScoringEngineService {
  private readonly engine: JyotishaScoringEngine;

  constructor(private readonly chartService: ChartService) {
    this.engine = new JyotishaScoringEngine(chartService);
  }

  scoreBlocks(input: {
    blocks: TimeBlock[];
    lagna: string;
    nakshatra: string;
    date: Date;
    planetaryData: Record<string, unknown>;
    feedbackWeightAdjustment: number;
    primaryContextWeight?: number;
    chartData?: Record<string, unknown>;
    dataQuality?: number;
  }): ScoredBlock[] {
    return this.engine.scoreBlocks(input);
  }

  /**
   * Daily transit highlight cards. Pass `chartData` (natal ascendant/Moon/Sun longitudes) to get
   * real computed transit-Moon aspect cards; without it, falls back to the static (clearly
   * `degraded`) card pool. Pass lang='si' to receive Sinhala title + description (fallback only).
   */
  deriveDailyTransits(params: {
    date: Date;
    userId: string;
    onboardingIntent?: string | null;
    lagna: string;
    nakshatra: string;
    lang?: string;
    chartData?: Record<string, unknown>;
  }): DayTransitDto[] {
    return this.engine.deriveDailyTransits(params);
  }

  calculateConfidence(scored: ScoredBlock[], dataQuality = 0.85): number {
    return this.engine.calculateConfidence(scored, dataQuality);
  }
}
