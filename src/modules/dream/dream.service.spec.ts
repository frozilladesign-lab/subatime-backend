import { DreamService } from './dream.service';

describe('DreamService', () => {
  const makeService = () => {
    const state: Record<string, any> = {};
    const prisma = {
      dreamEntry: {
        create: jest.fn(async ({ data }) => {
          const row = { id: 'd1', createdAt: new Date(), updatedAt: new Date(), ...data };
          state[row.id] = row;
          return row;
        }),
        findMany: jest.fn(async ({ where }) =>
          Object.values(state).filter((x: any) => x.userId === where.userId),
        ),
        findUnique: jest.fn(async ({ where }) => state[where.id] ?? null),
        update: jest.fn(async ({ where, data }) => {
          state[where.id] = { ...state[where.id], ...data };
          return state[where.id];
        }),
        delete: jest.fn(async ({ where }) => {
          delete state[where.id];
          return { id: where.id };
        }),
      },
    };
    return new DreamService(prisma as any);
  };

  it('creates and lists entries scoped to user', async () => {
    const service = makeService();
    await service.create('u1', { title: 't', body: 'b', mood: 'Calm' });
    const res = await service.list('u1', { limit: '10' });
    expect((res.data as any[]).length).toBe(1);
    expect((res.data as any[])[0].userId).toBe('u1');
  });

  it('updates and deletes owned entry', async () => {
    const service = makeService();
    await service.create('u1', { title: 't', body: 'b', mood: 'Calm' });
    const updated = await service.update('u1', 'd1', { title: 't2' });
    expect((updated.data as any).title).toBe('t2');
    const removed = await service.remove('u1', 'd1');
    expect((removed.data as any).id).toBe('d1');
  });
});
