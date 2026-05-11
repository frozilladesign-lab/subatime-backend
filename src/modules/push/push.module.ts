import { Module } from '@nestjs/common';
import { FirebasePushService } from './firebase-push.service';

@Module({
  providers: [FirebasePushService],
  exports: [FirebasePushService],
})
export class PushModule {}
