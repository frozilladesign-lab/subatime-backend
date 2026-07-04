import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

/** Body for `POST /api/subatime/plan/day/personalize` — mirrors frontend_v2 `fetchPersonalizedDay`. */
export class PersonalizePlanDayDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  sleepQuality?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  stressLevel?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  fatigueLevel?: number;

  @IsOptional()
  @IsIn(['overall', 'career', 'love', 'health'])
  focusArea?: 'overall' | 'career' | 'love' | 'health';
}
