import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { okResponse } from '../../common/utils/response.util';
import { PrismaService } from '../../database/prisma.service';
import type { WesternSunSign } from './constants/western-zodiac';
import { WESTERN_SUN_SIGNS, normalizeWesternZodiacSign } from './constants/western-zodiac';
import { CompareMatchingDto } from './dto/matching.dto';
import { CreateCompatibilityProfileDto, UpdateCompatibilityProfileDto } from './dto/profile.dto';

@Injectable()
export class MatchingService {
  constructor(private readonly prisma: PrismaService) {}

  compare(dto: CompareMatchingDto) {
    const a = this.normalizeProfileStrict(dto.profileA);
    const b = this.normalizeProfileStrict(dto.profileB);
    const communication = this.scoreCommunication(a, b);
    const intimacy = this.scoreIntimacy(a, b);
    const longTerm = this.scoreLongTerm(a, b);
    const emotional = this.scoreEmotional(a, b);
    const overall = Math.round((communication + intimacy + longTerm + emotional) / 4);
    const dosha = this.detectDosha(a, b);

    return okResponse(
      {
        score: overall,
        summary:
          overall >= 75
            ? 'Strong compatibility with aligned growth patterns.'
            : overall >= 60
              ? 'Moderate compatibility with areas to strengthen.'
              : 'Compatibility requires careful communication and expectation setting.',
        breakdown: {
          communication,
          intimacy,
          longTerm,
          emotional,
        },
        doshaFlags: dosha,
        recommendations: [
          communication < 70
            ? 'Prioritize weekly check-ins to improve communication quality.'
            : 'Maintain transparent communication habits.',
          longTerm < 70
            ? 'Align long-term goals before major commitments.'
            : 'Your long-term direction appears naturally aligned.',
          dosha.hasManglikMismatch
            ? 'Consider guided counseling for Mars-driven conflict patterns.'
            : 'No critical dosha clash detected in current profile inputs.',
        ],
      },
      'Matching completed',
    );
  }

  async createProfile(userId: string, dto: CreateCompatibilityProfileDto) {
    const dob = new Date(dto.dateOfBirth);
    if (Number.isNaN(dob.getTime())) {
      throw new BadRequestException('Invalid dateOfBirth');
    }
    await this.ensurePartnerCompareWillSucceed(userId, dto.zodiacSign);

    const prisma = this.prisma as any;
    const profile = await prisma.compatibilityProfile.create({
      data: {
        userId,
        fullName: dto.fullName.trim(),
        gender: dto.gender.trim(),
        dateOfBirth: dob,
        zodiacSign: dto.zodiacSign.trim(),
        birthLocation: dto.birthLocation.trim(),
        timeOfBirth: dto.timeOfBirth.trim(),
        ...(dto.purpose != null && dto.purpose.trim().length > 0
          ? { purpose: dto.purpose.trim() }
          : {}),
        ...(dto.compatibilityScore !== undefined && dto.compatibilityScore !== null
          ? { compatibilityScore: dto.compatibilityScore }
          : {}),
      },
    });
    return okResponse(profile, 'Compatibility profile created');
  }

  async listProfiles(userId: string) {
    const prisma = this.prisma as any;
    const items = await prisma.compatibilityProfile.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return okResponse(items, 'Compatibility profiles fetched');
  }

  async getProfile(userId: string, id: string) {
    const prisma = this.prisma as any;
    const item = await prisma.compatibilityProfile.findUnique({
      where: { id },
    });
    if (!item) throw new NotFoundException('Compatibility profile not found');
    if (item.userId !== userId) throw new ForbiddenException('Forbidden');
    return okResponse(item, 'Compatibility profile fetched');
  }

  async updateProfile(userId: string, id: string, dto: UpdateCompatibilityProfileDto) {
    const prisma = this.prisma as any;
    const existing = await prisma.compatibilityProfile.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Compatibility profile not found');
    if (existing.userId !== userId) throw new ForbiddenException('Forbidden');

    const mergedZodiac = normalizeWesternZodiacSign(
      dto.zodiacSign !== undefined ? dto.zodiacSign : existing.zodiacSign,
    );
    if (!WESTERN_SUN_SIGNS.includes(mergedZodiac as WesternSunSign)) {
      throw new BadRequestException('zodiacSign must be a Western sun sign.');
    }

    const mergedDob =
      dto.dateOfBirth !== undefined ? new Date(dto.dateOfBirth) : existing.dateOfBirth;
    if (Number.isNaN(mergedDob.getTime())) {
      throw new BadRequestException('Invalid dateOfBirth');
    }

    await this.ensurePartnerCompareWillSucceed(userId, mergedZodiac);

    const updated = await prisma.compatibilityProfile.update({
      where: { id },
      data: {
        ...(dto.fullName != null ? { fullName: dto.fullName.trim() } : {}),
        ...(dto.gender != null ? { gender: dto.gender.trim() } : {}),
        ...(dto.dateOfBirth != null ? { dateOfBirth: mergedDob } : {}),
        ...(dto.zodiacSign != null ? { zodiacSign: mergedZodiac } : {}),
        ...(dto.birthLocation != null ? { birthLocation: dto.birthLocation.trim() } : {}),
        ...(dto.timeOfBirth != null ? { timeOfBirth: dto.timeOfBirth.trim() } : {}),
        ...(dto.purpose !== undefined
          ? {
              purpose:
                dto.purpose != null && dto.purpose.trim().length > 0 ? dto.purpose.trim() : null,
            }
          : {}),
      },
    });
    return okResponse(updated, 'Compatibility profile updated');
  }

  /**
   * Ensures the signed-in user can run {@link compare} against this partner sign (same gates as subatime compareMatch).
   */
  private async ensurePartnerCompareWillSucceed(userId: string, partnerZodiacSign: string): Promise<void> {
    const z = partnerZodiacSign.trim();
    if (!z) {
      throw new BadRequestException({
        message: 'Partner zodiac sign is required.',
        code: 'PARTNER_ZODIAC_REQUIRED',
      });
    }

    const me = await this.prisma.birthProfile.findUnique({ where: { userId } });
    if (!me) {
      throw new BadRequestException({
        message: 'Complete your birth profile before saving partner profiles.',
        code: 'USER_BIRTH_PROFILE_REQUIRED',
      });
    }

    const chart = await this.prisma.astrologyChart.findFirst({
      where: { birthProfileId: me.id },
      orderBy: { version: 'desc' },
    });
    const cd = (chart?.chartData as Record<string, unknown>) ?? {};
    const lagnaMe = String(me.lagna ?? cd?.lagna ?? '').trim();
    const nakshatraMe = String(me.nakshatra ?? cd?.nakshatra ?? '').trim();
    if (!lagnaMe || !nakshatraMe) {
      throw new BadRequestException({
        message:
          'Your chart is missing ascendant or nakshatra. Update birth details from Profile before saving partners.',
        code: 'USER_CHART_INCOMPLETE',
      });
    }

    this.compare({
      profileA: {
        lagna: lagnaMe,
        nakshatra: nakshatraMe,
        moonSign: lagnaMe,
        marsHouse: 0,
      },
      profileB: {
        lagna: z,
        nakshatra: z,
        moonSign: z,
        marsHouse: 0,
      },
    });
  }

  async removeProfile(userId: string, id: string) {
    const prisma = this.prisma as any;
    const existing = await prisma.compatibilityProfile.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Compatibility profile not found');
    if (existing.userId !== userId) throw new ForbiddenException('Forbidden');
    await prisma.compatibilityProfile.delete({ where: { id } });
    return okResponse({ id }, 'Compatibility profile deleted');
  }

  private pickStr(...vals: unknown[]): string | undefined {
    for (const v of vals) {
      if (typeof v === 'string' && v.trim().length > 0) return v.trim();
    }
    return undefined;
  }

  /**
   * Requires explicit identifiers — no silent default lagna/nakshatra (avoids fake scores).
   */
  private normalizeProfileStrict(profile: Record<string, unknown>) {
    const lagna = this.pickStr(profile.lagna, profile.ascendant, profile.zodiacSign);
    const nakshatra = this.pickStr(profile.nakshatra, profile.moonSign, profile.zodiacSign);
    if (!lagna || !nakshatra) {
      throw new BadRequestException({
        message:
          'Insufficient birth-chart data for compatibility. Provide lagna/ascendant or zodiac sign, and nakshatra or moon sign.',
        code: 'MATCH_INSUFFICIENT_DATA',
      });
    }
    const moonSign = this.pickStr(profile.moonSign, profile.zodiacSign, lagna)!;
    const marsHouse = Number(profile.marsHouse ?? 0);
    return { lagna, nakshatra, moonSign, marsHouse };
  }

  private scoreCommunication(a: { moonSign: string; nakshatra: string }, b: { moonSign: string; nakshatra: string }): number {
    let score = 62;
    if (a.moonSign === b.moonSign) score += 12;
    if (a.nakshatra[0] === b.nakshatra[0]) score += 8;
    return Math.min(95, score);
  }

  private scoreIntimacy(a: { nakshatra: string }, b: { nakshatra: string }): number {
    const diff = Math.abs(a.nakshatra.length - b.nakshatra.length);
    return Math.max(55, 88 - diff * 2);
  }

  private scoreLongTerm(a: { lagna: string }, b: { lagna: string }): number {
    const compatiblePairs = new Set([
      'Mesha-Dhanu',
      'Vrishabha-Kanya',
      'Mithuna-Kumbha',
      'Karka-Meena',
      'Simha-Dhanu',
      'Makara-Vrishabha',
    ]);
    const key = `${a.lagna}-${b.lagna}`;
    const reverse = `${b.lagna}-${a.lagna}`;
    return compatiblePairs.has(key) || compatiblePairs.has(reverse) ? 86 : 66;
  }

  private scoreEmotional(a: { moonSign: string }, b: { moonSign: string }): number {
    return a.moonSign === b.moonSign ? 90 : 72;
  }

  private detectDosha(a: { marsHouse: number }, b: { marsHouse: number }) {
    const manglikHouses = new Set([1, 4, 7, 8, 12]);
    const aManglik = manglikHouses.has(a.marsHouse);
    const bManglik = manglikHouses.has(b.marsHouse);
    return {
      aManglik,
      bManglik,
      hasManglikMismatch: aManglik !== bManglik,
    };
  }
}
