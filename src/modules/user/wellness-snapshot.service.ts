import { BadRequestException, Injectable } from '@nestjs/common';
import { WellnessSnapshotSource } from '@prisma/client';
import { okResponse } from '../../common/utils/response.util';
import { PrismaService } from '../../database/prisma.service';
import { CreateWellnessSnapshotDto } from './dto/wellness-snapshot.dto';

function clampWellness(n: number): number {
  const r = Math.round(Number(n));
  return Math.min(5, Math.max(1, r));
}

function parsePlanDateUtc(isoDate: string): Date {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException('Invalid planDate');
  }
  return d;
}

@Injectable()
export class WellnessSnapshotService {
  constructor(private readonly prisma: PrismaService) {}

  async createPersonalizeSubmit(userId: string, dto: CreateWellnessSnapshotDto) {
    const planDate = dto.planDate != null ? parsePlanDateUtc(dto.planDate) : this.utcTodayDate();
    const row = await this.prisma.wellnessSnapshot.create({
      data: {
        userId,
        planDate,
        sleepQuality: clampWellness(dto.sleepQuality),
        stressLevel: clampWellness(dto.stressLevel),
        fatigueLevel: clampWellness(dto.fatigueLevel),
        source: WellnessSnapshotSource.personalize_submit,
      },
      select: {
        id: true,
        recordedAt: true,
        planDate: true,
        sleepQuality: true,
        stressLevel: true,
        fatigueLevel: true,
        source: true,
      },
    });
    return okResponse(this.serialize(row), 'Wellness snapshot saved');
  }

  /**
   * Server-only: nightly check-in maps reflection `unusualStress` into `stressLevel`
   * so the time series stays aligned with Guide “stress” semantics.
   */
  async recordNightlyCheckin(
    userId: string,
    planDateUtc: Date,
    input: { sleepQuality: number; unusualStress: number; fatigueLevel: number },
  ): Promise<void> {
    await this.prisma.wellnessSnapshot.create({
      data: {
        userId,
        planDate: planDateUtc,
        sleepQuality: clampWellness(input.sleepQuality),
        stressLevel: clampWellness(input.unusualStress),
        fatigueLevel: clampWellness(input.fatigueLevel),
        source: WellnessSnapshotSource.nightly_checkin,
      },
    });
  }

  async listForUser(userId: string, days: number) {
    const safeDays = Math.min(90, Math.max(1, Math.round(days || 30)));
    const since = new Date(Date.now() - safeDays * 86_400_000);
    const rows = await this.prisma.wellnessSnapshot.findMany({
      where: { userId, recordedAt: { gte: since } },
      orderBy: { recordedAt: 'desc' },
      take: 500,
      select: {
        id: true,
        recordedAt: true,
        planDate: true,
        sleepQuality: true,
        stressLevel: true,
        fatigueLevel: true,
        source: true,
      },
    });
    return okResponse(
      { items: rows.map((r) => this.serialize(r)) },
      'Wellness snapshots fetched',
    );
  }

  private utcTodayDate(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }

  private serialize(r: {
    id: string;
    recordedAt: Date;
    planDate: Date | null;
    sleepQuality: number;
    stressLevel: number;
    fatigueLevel: number;
    source: WellnessSnapshotSource;
  }) {
    return {
      id: r.id,
      recordedAt: r.recordedAt.toISOString(),
      planDate: r.planDate ? r.planDate.toISOString().slice(0, 10) : null,
      sleepQuality: r.sleepQuality,
      stressLevel: r.stressLevel,
      fatigueLevel: r.fatigueLevel,
      source: r.source,
    };
  }
}
