import { IsIn, IsOptional, IsString, ValidateIf } from 'class-validator';

export class GenerateChartDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @ValidateIf((o) => !o.userId?.trim())
  @IsString()
  fullName!: string;

  @ValidateIf((o) => !o.userId?.trim())
  @IsString()
  birthDate!: string;

  @ValidateIf((o) => !o.userId?.trim())
  @IsString()
  birthTime!: string;

  @ValidateIf((o) => !o.userId?.trim())
  @IsString()
  birthPlace!: string;

  @IsOptional()
  latitude?: number;

  @IsOptional()
  longitude?: number;

  @IsOptional()
  @IsString()
  ayanamsa?: 'lahiri' | 'krishnamurti';

  /** IANA id from birth profile (e.g. Asia/Colombo); optional on anonymous chart requests. */
  @IsOptional()
  @IsString()
  timezone?: string;

  /** Whole-sign rising override (Mesha…Meena); rotates houses vs computed ascendant. */
  @IsOptional()
  @IsString()
  @IsIn([
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
  ])
  lagnaUserOverride?: string;
}
