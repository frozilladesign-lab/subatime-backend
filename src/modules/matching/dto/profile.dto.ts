import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { WESTERN_SUN_SIGNS, normalizeWesternZodiacSign } from '../constants/western-zodiac';

const westernSignsList = WESTERN_SUN_SIGNS as unknown as string[];

export class CreateCompatibilityProfileDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2, { message: 'fullName must be at least 2 characters' })
  fullName!: string;

  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'gender is required' })
  gender!: string;

  /** ISO date prefix `YYYY-MM-DD` or full ISO string (stored as Date). */
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}/, {
    message: 'dateOfBirth must start with YYYY-MM-DD',
  })
  dateOfBirth!: string;

  @Transform(({ value }: { value: unknown }) => normalizeWesternZodiacSign(typeof value === 'string' ? value : ''))
  @IsString()
  @IsIn(westernSignsList, {
    message: 'zodiacSign must be a Western sun sign (e.g. Gemini)',
  })
  zodiacSign!: string;

  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2, { message: 'birthLocation must be at least 2 characters' })
  birthLocation!: string;

  /** 24h `HH:mm`. */
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'timeOfBirth must be HH:mm (24-hour)',
  })
  timeOfBirth!: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(500)
  purpose?: string;

  /** Optional 0–100 overall from last `compare` when saving this partner. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  compatibilityScore?: number;
}
