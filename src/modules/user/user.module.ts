import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { WellnessSnapshotRetentionService } from './wellness-snapshot-retention.service';
import { WellnessSnapshotService } from './wellness-snapshot.service';

@Module({
  controllers: [UserController],
  providers: [UserService, WellnessSnapshotService, WellnessSnapshotRetentionService],
  exports: [UserService, WellnessSnapshotService],
})
export class UserModule {}
