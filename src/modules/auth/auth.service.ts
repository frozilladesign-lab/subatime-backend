import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { okResponse } from '../../common/utils/response.util';
import { LoginDto, LogoutDto, RefreshDto, RegisterDto } from './dto/auth.dto';
import { PrismaService } from '../../database/prisma.service';
import { JwtTokenService } from './jwt-token.service';
import { SessionService } from './session.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtTokenService,
    private readonly sessions: SessionService,
  ) {}

  async register(dto: RegisterDto) {
    const prisma = this.prisma as any;
    const nameFromEmail = dto.email.split('@')[0]?.trim() || 'User';
    const displayName = dto.fullName?.trim() ? dto.fullName.trim() : nameFromEmail;
    const existing = await prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      if (!existing.passwordHash) {
        const upgraded = await prisma.user.update({
          where: { id: existing.id },
          data: {
            name: displayName,
            passwordHash: this.hashPassword(dto.password),
          },
        });
        return okResponse(await this.issueAuthResponse(upgraded.id, upgraded.email, upgraded.name), 'User registered');
      }
      throw new BadRequestException('Email already registered. Please log in.');
    }
    const user = await prisma.user.create({
      data: {
        email: dto.email,
        name: displayName,
        passwordHash: this.hashPassword(dto.password),
      },
    });
    return okResponse(await this.issueAuthResponse(user.id, user.email, user.name), 'User registered');
  }

  async login(dto: LoginDto) {
    const prisma = this.prisma as any;
    const user = await prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!user.passwordHash || !this.verifyPassword(dto.password, user.passwordHash)) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return okResponse(
      await this.issueAuthResponse(user.id, user.email, user.name),
      'User logged in',
    );
  }

  async refresh(dto: RefreshDto) {
    const rotated = await this.sessions.rotateSession(dto.refreshToken);
    const { token: accessToken, expiresIn } = this.jwt.signAccessToken(rotated.userId);
    return okResponse(
      {
        userId: rotated.userId,
        accessToken,
        refreshToken: rotated.refreshToken,
        expiresIn,
      },
      'Token refreshed',
    );
  }

  async logout(dto: LogoutDto) {
    await this.sessions.revokeSession(dto.refreshToken);
    return okResponse({ ok: true }, 'Logged out');
  }

  private async issueAuthResponse(userId: string, email: string, fullName: string) {
    const { token: accessToken, expiresIn } = this.jwt.signAccessToken(userId);
    const refreshToken = await this.sessions.createSession(userId);
    return {
      userId,
      email,
      fullName,
      accessToken,
      refreshToken,
      expiresIn,
    };
  }

  private hashPassword(password: string): string {
    const salt = randomBytes(16).toString('hex');
    const derived = scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${derived}`;
  }

  private verifyPassword(password: string, stored: string): boolean {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const derived = scryptSync(password, salt, 64).toString('hex');
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(derived, 'hex');
    if (a.length != b.length) return false;
    return timingSafeEqual(a, b);
  }
}
