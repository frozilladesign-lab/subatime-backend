import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { AstrologyModule } from '../astrology/astrology.module';
import { MatchingModule } from '../matching/matching.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { DreamExtractionService } from './services/dream-extraction.service';
import { GeminiLanguageService } from './services/gemini-language.service';
import { GeminiService } from './services/gemini.service';

@Module({
  imports: [PrismaModule, AstrologyModule, MatchingModule],
  controllers: [AiController],
  providers: [AiService, GeminiService, GeminiLanguageService, DreamExtractionService],
  exports: [AiService, GeminiService, GeminiLanguageService, DreamExtractionService],
})
export class AiModule {}
