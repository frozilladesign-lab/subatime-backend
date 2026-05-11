import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';

const RETENTION_MS = 90 * 86_400_000;

@Injectable()
export class WellnessSnapshotRetentionService {
  private readonly logger = new Logger(WellnessSnapshotRetentionService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purgeOlderThan90Days(): Promise<void> {
    const cutoff = new Date(Date.now() - RETENTION_MS);
    const r = await this.prisma.wellnessSnapshot.deleteMany({
      where: { recordedAt: { lt: cutoff } },
    });
    if (r.count > 0) {
      this.logger.log(`Purged ${r.count} wellness snapshot(s) older than 90 days`);
    }
  }
}
