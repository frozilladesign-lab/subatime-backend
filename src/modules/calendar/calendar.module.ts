import { Module } from '@nestjs/common';
import { AstrologyModule } from '../astrology/astrology.module';
import { AlmanacService } from './almanac.service';
import { CalendarController } from './calendar.controller';

@Module({
  imports: [AstrologyModule],
  controllers: [CalendarController],
  providers: [AlmanacService],
  exports: [AlmanacService],
})
export class CalendarModule {}
