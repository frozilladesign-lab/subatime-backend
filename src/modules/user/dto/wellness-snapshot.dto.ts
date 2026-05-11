import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export class CreateWellnessSnapshotDto {
  @IsInt()
  @Min(1)
  @Max(5)
  sleepQuality!: number;

  @IsInt()
  @Min(1)
  @Max(5)
  stressLevel!: number;

  @IsInt()
  @Min(1)
  @Max(5)
  fatigueLevel!: number;

  /** UTC calendar date for the plan day (`YYYY-MM-DD`). */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'planDate must be YYYY-MM-DD' })
  planDate?: string;

  /** HTTP clients may only submit explicit personalize commits. */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsIn(['personalize_submit'])
  source!: 'personalize_submit';
}
