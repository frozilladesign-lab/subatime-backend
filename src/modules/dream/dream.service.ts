import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { okResponse } from '../../common/utils/response.util';
import { CreateDreamEntryDto, DreamListQueryDto, UpdateDreamEntryDto } from './dto/dream.dto';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class DreamService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateDreamEntryDto) {
    const prisma = this.prisma as any;
    const entry = await prisma.dreamEntry.create({
      data: {
        userId,
        title: dto.title,
        body: dto.body,
        mood: dto.mood,
      },
    });
    return okResponse(entry, 'Dream entry created');
  }

  async list(userId: string, query: DreamListQueryDto) {
    const take = Math.min(50, Math.max(1, Number(query.limit ?? 20)));
    const prisma = this.prisma as any;
    const items = await prisma.dreamEntry.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take,
    });
    return okResponse(items, 'Dream entries fetched');
  }

  async update(userId: string, id: string, dto: UpdateDreamEntryDto) {
    const prisma = this.prisma as any;
    const existing = await prisma.dreamEntry.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Dream entry not found');
    if (existing.userId !== userId) throw new ForbiddenException('Forbidden');
    const updated = await prisma.dreamEntry.update({
      where: { id },
      data: {
        ...(dto.title != null ? { title: dto.title } : {}),
        ...(dto.body != null ? { body: dto.body } : {}),
        ...(dto.mood != null ? { mood: dto.mood } : {}),
      },
    });
    return okResponse(updated, 'Dream entry updated');
  }

  async remove(userId: string, id: string) {
    const prisma = this.prisma as any;
    const existing = await prisma.dreamEntry.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Dream entry not found');
    if (existing.userId !== userId) throw new ForbiddenException('Forbidden');
    await prisma.dreamEntry.delete({ where: { id } });
    return okResponse({ id }, 'Dream entry deleted');
  }
}
