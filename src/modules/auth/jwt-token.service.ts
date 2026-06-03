import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { AuthConfig } from './auth.config';

export type AccessTokenPayload = {
  sub: string;
  typ: 'access';
  iat: number;
  exp: number;
};

@Injectable()
export class JwtTokenService {
  constructor(private readonly authConfig: AuthConfig) {}

  signAccessToken(userId: string): { token: string; expiresIn: number } {
    const expiresIn = this.authConfig.accessTokenTtlSeconds;
    const now = Math.floor(Date.now() / 1000);
    const payload: AccessTokenPayload = {
      sub: userId,
      typ: 'access',
      iat: now,
      exp: now + expiresIn,
    };
    const token = this.encode(payload);
    return { token, expiresIn };
  }

  verifyAccessToken(token: string): string {
    const payload = this.decode(token);
    if (payload.typ !== 'access') {
      throw new UnauthorizedException('Invalid access token');
    }
    const userId = payload.sub?.trim();
    if (!userId) {
      throw new UnauthorizedException('Invalid access token');
    }
    return userId;
  }

  private encode(payload: AccessTokenPayload): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = this.sign(`${header}.${body}`);
    return `${header}.${body}.${signature}`;
  }

  private decode(token: string): AccessTokenPayload {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedException('Invalid access token');
    }
    const [header, body, signature] = parts;
    const expected = this.sign(`${header}.${body}`);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid access token');
    }
    let payload: AccessTokenPayload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as AccessTokenPayload;
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }
    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp <= now) {
      throw new UnauthorizedException('Access token expired');
    }
    return payload;
  }

  private sign(input: string): string {
    return createHmac('sha256', this.authConfig.jwtSecret).update(input).digest('base64url');
  }
}
