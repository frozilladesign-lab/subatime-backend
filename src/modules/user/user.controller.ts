import { Body, Controller, Get, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CreateWellnessSnapshotDto } from './dto/wellness-snapshot.dto';
import { PatchUserPreferencesDto } from './dto/user-preferences.dto';
import { RegisterDeviceTokenDto } from './dto/register-device-token.dto';
import { UserService } from './user.service';
import { WellnessSnapshotService } from './wellness-snapshot.service';

@Controller('user')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly wellnessSnapshotService: WellnessSnapshotService,
  ) {}

  @Get('health')
  health() {
    return this.userService.health();
  }

  @Post('device-token')
  @UseGuards(AuthGuard)
  registerDeviceToken(@CurrentUserId() userId: string, @Body() dto: RegisterDeviceTokenDto) {
    return this.userService.registerDeviceToken(userId, dto);
  }

  @Get('preferences')
  @UseGuards(AuthGuard)
  getPreferences(@CurrentUserId() userId: string) {
    return this.userService.getPreferences(userId);
  }

  @Patch('preferences')
  @UseGuards(AuthGuard)
  patchPreferences(@CurrentUserId() userId: string, @Body() dto: PatchUserPreferencesDto) {
    return this.userService.patchPreferences(userId, dto);
  }

  @Post('wellness-snapshots')
  @UseGuards(AuthGuard)
  createWellnessSnapshot(@CurrentUserId() userId: string, @Body() dto: CreateWellnessSnapshotDto) {
    return this.wellnessSnapshotService.createPersonalizeSubmit(userId, dto);
  }

  @Get('wellness-snapshots')
  @UseGuards(AuthGuard)
  listWellnessSnapshots(@CurrentUserId() userId: string, @Query('days') days?: string) {
    const n = days != null && days.trim() !== '' ? Number(days) : 30;
    return this.wellnessSnapshotService.listForUser(userId, Number.isFinite(n) ? n : 30);
  }
}
