import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { UserService } from '../user/user.service';
import { FirebasePushService, isUnregisteredFcmError } from '../push/firebase-push.service';

@Injectable()
export class NotificationDeliveryService {
  private readonly logger = new Logger(NotificationDeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly firebasePush: FirebasePushService,
    private readonly userService: UserService,
  ) {}

  /**
   * Delivers a single notification job to all device tokens for its user.
   * Marks job `sent` if at least one device succeeds, `failed` otherwise.
   */
  async deliverJob(jobId: string): Promise<void> {
    const notification = await this.prisma.notificationJob.findUnique({
      where: { id: jobId },
    });

    if (!notification) {
      this.logger.warn(`Notification job ${jobId} no longer exists`);
      return;
    }

    if (notification.status === 'sent') {
      return;
    }
    if (notification.status === 'failed') {
      return;
    }

    const tokens = await this.prisma.userDeviceToken.findMany({
      where: { userId: notification.userId },
      select: { token: true, platform: true },
    });

    if (tokens.length === 0) {
      await this.failJob(jobId, 'failed:no_device_tokens');
      this.logger.warn(`No device tokens for user ${notification.userId} (job ${jobId})`);
      return;
    }

    if (!this.firebasePush.isReady()) {
      throw new Error('Firebase messaging is not configured');
    }

    const payload = notification.payload as Record<string, unknown>;
    const body = String(payload.body ?? payload.summary ?? 'Your daily guidance is ready.');
    const title = String(payload.title ?? 'SubaTime');
    const data: Record<string, string> = {
      jobId,
      type: String(notification.type),
    };
    const fcmExtra = payload.fcmData;
    if (fcmExtra != null && typeof fcmExtra === 'object' && !Array.isArray(fcmExtra)) {
      for (const [k, v] of Object.entries(fcmExtra as Record<string, unknown>)) {
        if (v === undefined || v === null) continue;
        data[String(k)] = String(v);
      }
    }

    try {
      const tokenStrings = tokens.map((t) => t.token);
      const batch = await this.firebasePush.sendEachToTokens({
        tokens: tokenStrings,
        title,
        body,
        data,
      });

      let successCount = 0;
      for (let i = 0; i < batch.responses.length; i++) {
        const r = batch.responses[i];
        const token = tokenStrings[i];
        if (r.success) {
          successCount += 1;
          continue;
        }
        const code = r.error?.code;
        if (isUnregisteredFcmError(code)) {
          await this.userService.removePushTokenByValue(token);
          await this.prisma.notificationLog.create({
            data: {
              jobId,
              deliveryStatus: `token_pruned:${code}`,
            },
          });
          continue;
        }
        this.logger.warn(`FCM error for job ${jobId} token …${token.slice(-8)}: ${code ?? r.error?.message}`);
      }

      if (successCount > 0) {
        await this.prisma.notificationJob.update({
          where: { id: jobId },
          data: { status: 'sent' },
        });
        await this.prisma.notificationLog.create({
          data: {
            jobId,
            deliveryStatus: `sent:devices=${successCount}/${tokenStrings.length}`,
          },
        });
        return;
      }

      await this.failJob(jobId, 'failed:no_successful_deliveries');
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown_error';
      this.logger.error(`Delivery failed for job ${jobId}: ${reason}`);
      await this.failJob(jobId, `failed:${reason}`);
      throw error;
    }
  }

  private async failJob(jobId: string, deliveryStatus: string): Promise<void> {
    await this.prisma.notificationJob.update({
      where: { id: jobId },
      data: { status: 'failed' },
    });
    await this.prisma.notificationLog.create({
      data: { jobId, deliveryStatus },
    });
  }
}
