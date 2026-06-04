import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { AstrologyModule } from '../astrology/astrology.module';
import { AiModule } from '../ai/ai.module';
import { BirthProfileModule } from '../birth-profile/birth-profile.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PredictionController } from './prediction.controller';
import { DailyPredictionService } from './services/daily-prediction.service';
import { FeedbackLearningService } from './services/feedback-learning.service';
import { ScoringEngineService } from './services/scoring-engine.service';

@Module({
  imports: [
    PrismaModule,
    AiModule,
    BirthProfileModule,
    AstrologyModule,
    forwardRef(() => NotificationsModule),
  ],
  controllers: [PredictionController],
  providers: [DailyPredictionService, ScoringEngineService, FeedbackLearningService],
  exports: [DailyPredictionService, FeedbackLearningService, ScoringEngineService],
})
export class PredictionModule {}
