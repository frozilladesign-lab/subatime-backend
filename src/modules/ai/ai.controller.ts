import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import {
  AiChartImageDto,
  AiChatDto,
  AiCompatibilityNarrativeDto,
  AiDayPlannerDto,
  AiGlossaryDto,
  AiLocalizeDto,
  AiPolishDto,
  AiReflectionDto,
} from './dto/ai.dto';
import { AiService } from './ai.service';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('chat')
  @UseGuards(AuthGuard)
  chat(@CurrentUserId() userId: string, @Body() dto: AiChatDto) {
    return this.aiService.chat(userId, dto);
  }

  @Post('glossary')
  @UseGuards(AuthGuard)
  glossary(@CurrentUserId() userId: string, @Body() dto: AiGlossaryDto) {
    return this.aiService.glossary(userId, dto);
  }

  @Post('day-planner')
  @UseGuards(AuthGuard)
  dayPlanner(@CurrentUserId() userId: string, @Body() dto: AiDayPlannerDto) {
    return this.aiService.dayPlanner(userId, dto);
  }

  @Post('compatibility-narrative')
  @UseGuards(AuthGuard)
  compatibilityNarrative(
    @CurrentUserId() userId: string,
    @Body() dto: AiCompatibilityNarrativeDto,
  ) {
    return this.aiService.compatibilityNarrative(userId, dto);
  }

  @Post('reflection')
  @UseGuards(AuthGuard)
  reflection(@CurrentUserId() userId: string, @Body() dto: AiReflectionDto) {
    return this.aiService.reflection(userId, dto);
  }

  @Post('chart-image-hints')
  @UseGuards(AuthGuard)
  chartImageHints(@CurrentUserId() userId: string, @Body() dto: AiChartImageDto) {
    return this.aiService.chartImageHints(userId, dto);
  }

  @Post('polish')
  @UseGuards(AuthGuard)
  polish(@CurrentUserId() userId: string, @Body() dto: AiPolishDto) {
    return this.aiService.polish(userId, dto);
  }

  @Post('localize')
  @UseGuards(AuthGuard)
  localize(@CurrentUserId() userId: string, @Body() dto: AiLocalizeDto) {
    return this.aiService.localize(userId, dto);
  }
}
