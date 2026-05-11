import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CompareMatchBodyDto } from './dto/compare-match-body.dto';
import { DreamStressAnalyticsQueryDto } from './dto/dream-stress-analytics-query.dto';
import { SubatimeService } from './subatime.service';

@Controller('subatime')
@UseGuards(AuthGuard)
export class SubatimeController {
  constructor(private readonly subatimeService: SubatimeService) {}

  @Get('plan/day')
  getPlanDay(
    @CurrentUserId() userId: string,
    @Query('date') date?: string,
    @Query('lang') lang?: string,
  ) {
    return this.subatimeService.getPlanDay(userId, date, lang);
  }

  @Post('plan/day/personalize')
  personalizePlanDay(
    @CurrentUserId() userId: string,
    @Body()
    body: {
      date?: string;
      sleepQuality?: number;
      stressLevel?: number;
      fatigueLevel?: number;
      focusArea?: 'overall' | 'career' | 'love' | 'health';
    },
  ) {
    return this.subatimeService.getPersonalizedPlanDay(userId, body);
  }

  @Get('plan/month')
  getPlanMonth(@CurrentUserId() userId: string, @Query('month') month?: string) {
    return this.subatimeService.getPlanMonth(userId, month);
  }

  @Get('feed')
  getFeed(
    @CurrentUserId() userId: string,
    @Query('limit') limit?: string,
    @Query('lang') lang?: string,
  ) {
    return this.subatimeService.getFeed(userId, Number(limit ?? 20), lang);
  }

  @Get('notifications')
  getNotifications(@CurrentUserId() userId: string, @Query('limit') limit?: string) {
    return this.subatimeService.getNotifications(userId, Number(limit ?? 30));
  }

  @Post('notifications/mark-all-read')
  markAllRead(@CurrentUserId() userId: string) {
    return this.subatimeService.markAllNotificationsRead(userId);
  }

  @Post('dream/interpret')
  interpretDream(
    @CurrentUserId() userId: string,
    @Body() body: { text?: string; mood?: string; lang?: string },
  ) {
    return this.subatimeService.interpretDream(userId, body.text ?? '', body.mood, body.lang);
  }

  @Get('dream/memory')
  getDreamMemory(@CurrentUserId() userId: string, @Query('limit') limit?: string) {
    return this.subatimeService.getDreamMemory(userId, Number(limit ?? 20));
  }

  @Get('analytics/dream-stress')
  getDreamStressAnalytics(
    @CurrentUserId() userId: string,
    @Query() query: DreamStressAnalyticsQueryDto,
  ) {
    return this.subatimeService.getDreamStressAnalytics(userId, query.days);
  }

  @Get('match/profiles')
  getMatchProfiles(@CurrentUserId() userId: string) {
    return this.subatimeService.getMatchProfiles(userId);
  }

  @Post('match/compare')
  compareMatch(@CurrentUserId() userId: string, @Body() body: CompareMatchBodyDto) {
    return this.subatimeService.compareMatch(userId, body);
  }

  @Post('feedback/nightly-checkin')
  submitNightlyCheckin(
    @CurrentUserId() userId: string,
    @Body()
    body: {
      moodStability: number;
      focusQuality: number;
      socialEase: number;
      stressIntensity: number;
      bestEnergyWindow: 'morning' | 'afternoon' | 'evening' | 'night';
      mostStressfulWindow: 'morning' | 'afternoon' | 'evening' | 'night';
      sleepQuality?: number;
      unusualStress?: number;
      fatigueLevel?: number;
      notes?: string;
    },
  ) {
    return this.subatimeService.submitNightlyCheckin(userId, body);
  }

  @Get('feedback/nightly-summary')
  getNightlySummary(
    @CurrentUserId() userId: string,
    @Query('days') days?: string,
  ) {
    return this.subatimeService.getNightlySummary(userId, Number(days ?? 30));
  }
}
