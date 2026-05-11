import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { DreamService } from './dream.service';
import { CreateDreamEntryDto, DreamListQueryDto, UpdateDreamEntryDto } from './dto/dream.dto';

@Controller('dream')
@UseGuards(AuthGuard)
export class DreamController {
  constructor(private readonly dreamService: DreamService) {}

  @Post('entries')
  create(
    @CurrentUserId() userId: string,
    @Body() dto: CreateDreamEntryDto,
  ) {
    return this.dreamService.create(userId, dto);
  }

  @Get('entries')
  list(
    @CurrentUserId() userId: string,
    @Query() query: DreamListQueryDto,
  ) {
    return this.dreamService.list(userId, query);
  }

  @Patch('entries/:id')
  update(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDreamEntryDto,
  ) {
    return this.dreamService.update(userId, id, dto);
  }

  @Delete('entries/:id')
  remove(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
  ) {
    return this.dreamService.remove(userId, id);
  }
}
