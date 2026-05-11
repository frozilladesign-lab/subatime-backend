import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppConfigService } from './config/app.config';
import { AstrologyModule } from './modules/astrology/astrology.module';
import { AiModule } from './modules/ai/ai.module';
import { AuthModule } from './modules/auth/auth.module';
import { BirthProfileModule } from './modules/birth-profile/birth-profile.module';
import { MatchingModule } from './modules/matching/matching.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PredictionModule } from './modules/prediction/prediction.module';
import { UserModule } from './modules/user/user.module';
import { PrismaModule } from './database/prisma.module';
import { DreamModule } from './modules/dream/dream.module';
import { SubatimeModule } from './modules/subatime/subatime.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    BirthProfileModule,
    UserModule,
    AstrologyModule,
    AiModule,
    MatchingModule,
    NotificationsModule,
    PredictionModule,
    DreamModule,
    SubatimeModule,
  ],
  providers: [AppConfigService],
})
export class AppModule {}
