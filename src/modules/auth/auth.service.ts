import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { okResponse } from '../../common/utils/response.util';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async register(dto: RegisterDto) {
    const prisma = this.prisma as any;
    const nameFromEmail = dto.email.split('@')[0]?.trim() || 'User';
    const displayName = dto.fullName?.trim() ? dto.fullName.trim() : nameFromEmail;
    const existing = await prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      // Backward compatibility: older demo accounts may exist without a password hash.
      // Let "Create account" set a password for those records instead of hard-failing.
      if (!existing.passwordHash) {
        const upgraded = await prisma.user.update({
          where: { id: existing.id },
          data: {
            name: displayName,
            passwordHash: this.hashPassword(dto.password),
          },
        });
        const accessToken = this.issueAccessToken(upgraded.id);
        return okResponse(
          {
            userId: upgraded.id,
            email: upgraded.email,
            fullName: upgraded.name,
            accessToken,
          },
          'User registered',
        );
      }
      throw new BadRequestException(
        'Email already registered. Please log in.',
      );
    }
    const user = await prisma.user.create({
      data: {
        email: dto.email,
        name: displayName,
        passwordHash: this.hashPassword(dto.password),
      },
    });
    const accessToken = this.issueAccessToken(user.id);
    return okResponse(
      {
        userId: user.id,
        email: user.email,
        fullName: user.name,
        accessToken,
      },
      'User registered',
    );
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
    const accessToken = this.issueAccessToken(user.id);
    return okResponse(
      {
        userId: user.id,
        accessToken,
        refreshToken: `${accessToken}_refresh`,
        email: user.email,
      },
      'User logged in',
    );
  }

  private issueAccessToken(userId: string): string {
    return `st_${Buffer.from(userId).toString('base64url')}`;
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
