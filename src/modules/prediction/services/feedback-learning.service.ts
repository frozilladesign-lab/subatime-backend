import { Injectable } from '@nestjs/common';
import {
  accuracyScoreFromCounts,
  contextWeightsFromCounts,
  weightAdjustmentFromAccuracy,
  type FeedbackContextCounts,
} from '@subatime/jyotisha-engine';
import { PrismaService } from '../../../database/prisma.service';

/**
 * Reads prediction feedback / user accuracy from the DB and hands plain counts to the pure
 * weighting math in `@subatime/jyotisha-engine`. Keep DB access here; keep math in the engine.
 */
@Injectable()
export class FeedbackLearningService {
  constructor(private readonly prisma: PrismaService) {}

  async getUserContextWeights(userId: string): Promise<Record<string, number>> {
    const grouped = await this.prisma.predictionFeedback.groupBy({
      by: ['contextType', 'feedback'],
      where: { userId },
      _count: { _all: true },
    });

    const counts: FeedbackContextCounts = {};
    for (const item of grouped) {
      const context = item.contextType ?? 'overall';
      const bucket = counts[context] ?? { good: 0, total: 0 };
      bucket.total += item._count._all;
      if (item.feedback === 'good') {
        bucket.good += item._count._all;
      }
      counts[context] = bucket;
    }

    return contextWeightsFromCounts(counts);
  }

  async recomputeUserAccuracy(userId: string): Promise<number> {
    const [goodCount, badCount] = await Promise.all([
      this.prisma.predictionFeedback.count({
        where: { userId, feedback: 'good' },
      }),
      this.prisma.predictionFeedback.count({
        where: { userId, feedback: 'bad' },
      }),
    ]);

    const accuracyScore = accuracyScoreFromCounts(goodCount, badCount);

    await this.prisma.user.update({
      where: { id: userId },
      data: { accuracyScore },
    });
    return accuracyScore;
  }

  async getWeightAdjustment(userId: string): Promise<number> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { accuracyScore: true },
    });
    const accuracy = user?.accuracyScore ?? 0.5;
    return weightAdjustmentFromAccuracy(accuracy);
  }
}
