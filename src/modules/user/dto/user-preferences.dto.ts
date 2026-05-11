import { Type } from 'class-transformer';
import { IsBoolean, IsNumber, IsOptional, Max, Min, ValidateNested } from 'class-validator';

/** Slider values 0–100 for Profile → Adaptation sheet. */
export class AdaptationPreferencesDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  depth?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  sensitivity?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  dreamDepth?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  strictness?: number;
}

/** Optional notification channels / topics (merged into `users.preferences`). */
export class NotificationsPreferencesDto {
  /**
   * When true, skip creating evening/night forecast nudges that repeat summary-based “learning” copy.
   * Morning digest is unchanged.
   */
  @IsOptional()
  @IsBoolean()
  muteLearningTips?: boolean;

  /** When false, skip scheduling proactive favorable-horā push jobs. Default true when unset. */
  @IsOptional()
  @IsBoolean()
  proactiveHoraAlerts?: boolean;
}

export class PatchUserPreferencesDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => AdaptationPreferencesDto)
  adaptation?: AdaptationPreferencesDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => NotificationsPreferencesDto)
  notifications?: NotificationsPreferencesDto;
}
