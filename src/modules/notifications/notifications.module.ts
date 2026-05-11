import { Module } from '@nestjs/common';
import { NotificationDeliveryService } from './notification-delivery.service';
import { NotificationPushDispatcherService } from './notification-push-dispatcher.service';
import { NotificationQueueService } from './queue/notification.queue';
import { NotificationWorkerService } from './queue/notification.worker';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushModule } from '../push/push.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [PushModule, UserModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationDeliveryService,
    NotificationPushDispatcherService,
    NotificationQueueService,
    NotificationWorkerService,
  ],
  exports: [NotificationQueueService],
})
export class NotificationsModule {}
