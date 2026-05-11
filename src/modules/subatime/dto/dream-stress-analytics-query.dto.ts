import { Transform } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';

export class DreamStressAnalyticsQueryDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsIn([30, 90])
  days?: 30 | 90;
}
