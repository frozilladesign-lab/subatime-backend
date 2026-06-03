import { Controller, Get, Query } from '@nestjs/common';
import { SubatimeService } from './subatime.service';

/** Unauthenticated read-only routes (e.g. onboarding sky context). */
@Controller('subatime/public')
export class SubatimePublicController {
  constructor(private readonly subatimeService: SubatimeService) {}

  @Get('sky/today')
  getSkyToday(@Query('lang') lang?: string) {
    return this.subatimeService.getPublicSkyToday(lang);
  }

  @Get('preview/day')
  getGuestPreview(
    @Query('birthDate') birthDate: string,
    @Query('name') name?: string,
  ) {
    return this.subatimeService.getGuestPreviewDay(birthDate, name);
  }
}
