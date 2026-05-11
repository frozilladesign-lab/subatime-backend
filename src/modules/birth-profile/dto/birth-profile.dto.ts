import {
  IsArray,
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const LAGNA_SIGNS = [
  'Mesha',
  'Vrishabha',
  'Mithuna',
  'Karka',
  'Simha',
  'Kanya',
  'Tula',
  'Vrischika',
  'Dhanu',
  'Makara',
  'Kumbha',
  'Meena',
] as const;

/** Legacy body shape — retained only for scripts/tests; prefer authenticated `/birth-profile`. */
export class UpsertBirthProfileDto {
  @IsString()
  userId!: string;

  @IsString()
  dateOfBirth!: string;

  @IsString()
  timeOfBirth!: string;

  @IsString()
  placeOfBirth!: string;

  @IsNumber()
  latitude!: number;

  @IsNumber()
  longitude!: number;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  onboardingIntent?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(exact|approx|approximate|unknown)$/)
  birthTimeAccuracy?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(quick|accurate|veryAccurate)$/)
  predictionTier?: string;
}

/** Signed-in upsert — coords optional & resolved via geocoder when missing. */
export class UpsertBirthProfileAuthDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateOfBirth!: string;

  @IsString()
  @Matches(/^\d{2}:\d{2}$/)
  timeOfBirth!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(180)
  placeOfBirth!: string;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  onboardingIntent?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(exact|approx|approximate|unknown)$/)
  birthTimeAccuracy?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(quick|accurate|veryAccurate)$/)
  predictionTier?: string;

  @IsOptional()
  @IsEmail()
  displayEmail?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  fullName?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  onboardingMoods?: string[];

  @IsOptional()
  @IsString()
  @IsIn(['male', 'female', 'non_binary', 'unspecified'])
  gender?: string;

  @IsOptional()
  @IsString()
  @IsIn(LAGNA_SIGNS as unknown as string[])
  userKnownLagna?: string;
}
