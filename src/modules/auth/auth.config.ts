import { Injectable } from '@nestjs/common';

const DEFAULT_ACCESS_SECONDS = 15 * 60;
const DEFAULT_REFRESH_SECONDS = 30 * 24 * 60 * 60;

@Injectable()
export class AuthConfig {
  get jwtSecret(): string {
    const secret = process.env.JWT_SECRET?.trim();
    if (!secret) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('JWT_SECRET is required in production');
      }
      return 'dev-only-insecure-jwt-secret-change-me';
    }
    return secret;
  }

  get accessTokenTtlSeconds(): number {
    return parseDurationSeconds(process.env.JWT_ACCESS_EXPIRES_IN, DEFAULT_ACCESS_SECONDS);
  }

  get refreshTokenTtlSeconds(): number {
    return parseDurationSeconds(process.env.JWT_REFRESH_EXPIRES_IN, DEFAULT_REFRESH_SECONDS);
  }
}

function parseDurationSeconds(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const value = raw.trim();
  const match = /^(\d+)([smhd])?$/i.exec(value);
  if (!match) return fallback;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return fallback;
  const unit = (match[2] ?? 's').toLowerCase();
  switch (unit) {
    case 'm':
      return amount * 60;
    case 'h':
      return amount * 60 * 60;
    case 'd':
      return amount * 24 * 60 * 60;
    default:
      return amount;
  }
}
