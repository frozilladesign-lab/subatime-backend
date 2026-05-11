import { IsOptional, IsString } from 'class-validator';

export class CreateDreamEntryDto {
  @IsString()
  title!: string;

  @IsString()
  body!: string;

  @IsString()
  mood!: string;
}

export class DreamListQueryDto {
  @IsOptional()
  @IsString()
  limit?: string;
}

export class UpdateDreamEntryDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsString()
  mood?: string;
}
