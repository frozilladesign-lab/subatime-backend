import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const WINDOWS = ['morning', 'afternoon', 'evening', 'night'] as const;
type WindowLabel = (typeof WINDOWS)[number];

/** Body for `POST /api/subatime/feedback/nightly-checkin` — mirrors frontend_v2 `submitNightlyCheckin`. */
export class NightlyCheckinDto {
  @IsInt()
  @Min(1)
  @Max(5)
  moodStability!: number;

  @IsInt()
  @Min(1)
  @Max(5)
  focusQuality!: number;

  @IsInt()
  @Min(1)
  @Max(5)
  socialEase!: number;

  @IsInt()
  @Min(1)
  @Max(5)
  stressIntensity!: number;

  @IsIn(WINDOWS)
  bestEnergyWindow!: WindowLabel;

  @IsIn(WINDOWS)
  mostStressfulWindow!: WindowLabel;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  sleepQuality?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  unusualStress?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  fatigueLevel?: number;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
