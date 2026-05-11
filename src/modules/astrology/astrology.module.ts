import { Module } from '@nestjs/common';
import { AstrologyController } from './astrology.controller';
import { AstrologyService } from './astrology.service';
import { ChartService } from './services/chart.service';
import { LagnaService } from './services/lagna.service';
import { NakshatraService } from './services/nakshatra.service';

@Module({
  controllers: [AstrologyController],
  providers: [
    AstrologyService,
    LagnaService,
    NakshatraService,
    ChartService,
  ],
  exports: [AstrologyService, ChartService],
})
export class AstrologyModule {}
