import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { AiModule } from '../ai/ai.module';
import { MatchingModule } from '../matching/matching.module';
import { PredictionModule } from '../prediction/prediction.module';
import { UserModule } from '../user/user.module';
import { SubatimePublicController } from './subatime-public.controller';
import { SubatimeController } from './subatime.controller';
import { SubatimeService } from './subatime.service';

@Module({
  imports: [PrismaModule, PredictionModule, MatchingModule, AiModule, UserModule],
  controllers: [SubatimeController, SubatimePublicController],
  providers: [SubatimeService],
})
export class SubatimeModule {}
