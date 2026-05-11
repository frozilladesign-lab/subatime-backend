import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { AstrologyService } from './astrology.service';
import { GenerateChartDto } from './dto/astrology.dto';

@Controller('astrology')
export class AstrologyController {
  constructor(private readonly astrologyService: AstrologyService) {}

  @Post('generate-chart')
  generateChart(@Body() dto: GenerateChartDto) {
    return this.astrologyService.generateChart(dto);
  }

  @Get('chart/me')
  @UseGuards(AuthGuard)
  chartMe(@CurrentUserId() userId: string) {
    return this.astrologyService.getLatestChart(userId);
  }

  @Get('chart/:userId')
  getChart(@Param('userId') userId: string) {
    return this.astrologyService.getLatestChart(userId);
  }

}
