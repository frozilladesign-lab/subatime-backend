import { Injectable, NotFoundException } from '@nestjs/common';
import { okResponse } from '../../common/utils/response.util';
import { PrismaService } from '../../database/prisma.service';
import { NotificationType } from '@prisma/client';
import { NotificationQueueService } from './queue/notification.queue';
import {
  AdminSendNotificationDto,
  NotificationLogsQueryDto,
  RegisterDeviceDto,
  ScheduleNotificationDto,
} from './dto/notifications.dto';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: NotificationQueueService,
  ) {}

  async schedule(dto: ScheduleNotificationDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException(`User not found for id ${dto.userId}`);
    }
    const scheduleAt = this.parseSchedule(dto.scheduleAt);
    const type = (dto.type ?? 'event') as NotificationType;
    const job = await this.prisma.notificationJob.upsert({
      where: {
        userId_type_scheduledAt: {
          userId: dto.userId,
          type,
          scheduledAt: scheduleAt,
        },
      },
      update: {
        payload: { title: dto.title, body: dto.body },
        status: 'pending',
      },
      create: {
        userId: dto.userId,
        type,
        scheduledAt: scheduleAt,
        status: 'pending',
        payload: { title: dto.title, body: dto.body },
      },
    });
    await this.queue.enqueueSendNotification(job.id, scheduleAt);
    return okResponse(
      {
        notificationId: job.id,
        status: job.status,
        scheduleAt: job.scheduledAt.toISOString(),
        queued: true,
      },
      'Notification scheduled',
    );
  }

  async adminSend(dto: AdminSendNotificationDto) {
    const users = dto.userIds?.length
      ? await this.prisma.user.findMany({
          where: { id: { in: dto.userIds } },
          select: { id: true },
        })
      : await this.prisma.user.findMany({ select: { id: true } });

    const scheduleAt = this.parseSchedule(dto.scheduleAt);
    const type = (dto.type ?? 'event') as NotificationType;
    let queued = 0;
    for (const user of users) {
      const job = await this.prisma.notificationJob.upsert({
        where: {
          userId_type_scheduledAt: {
            userId: user.id,
            type,
            scheduledAt: scheduleAt,
          },
        },
        update: {
          status: 'pending',
          payload: { title: dto.title, body: dto.body, source: 'admin_manual' },
        },
        create: {
          userId: user.id,
          type,
          scheduledAt: scheduleAt,
          status: 'pending',
          payload: { title: dto.title, body: dto.body, source: 'admin_manual' },
        },
      });
      await this.queue.enqueueSendNotification(job.id, scheduleAt);
      queued += 1;
    }
    return okResponse(
      {
        queued,
        targetUsers: users.length,
        scheduleAt: scheduleAt.toISOString(),
      },
      'Admin notification dispatch queued',
    );
  }

  async registerDevice(dto: RegisterDeviceDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException(`User not found for id ${dto.userId}`);
    }

    const device = await this.prisma.userDeviceToken.upsert({
      where: { token: dto.token },
      update: {
        userId: dto.userId,
        platform: dto.platform,
      },
      create: {
        userId: dto.userId,
        token: dto.token,
        platform: dto.platform,
      },
    });

    return okResponse(
      {
        id: device.id,
        userId: device.userId,
        token: device.token,
        platform: device.platform,
      },
      'Device token registered',
    );
  }

  async getLogs(userId: string, query: NotificationLogsQueryDto) {
    const take = Math.min(50, Math.max(1, Number(query.limit ?? 20)));
    const logs = await this.prisma.notificationLog.findMany({
      where: {
        notificationJob: {
          userId,
          ...(query.type ? { type: query.type } : {}),
        },
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      orderBy: { sentAt: 'desc' },
      take,
      include: {
        notificationJob: {
          select: {
            type: true,
            payload: true,
            status: true,
            scheduledAt: true,
          },
        },
      },
    });

    return okResponse(
      {
        items: logs,
        nextCursor: logs.length == take ? logs[logs.length - 1]?.id ?? null : null,
      },
      'Notification logs fetched',
    );
  }

  private parseSchedule(input?: string): Date {
    if (!input) return new Date();
    const parsed = new Date(input);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }
}
