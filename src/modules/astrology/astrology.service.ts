import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { okResponse } from '../../common/utils/response.util';
import { PrismaService } from '../../database/prisma.service';
import { GenerateChartDto } from './dto/astrology.dto';
import { ChartService } from './services/chart.service';

@Injectable()
export class AstrologyService {
  constructor(
    private readonly chartService: ChartService,
    private readonly prisma: PrismaService,
  ) {}

  async generateChart(dto: GenerateChartDto) {
    const userId = dto.userId?.trim();
    const effective: GenerateChartDto =
      userId != null && userId !== ''
        ? await this.mergeProfileIntoDto(userId)
        : dto;

    const chart = this.chartService.generate(effective);

    if (!userId) {
      return okResponse(
        {
          profile: effective,
          lagna: chart.lagna,
          nakshatra: chart.nakshatra,
          nakath: chart.nakshatra,
          planetaryData: chart.planetaryData,
          chartData: chart.chartData,
          calculationMethod: 'sidereal-rule-engine-v2',
        },
        'Astrology chart generated',
      );
    }

    const profile = await this.prisma.birthProfile.findUnique({
      where: { userId },
    });
    if (!profile) {
      throw new NotFoundException(`Birth profile not found for user ${userId}`);
    }

    const latest = await this.prisma.astrologyChart.findFirst({
      where: { birthProfileId: profile.id },
      orderBy: { version: 'desc' },
    });
    const version = latest ? latest.version + 1 : 1;

    await this.prisma.astrologyChart.create({
      data: {
        birthProfileId: profile.id,
        version,
        chartData: chart.chartData as Prisma.InputJsonValue,
        planetaryData: chart.planetaryData,
      },
    });

    return okResponse(
      {
        profile: effective,
        lagna: chart.lagna,
        nakshatra: chart.nakshatra,
        nakath: chart.nakshatra,
        planetaryData: chart.planetaryData,
        chartData: chart.chartData,
        version,
        calculationMethod: 'sidereal-rule-engine-v2',
      },
      'Astrology chart generated',
    );
  }

  async getLatestChart(userId: string) {
    const profile = await this.prisma.birthProfile.findUnique({
      where: { userId },
    });
    if (!profile) {
      throw new NotFoundException(`Birth profile not found for user ${userId}`);
    }

    const chart = await this.prisma.astrologyChart.findFirst({
      where: { birthProfileId: profile.id },
      orderBy: { version: 'desc' },
    });
    if (!chart) {
      throw new NotFoundException(`Chart not found for user ${userId}`);
    }

    return okResponse(chart, 'Latest chart fetched');
  }

  private async mergeProfileIntoDto(userId: string): Promise<GenerateChartDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { birthProfile: true },
    });
    if (!user?.birthProfile) {
      throw new NotFoundException(`Birth profile not found for user ${userId}`);
    }
    const bp = user.birthProfile;
    const birthDate = bp.birthLocalDate?.trim() || bp.dateOfBirth.toISOString().slice(0, 10);
    const birthTime = bp.birthLocalTime?.trim() || bp.timeOfBirth.toISOString().slice(11, 16);
    return {
      userId,
      fullName: user.name,
      birthDate,
      birthTime,
      birthPlace: bp.placeOfBirth,
      latitude: bp.latitude,
      longitude: bp.longitude,
      timezone: bp.timezone ?? undefined,
    };
  }
}
