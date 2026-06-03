import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { AuthConfig } from './auth.config';

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authConfig: AuthConfig,
  ) {}

  async createSession(userId: string, deviceLabel?: string): Promise<string> {
    const rawRefresh = randomBytes(32).toString('base64url');
    const refreshTokenHash = this.hashRefreshToken(rawRefresh);
    const expiresAt = new Date(Date.now() + this.authConfig.refreshTokenTtlSeconds * 1000);
    await this.prisma.userSession.create({
      data: {
        userId,
        refreshTokenHash,
        deviceLabel: deviceLabel?.trim() || null,
        expiresAt,
      },
    });
    return rawRefresh;
  }

  async rotateSession(rawRefreshToken: string): Promise<{ userId: string; refreshToken: string }> {
    const session = await this.findActiveSession(rawRefreshToken);
    await this.prisma.userSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    const refreshToken = await this.createSession(session.userId, session.deviceLabel ?? undefined);
    return { userId: session.userId, refreshToken };
  }

  async revokeSession(rawRefreshToken: string): Promise<void> {
    const session = await this.findActiveSession(rawRefreshToken);
    await this.prisma.userSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
  }

  private async findActiveSession(rawRefreshToken: string) {
    const refreshTokenHash = this.hashRefreshToken(rawRefreshToken);
    const session = await this.prisma.userSession.findFirst({
      where: { refreshTokenHash },
    });
    if (!session || session.revokedAt) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }
    return session;
  }

  hashRefreshToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }
}
