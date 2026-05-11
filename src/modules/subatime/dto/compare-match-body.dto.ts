import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CompareMatchBodyDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(200)
  fullName?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  zodiacSign?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}/, {
    message: 'dateOfBirth must start with YYYY-MM-DD',
  })
  dateOfBirth?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  birthLocation?: string;

  /** When provided, must be 24h `HH:mm` (same contract as compatibility profiles). */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null) return undefined;
    const s = String(value).trim();
    return s.length ? s : undefined;
  })
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'timeOfBirth must be HH:mm (24-hour)',
  })
  timeOfBirth?: string;
}
