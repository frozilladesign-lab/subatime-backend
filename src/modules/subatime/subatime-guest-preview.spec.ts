import { BadRequestException } from '@nestjs/common';
import { ChartService } from '../astrology/services/chart.service';
import { GeminiService } from '../ai/services/gemini.service';
import { DailyPredictionService } from '../prediction/services/daily-prediction.service';
import { ScoringEngineService } from '../prediction/services/scoring-engine.service';
import { FeedbackLearningService } from '../prediction/services/feedback-learning.service';
import { SubatimeService } from './subatime.service';

describe('GET /api/subatime/public/preview/day (guest preview)', () => {
  const samplePreview = {
    approximate: true,
    date: '2026-05-19',
    rating: 'good' as const,
    headline: 'Today feels steady.',
    bestWindow: 'Afternoon Push (14:00–16:00)',
    cautionWindow: 'Evening Start (18:00–20:00)',
    insight:
      'You may find balanced priorities more natural afternoon push around 14:00. This is a preview — add your exact birth time and place to refine it.',
    focusContext: 'overall',
    confidence: 0.72,
    reasoning: [],
  };

  const makeService = (previewImpl?: (birthDate: string, name?: string) => typeof samplePreview) => {
    const dailyPredictionService = {
      previewForBirthDate: jest.fn(previewImpl ?? (() => samplePreview)),
    } as unknown as DailyPredictionService;

    return new SubatimeService(
      dailyPredictionService,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  };

  it('returns approximate true and required fields for valid birthDate', () => {
    const service = makeService();
    const res = service.getGuestPreviewDay('1990-05-15', 'Sam');

    expect(res.data).toMatchObject({
      approximate: true,
      headline: expect.any(String),
      bestWindow: expect.any(String),
      cautionWindow: expect.any(String),
      insight: expect.any(String),
      rating: expect.any(String),
    });
    expect((res.data as typeof samplePreview).headline.length).toBeGreaterThan(0);
    expect((res.data as typeof samplePreview).insight.length).toBeGreaterThan(0);
  });

  it('throws BadRequestException when birthDate is missing', () => {
    const service = makeService();
    expect(() => service.getGuestPreviewDay('')).toThrow(BadRequestException);
    expect(() => service.getGuestPreviewDay('   ')).toThrow(BadRequestException);
  });

  it('throws BadRequestException when birthDate format is invalid', () => {
    const service = makeService();
    expect(() => service.getGuestPreviewDay('05-15-1990')).toThrow(BadRequestException);
    expect(() => service.getGuestPreviewDay('1990/05/15')).toThrow(BadRequestException);
    expect(() => service.getGuestPreviewDay('not-a-date')).toThrow(BadRequestException);
  });

  it('delegates to DailyPredictionService.previewForBirthDate', () => {
    const daily = {
      previewForBirthDate: jest.fn(() => samplePreview),
    } as unknown as DailyPredictionService;
    const service = new SubatimeService(
      daily,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    service.getGuestPreviewDay('2000-01-01', 'Alex');
    expect(daily.previewForBirthDate).toHaveBeenCalledWith('2000-01-01', 'Alex');
  });
});

describe('DailyPredictionService.previewForBirthDate', () => {
  it('computes preview with approximate flag (integration)', () => {
    const chartService = new ChartService();
    const scoringEngine = new ScoringEngineService(chartService);
    const prisma = {} as any;
    const feedbackLearning = new FeedbackLearningService(prisma);
    const gemini = { isConfigured: () => false } as unknown as GeminiService;

    const service = new DailyPredictionService(
      prisma,
      chartService,
      { enqueueSendNotification: jest.fn() } as any,
      scoringEngine,
      feedbackLearning,
      gemini,
    );

    const preview = service.previewForBirthDate('1992-07-14', 'Guest');

    expect(preview.approximate).toBe(true);
    expect(preview.headline).toEqual(expect.any(String));
    expect(preview.bestWindow).toEqual(expect.any(String));
    expect(preview.cautionWindow).toEqual(expect.any(String));
    expect(preview.insight).toEqual(expect.any(String));
    expect(['great', 'good', 'mixed', 'tense']).toContain(preview.rating);
  });
});
