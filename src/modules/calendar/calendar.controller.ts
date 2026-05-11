import { Controller, Get, Query } from '@nestjs/common';
import { AlmanacService } from './almanac.service';
import { CalendarDayQueryDto } from './dto/calendar-day-query.dto';

@Controller('calendar')
export class CalendarController {
  constructor(private readonly almanacService: AlmanacService) {}

  /** Sidereal tithi / nakṣatra at sunrise + Rāhu-kāla from Swiss Ephemeris (Lahiri). */
  @Get('day')
  getDay(@Query() query: CalendarDayQueryDto) {
    return this.almanacService.computeDay(query);
  }
}
