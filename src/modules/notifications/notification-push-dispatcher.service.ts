import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { FirebasePushService } from '../push/firebase-push.service';
import { NotificationDeliveryService } from './notification-delivery.service';

const PENDING_BATCH = 40;

/**
 * Polls DB for due `NotificationJob` rows and sends via FCM (when Firebase is configured).
 * Complements BullMQ worker when Redis is unavailable.
 */
@Injectable()
export class NotificationPushDispatcherService {
  private readonly logger = new Logger(NotificationPushDispatcherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly firebasePush: FirebasePushService,
    private readonly delivery: NotificationDeliveryService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async dispatchDueJobs(): Promise<void> {
    if (!this.firebasePush.isReady()) {
      return;
    }

    const now = new Date();
    const jobs = await this.prisma.notificationJob.findMany({
      where: {
        status: 'pending',
        scheduledAt: { lte: now },
      },
      orderBy: { scheduledAt: 'asc' },
      take: PENDING_BATCH,
      select: { id: true },
    });

    for (const row of jobs) {
      try {
        await this.delivery.deliverJob(row.id);
      } catch (e) {
        this.logger.error(`Cron dispatch failed for job ${row.id}: ${String(e)}`);
      }
    }
  }
}
