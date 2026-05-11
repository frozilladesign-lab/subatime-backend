import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import {
  AdminSendNotificationDto,
  NotificationLogsQueryDto,
  RegisterDeviceDto,
  ScheduleNotificationDto,
} from './dto/notifications.dto';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('schedule')
  schedule(@Body() dto: ScheduleNotificationDto) {
    return this.notificationsService.schedule(dto);
  }

  @Post('admin/send')
  adminSend(@Body() dto: AdminSendNotificationDto) {
    return this.notificationsService.adminSend(dto);
  }

  @Post('register-device')
  registerDevice(@Body() dto: RegisterDeviceDto) {
    return this.notificationsService.registerDevice(dto);
  }

  @Get('logs')
  logs(
    @CurrentUserId() userId: string,
    @Query() query: NotificationLogsQueryDto,
  ) {
    return this.notificationsService.getLogs(userId, query);
  }
}
