import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class FeedbackLearningService {
  constructor(private readonly prisma: PrismaService) {}

  async getUserContextWeights(userId: string): Promise<Record<string, number>> {
    const defaults: Record<string, number> = {
      overall: 0.7,
      career: 0.5,
      love: 0.5,
      health: 0.5,
    };

    const grouped = await this.prisma.predictionFeedback.groupBy({
      by: ['contextType', 'feedback'],
      where: { userId },
      _count: { _all: true },
    });

    const totals: Record<string, { good: number; total: number }> = {};
    for (const item of grouped) {
      const context = item.contextType ?? 'overall';
      const current = totals[context] ?? { good: 0, total: 0 };
      current.total += item._count._all;
      if (item.feedback === 'good') {
        current.good += item._count._all;
      }
      totals[context] = current;
    }

    for (const context of Object.keys(defaults)) {
      const bucket = totals[context];
      if (!bucket || bucket.total === 0) continue;
      // Keep weights bounded so one context does not dominate too aggressively.
      const ratio = bucket.good / bucket.total;
      defaults[context] = Number(Math.min(0.95, Math.max(0.2, ratio)).toFixed(4));
    }

    return defaults;
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

    const total = goodCount + badCount;
    if (total === 0) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { accuracyScore: 0.5 },
      });
      return 0.5;
    }

    const raw = (goodCount - badCount) / total;
    const normalized = 0.5 + raw * 0.5;
    const accuracyScore = Number(Math.min(0.8, Math.max(0.2, normalized)).toFixed(4));

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
    // Keep chart-derived scoring anchored; feedback tweaks margins only (±~3%).
    return Number((1 + (accuracy - 0.5) * 0.06).toFixed(4));
  }
}
