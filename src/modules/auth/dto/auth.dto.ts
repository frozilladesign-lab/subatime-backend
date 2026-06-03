import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  /** Optional — clients may register with email only; server defaults name from email. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  fullName?: string;
}

export class LoginDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;
}

export class RefreshDto {
  @IsString()
  @MinLength(20)
  refreshToken!: string;
}

export class LogoutDto {
  @IsString()
  @MinLength(20)
  refreshToken!: string;
}
