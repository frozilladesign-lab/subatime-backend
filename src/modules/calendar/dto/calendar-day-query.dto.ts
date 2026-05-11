import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

/** Query for one civil day’s almanac slice (location + IANA zone). */
export class CalendarDayQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;

  @IsString()
  timezone!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;

  /** Optional whole-sign ascendant (e.g. chart `lagna`: Tula, Mesha, or English Libra, Aries) for horā `personalStatus`. */
  @IsOptional()
  @IsString()
  lagna?: string;
}
