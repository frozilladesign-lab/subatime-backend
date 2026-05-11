import { IsObject } from 'class-validator';

export class CompareMatchingDto {
  @IsObject()
  profileA!: Record<string, unknown>;
  @IsObject()
  profileB!: Record<string, unknown>;
}
