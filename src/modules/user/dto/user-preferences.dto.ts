import { Type } from 'class-transformer';
import { IsNumber, IsOptional, Max, Min, ValidateNested } from 'class-validator';

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

export class PatchUserPreferencesDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => AdaptationPreferencesDto)
  adaptation?: AdaptationPreferencesDto;
}
