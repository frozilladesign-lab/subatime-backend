import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaService } from '../../../database/prisma.service';
import { NotificationDeliveryService } from '../notification-delivery.service';

type NotificationQueuePayload = {
  jobId: string;
};

@Injectable()
export class NotificationWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationWorkerService.name);
  private readonly redisUrl = process.env.REDIS_URL;
  private readonly connection = this.redisUrl
    ? new IORedis(this.redisUrl, { maxRetriesPerRequest: null })
    : undefined;
  private worker?: Worker<NotificationQueuePayload>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly delivery: NotificationDeliveryService,
  ) {}

  onModuleInit(): void {
    if (!this.connection) {
      this.logger.warn('REDIS_URL is not set. Notification worker is disabled.');
      return;
    }

    this.connection.on('error', (error) => {
      this.logger.error(`Redis worker connection error: ${error.message}`);
    });

    this.worker = new Worker<NotificationQueuePayload>(
      'notification-queue',
      async (job) => this.processJob(job.data.jobId),
      { connection: this.connection },
    );

    this.worker.on('failed', (job, error) => {
      this.logger.error(`Queue job failed ${job?.id ?? 'unknown'}: ${error.message}`);
      const attempts = job?.opts?.attempts ?? 1;
      const attemptsMade = job?.attemptsMade ?? 0;
      const jobId = job?.data?.jobId;
      if (jobId && attemptsMade >= attempts) {
        void this.prisma.notificationLog.create({
          data: {
            jobId,
            deliveryStatus: `failed:dead_letter:${error.message}`,
          },
        });
      }
    });
  }

  private async processJob(jobId: string): Promise<void> {
    await this.delivery.deliverJob(jobId);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
    }
    if (this.connection) {
      await this.connection.quit();
    }
  }
}
