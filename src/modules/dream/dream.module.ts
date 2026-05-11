import { Module } from '@nestjs/common';
import { DreamController } from './dream.controller';
import { DreamService } from './dream.service';

@Module({
  controllers: [DreamController],
  providers: [DreamService],
})
export class DreamModule {}
