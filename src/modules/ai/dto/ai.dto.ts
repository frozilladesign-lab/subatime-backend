import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class AiChatDto {
  @IsString()
  @MinLength(2)
  prompt!: string;

  @IsOptional()
  @IsObject()
  astrologyContext?: Record<string, unknown>;
}

export class AiGlossaryDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  term!: string;
}

export class AiDayPlannerDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  intent!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  activity?: string;
}

export class AiCompatibilityNarrativeDto {
  @IsObject()
  profileA!: Record<string, unknown>;

  @IsObject()
  profileB!: Record<string, unknown>;
}

export class AiReflectionDto {
  @IsString()
  @MinLength(4)
  @MaxLength(4000)
  userNote!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  mood?: string;
}

export class AiChartImageDto {
  /** Raw base64 or data URL (prefix stripped server-side). */
  @IsString()
  @MinLength(100)
  @MaxLength(6_000_000)
  imageBase64!: string;

  @IsString()
  @IsIn(['image/jpeg', 'image/png', 'image/webp'])
  mimeType!: 'image/jpeg' | 'image/png' | 'image/webp';
}

export class AiPolishDto {
  @IsString()
  @MinLength(10)
  @MaxLength(8000)
  text!: string;

  @IsOptional()
  @IsString()
  @IsIn(['notification', 'general'])
  kind?: 'notification' | 'general';
}

export class AiLocalizeDto {
  @IsString()
  @MinLength(10)
  @MaxLength(8000)
  text!: string;

  /** BCP-47-ish locale hint, e.g. si-LK, ta-LK, en */
  @IsString()
  @MinLength(2)
  @MaxLength(12)
  locale!: string;
}
