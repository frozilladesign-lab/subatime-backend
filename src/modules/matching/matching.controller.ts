import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { MatchingService } from './matching.service';
import { CompareMatchingDto } from './dto/matching.dto';
import { CreateCompatibilityProfileDto, UpdateCompatibilityProfileDto } from './dto/profile.dto';

@Controller('matching')
@UseGuards(AuthGuard)
export class MatchingController {
  constructor(private readonly matchingService: MatchingService) {}

  @Post('compare')
  compare(@Body() dto: CompareMatchingDto) {
    return this.matchingService.compare(dto);
  }

  @Post('profiles')
  createProfile(
    @CurrentUserId() userId: string,
    @Body() dto: CreateCompatibilityProfileDto,
  ) {
    return this.matchingService.createProfile(userId, dto);
  }

  @Get('profiles')
  listProfiles(@CurrentUserId() userId: string) {
    return this.matchingService.listProfiles(userId);
  }

  @Get('profiles/:id')
  getProfile(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
  ) {
    return this.matchingService.getProfile(userId, id);
  }

  @Patch('profiles/:id')
  updateProfile(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCompatibilityProfileDto,
  ) {
    return this.matchingService.updateProfile(userId, id, dto);
  }

  @Delete('profiles/:id')
  removeProfile(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
  ) {
    return this.matchingService.removeProfile(userId, id);
  }
}
