import { BadRequestException } from '@nestjs/common';
import { MatchingService } from './matching.service';

describe('MatchingService', () => {
  const makeService = () => {
    const state: Record<string, any> = {};
    const prisma = {
      birthProfile: {
        findUnique: jest.fn(async ({ where }: { where: { userId: string } }) => ({
          id: 'bp1',
          userId: where.userId,
          lagna: 'Virgo',
          nakshatra: 'Hasta',
        })),
      },
      astrologyChart: {
        findFirst: jest.fn(async () => ({
          chartData: {},
        })),
      },
      compatibilityProfile: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: 'p1', createdAt: new Date(), updatedAt: new Date(), ...data };
          state[row.id] = row;
          return row;
        }),
        findMany: jest.fn(async ({ where }: { where: { userId: string } }) =>
          Object.values(state).filter((x: any) => x.userId === where.userId),
        ),
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) => state[where.id] ?? null),
        update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          state[where.id] = { ...state[where.id], ...data };
          return state[where.id];
        }),
        delete: jest.fn(async ({ where }: { where: { id: string } }) => {
          delete state[where.id];
          return { id: where.id };
        }),
      },
    };
    return { service: new MatchingService(prisma as any), prisma };
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

  it('creates and lists profiles scoped to user', async () => {
    const { service } = makeService();
    await service.createProfile('u1', validDto);
    const res = await service.listProfiles('u1');
    expect((res.data as any[]).length).toBe(1);
  });

  it('updates and deletes owned profile', async () => {
    const { service } = makeService();
    await service.createProfile('u1', validDto);
    const updated = await service.updateProfile('u1', 'p1', { fullName: 'Alexis' });
    expect((updated.data as any).fullName).toBe('Alexis');
    const removed = await service.removeProfile('u1', 'p1');
    expect((removed.data as any).id).toBe('p1');
  });

  it('createProfile refuses when user has no birth profile', async () => {
    const state: Record<string, any> = {};
    const prisma = {
      birthProfile: {
        findUnique: jest.fn(async () => null),
      },
      astrologyChart: { findFirst: jest.fn() },
      compatibilityProfile: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    const service = new MatchingService(prisma as any);
    await expect(service.createProfile('u1', validDto)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.compatibilityProfile.create).not.toHaveBeenCalled();
  });
});
