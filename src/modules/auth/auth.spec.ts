import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { scryptSync } from 'crypto';
import { AuthGuard } from '../../common/guards/auth.guard';
import { AuthConfig } from './auth.config';
import { AuthService } from './auth.service';
import { JwtTokenService } from './jwt-token.service';
import { SessionService } from './session.service';
import { PrismaService } from '../../database/prisma.service';

/** Minimal structural mock — only the Prisma surface `AuthService`/`SessionService` call. */
type MockedPrisma = Pick<PrismaService, 'user' | 'userSession'>;

describe('JwtTokenService', () => {
  const config = {
    jwtSecret: 'test-secret-for-jwt-unit-tests',
    accessTokenTtlSeconds: 900,
    refreshTokenTtlSeconds: 60 * 60 * 24 * 30,
  } as AuthConfig;

  const jwt = new JwtTokenService(config);

  it('signs and verifies access tokens', () => {
    const { token } = jwt.signAccessToken('user-123');
    expect(jwt.verifyAccessToken(token)).toBe('user-123');
  });
});

describe('AuthGuard', () => {
  const config = {
    jwtSecret: 'test-secret-for-jwt-unit-tests',
    accessTokenTtlSeconds: 900,
    refreshTokenTtlSeconds: 60 * 60 * 24 * 30,
  } as AuthConfig;
  const jwt = new JwtTokenService(config);
  const guard = new AuthGuard(jwt);

  const ctx = (authorization?: string): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          headers: authorization ? { authorization } : {},
        }),
      }),
    }) as unknown as ExecutionContext;

  it('accepts valid JWT bearer tokens', () => {
    const { token } = jwt.signAccessToken('user-abc');
    expect(guard.canActivate(ctx(`Bearer ${token}`))).toBe(true);
  });

  it('rejects legacy st_ tokens', () => {
    const legacy = `st_${Buffer.from('user-abc').toString('base64url')}`;
    expect(() => guard.canActivate(ctx(`Bearer ${legacy}`))).toThrow(UnauthorizedException);
  });

  it('rejects missing bearer tokens', () => {
    expect(() => guard.canActivate(ctx())).toThrow(UnauthorizedException);
  });
});

describe('AuthService', () => {
  const config = {
    jwtSecret: 'test-secret-for-jwt-unit-tests',
    accessTokenTtlSeconds: 900,
    refreshTokenTtlSeconds: 60 * 60 * 24 * 30,
  } as AuthConfig;

  const jwt = new JwtTokenService(config);

  const userFindUnique = jest.fn<Promise<unknown>, unknown[]>();
  const userCreate = jest.fn<Promise<unknown>, unknown[]>();
  const userUpdate = jest.fn<Promise<unknown>, unknown[]>();
  const sessionCreate = jest.fn<Promise<unknown>, unknown[]>();
  const sessionFindFirst = jest.fn<Promise<unknown>, unknown[]>();
  const sessionUpdate = jest.fn<Promise<unknown>, unknown[]>();

  const prisma: MockedPrisma = {
    user: {
      findUnique: userFindUnique,
      create: userCreate,
      update: userUpdate,
    } as unknown as PrismaService['user'],
    userSession: {
      create: sessionCreate,
      findFirst: sessionFindFirst,
      update: sessionUpdate,
    } as unknown as PrismaService['userSession'],
  };

  const sessions = new SessionService(prisma as PrismaService, config);
  const auth = new AuthService(prisma as PrismaService, jwt, sessions);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('login returns JWT access and refresh tokens', async () => {
    const salt = 'abc';
    const derived = scryptSync('secret12', salt, 64).toString('hex');
    userFindUnique.mockResolvedValue({
      id: 'u1',
      email: 'a@b.com',
      name: 'A',
      passwordHash: `${salt}:${derived}`,
    });
    sessionCreate.mockResolvedValue({ id: 's1' });

    const res = await auth.login({ email: 'a@b.com', password: 'secret12' });
    const data = res.data as Record<string, unknown>;

    expect(data.accessToken).toEqual(expect.stringMatching(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/));
    expect(data.refreshToken).toEqual(expect.any(String));
    expect((data.refreshToken as string).length).toBeGreaterThan(20);
    expect(data.expiresIn).toBe(900);
  });

  it('refresh rotates session and returns new tokens', async () => {
    const raw = 'raw-refresh-token-value-32chars-xx';
    const hash = sessions.hashRefreshToken(raw);
    sessionFindFirst.mockResolvedValue({
      id: 's1',
      userId: 'u1',
      refreshTokenHash: hash,
      deviceLabel: null,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    });
    sessionUpdate.mockResolvedValue({});
    sessionCreate.mockResolvedValue({ id: 's2' });

    const res = await auth.refresh({ refreshToken: raw });
    const data = res.data as Record<string, unknown>;
    expect(data.accessToken).toEqual(expect.any(String));
    expect(data.refreshToken).toEqual(expect.any(String));
    expect(sessionUpdate).toHaveBeenCalled();
  });

  it('logout revokes refresh session', async () => {
    const raw = 'raw-refresh-token-value-32chars-xy';
    const hash = sessions.hashRefreshToken(raw);
    sessionFindFirst.mockResolvedValue({
      id: 's1',
      userId: 'u1',
      refreshTokenHash: hash,
      deviceLabel: null,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    });
    sessionUpdate.mockResolvedValue({});

    await auth.logout({ refreshToken: raw });
    expect(sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1' },
        data: expect.objectContaining({ revokedAt: expect.any(Date) as Date }) as Record<string, unknown>,
      }),
    );
  });
});
