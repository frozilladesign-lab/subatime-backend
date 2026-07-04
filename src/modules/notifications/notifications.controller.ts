import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import {
  AdminSendNotificationDto,
  ReportLocalScheduleDto,
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

  /** App reports its local block-notification schedule AFTER scheduling succeeds. */
  @Post('local-schedule')
  reportLocalSchedule(
    @CurrentUserId() userId: string,
    @Body() dto: ReportLocalScheduleDto,
  ) {
    return this.notificationsService.reportLocalSchedule(userId, dto);
  }

  @Post('admin/send')
  adminSend(@Body() dto: AdminSendNotificationDto) {
    return this.notificationsService.adminSend(dto);
  }
}
