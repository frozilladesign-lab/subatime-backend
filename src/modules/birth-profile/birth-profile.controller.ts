import { Body, Controller, Get, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { UpsertBirthProfileAuthDto, UpsertBirthProfileDto } from './dto/birth-profile.dto';
import { PatchBirthProfileDto } from './dto/patch-birth-profile.dto';
import { BirthProfileService } from './birth-profile.service';

@Controller('birth-profile')
export class BirthProfileController {
  constructor(private readonly birthProfileService: BirthProfileService) {}

  @Post()
  @UseGuards(AuthGuard)
  upsertMine(@CurrentUserId() userId: string, @Body() dto: UpsertBirthProfileAuthDto) {
    return this.birthProfileService.upsertForAuthedUser(userId, dto);
  }

  @Patch()
  @UseGuards(AuthGuard)
  patchMine(@CurrentUserId() userId: string, @Body() dto: PatchBirthProfileDto) {
    return this.birthProfileService.patchMine(userId, dto);
  }

  @Get()
  @UseGuards(AuthGuard)
  getMine(@CurrentUserId() userId: string) {
    return this.birthProfileService.getMine(userId);
  }

  /** Debounced client + OpenStreetMap Nominatim; returns up to 5 display labels with coordinates. */
  @Get('places')
  @UseGuards(AuthGuard)
  suggestPlaces(@CurrentUserId() userId: string, @Query('q') q?: string) {
    return this.birthProfileService.suggestPlaces(userId, q ?? '');
  }

  @Get('audit-snapshot')
  @UseGuards(AuthGuard)
  getAuditSnapshot(@CurrentUserId() userId: string) {
    return this.birthProfileService.getAuditSnapshot(userId);
  }

  /** Legacy create-with-userId — prefer authenticated `POST /birth-profile`. */
  @Post('create')
  create(@Body() dto: UpsertBirthProfileDto) {
    return this.birthProfileService.upsert(dto);
  }
}
