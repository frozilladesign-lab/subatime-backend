import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { MatchingService } from './matching.service';
import { CreateCompatibilityProfileDto } from './dto/profile.dto';

@Controller('matching')
@UseGuards(AuthGuard)
export class MatchingController {
  constructor(private readonly matchingService: MatchingService) {}

  @Post('profiles')
  createProfile(
    @CurrentUserId() userId: string,
    @Body() dto: CreateCompatibilityProfileDto,
  ) {
    return this.matchingService.createProfile(userId, dto);
  }
}
