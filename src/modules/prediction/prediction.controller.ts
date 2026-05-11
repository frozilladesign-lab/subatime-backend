import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { SubmitPredictionFeedbackDto } from './dto/feedback.dto';
import { DailyPredictionService } from './services/daily-prediction.service';

@Controller('predictions')
@UseGuards(AuthGuard)
export class PredictionController {
  constructor(private readonly dailyPredictionService: DailyPredictionService) {}

  @Post('generate-today')
  generateToday() {
    return this.dailyPredictionService.generateTodayManual();
  }

  @Post(':id/explain')
  explainPrediction(
    @CurrentUserId() userId: string,
    @Param('id') predictionId: string,
  ) {
    return this.dailyPredictionService.explainPrediction(userId, predictionId);
  }

  @Get('today')
  getToday(@CurrentUserId() userId: string) {
    return this.dailyPredictionService.getTodayForUser(userId);
  }

  @Get('feedback/stats')
  getFeedbackStats(@CurrentUserId() userId: string) {
    return this.dailyPredictionService.getFeedbackStats(userId);
  }

  @Get(':id/feedback')
  getFeedback(
    @CurrentUserId() userId: string,
    @Param('id') predictionId: string,
  ) {
    return this.dailyPredictionService.getFeedback(predictionId, userId);
  }

  @Post(':id/feedback')
  submitFeedback(
    @CurrentUserId() userId: string,
    @Param('id') predictionId: string,
    @Body() dto: SubmitPredictionFeedbackDto,
  ) {
    return this.dailyPredictionService.submitFeedback(predictionId, userId, dto);
  }
}
