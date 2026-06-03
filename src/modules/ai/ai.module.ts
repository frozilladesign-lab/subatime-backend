import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { DreamExtractionService } from './services/dream-extraction.service';
import { GeminiService } from './services/gemini.service';

/** Gemini for dream tag extraction only; daily copy is client-side i18n (no `/api/ai/*`). */
@Module({
  imports: [PrismaModule],
  providers: [GeminiService, DreamExtractionService],
  exports: [GeminiService, DreamExtractionService],
})
export class AiModule {}
