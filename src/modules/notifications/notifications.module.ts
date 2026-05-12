import { Module } from '@nestjs/common';
import { CalendarModule } from '../calendar/calendar.module';
import { NotificationDeliveryService } from './notification-delivery.service';
import { NotificationPushDispatcherService } from './notification-push-dispatcher.service';
import { ProactiveHoraPushSchedulerService } from './proactive-hora-push.scheduler';
import { PredictionWindowPushSchedulerService } from './prediction-window-push.scheduler';
import { NotificationQueueService } from './queue/notification.queue';
import { NotificationWorkerService } from './queue/notification.worker';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushModule } from '../push/push.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [PushModule, UserModule, CalendarModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationDeliveryService,
    NotificationPushDispatcherService,
    ProactiveHoraPushSchedulerService,
    PredictionWindowPushSchedulerService,
    NotificationQueueService,
    NotificationWorkerService,
  ],
  exports: [NotificationQueueService],
})
export class NotificationsModule {}
