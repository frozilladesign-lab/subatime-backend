import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

type NotificationQueuePayload = {
  jobId: string;
};

@Injectable()
export class NotificationQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(NotificationQueueService.name);
  private readonly connection?: IORedis;
  private readonly queue?: Queue<NotificationQueuePayload>;
  private readonly isEnabled: boolean;

  constructor() {
    const redisUrl = process.env.REDIS_URL;
    this.isEnabled = Boolean(redisUrl);

    if (!redisUrl) {
      this.logger.warn('REDIS_URL is not set. Queue dispatch is disabled.');
      return;
    }

    this.connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.connection.on('error', (error) => {
      this.logger.error(`Redis queue connection error: ${error.message}`);
    });
    this.queue = new Queue<NotificationQueuePayload>('notification-queue', {
      connection: this.connection,
    });
  }

  async enqueueSendNotification(jobId: string, scheduledAt: Date): Promise<void> {
    if (!this.isEnabled || !this.queue) {
      return;
    }

    const delay = Math.max(0, scheduledAt.getTime() - Date.now());

    await this.queue.add(
      'send-notification',
      { jobId },
      {
        delay,
        attempts: 5,
        backoff: { type: 'exponential', delay: 300000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );

    this.logger.log(`Queued notification job ${jobId} with delay ${delay}ms`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
    }
    if (this.connection) {
      await this.connection.quit();
    }
  }
}
