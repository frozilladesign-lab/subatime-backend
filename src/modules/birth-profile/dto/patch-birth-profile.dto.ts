import { IsArray, IsIn, IsOptional, IsString, ValidateIf } from 'class-validator';

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

/** Partial updates after onboarding steps (e.g. known ascendant) without resending full birth form. */
export class PatchBirthProfileDto {
  /** Set to `null` in JSON to clear a previously saved override. */
  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @IsString()
  @IsIn(LAGNA_SIGNS as unknown as string[])
  userKnownLagna?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  onboardingMoods?: string[];

  @IsOptional()
  @IsString()
  @IsIn(['male', 'female', 'non_binary', 'unspecified'])
  gender?: string;
}
