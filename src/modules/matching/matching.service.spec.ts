import { BadRequestException } from '@nestjs/common';
import type { CompatibilityProfile } from '@prisma/client';
import { MatchingService } from './matching.service';
import { PrismaService } from '../../database/prisma.service';

/** Minimal structural mock — only the Prisma surface `MatchingService` actually calls. */
type MockedPrisma = Pick<PrismaService, 'birthProfile' | 'astrologyChart' | 'compatibilityProfile'>;

describe('MatchingService', () => {
  const makeService = () => {
    const state: Record<string, CompatibilityProfile> = {};
    const prisma: MockedPrisma = {
      birthProfile: {
        findUnique: jest.fn(({ where }: { where: { userId: string } }) =>
          Promise.resolve({
            id: 'bp1',
            userId: where.userId,
            lagna: 'Virgo',
            nakshatra: 'Hasta',
          }),
        ),
      } as unknown as PrismaService['birthProfile'],
      astrologyChart: {
        findFirst: jest.fn(() => Promise.resolve({ chartData: {} })),
      } as unknown as PrismaService['astrologyChart'],
      compatibilityProfile: {
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          const row = { id: 'p1', createdAt: new Date(), updatedAt: new Date(), ...data } as CompatibilityProfile;
          state[row.id] = row;
          return Promise.resolve(row);
        }),
        findMany: jest.fn(({ where }: { where: { userId: string } }) =>
          Promise.resolve(Object.values(state).filter((x) => x.userId === where.userId)),
        ),
        findUnique: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(state[where.id] ?? null),
        ),
        update: jest.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          state[where.id] = { ...state[where.id], ...data };
          return Promise.resolve(state[where.id]);
        }),
        delete: jest.fn(({ where }: { where: { id: string } }) => {
          delete state[where.id];
          return Promise.resolve({ id: where.id });
        }),
      } as unknown as PrismaService['compatibilityProfile'],
    };
    return { service: new MatchingService(prisma as PrismaService), prisma };
  };

  const validDto = {
    fullName: 'Alex',
    gender: 'Male',
    dateOfBirth: '1990-01-01',
    zodiacSign: 'Aries',
    birthLocation: 'Colombo',
    timeOfBirth: '10:10',
    purpose: 'General',
  };

  it('creates a profile scoped to user', async () => {
    const { service } = makeService();
    const res = await service.createProfile('u1', validDto);
    expect(res.data.fullName).toBe('Alex');
    expect(res.data.userId).toBe('u1');
  });

  it('createProfile refuses when user has no birth profile', async () => {
    const createMock = jest.fn();
    const prisma: MockedPrisma = {
      birthProfile: {
        findUnique: jest.fn(() => Promise.resolve(null)),
      } as unknown as PrismaService['birthProfile'],
      astrologyChart: {
        findFirst: jest.fn(),
      } as unknown as PrismaService['astrologyChart'],
      compatibilityProfile: {
        create: createMock,
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      } as unknown as PrismaService['compatibilityProfile'],
    };
    const service = new MatchingService(prisma as PrismaService);
    await expect(service.createProfile('u1', validDto)).rejects.toBeInstanceOf(BadRequestException);
    expect(createMock).not.toHaveBeenCalled();
  });
});
