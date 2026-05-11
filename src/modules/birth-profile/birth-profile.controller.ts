import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { UpsertBirthProfileAuthDto, UpsertBirthProfileDto } from './dto/birth-profile.dto';
import { BirthProfileService } from './birth-profile.service';

@Controller('birth-profile')
export class BirthProfileController {
  constructor(private readonly birthProfileService: BirthProfileService) {}

  @Post()
  @UseGuards(AuthGuard)
  upsertMine(@CurrentUserId() userId: string, @Body() dto: UpsertBirthProfileAuthDto) {
    return this.birthProfileService.upsertForAuthedUser(userId, dto);
  }

  @Get()
  @UseGuards(AuthGuard)
  getMine(@CurrentUserId() userId: string) {
    return this.birthProfileService.getMine(userId);
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
