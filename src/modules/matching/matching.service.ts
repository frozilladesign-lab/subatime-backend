import { BadRequestException, Injectable } from '@nestjs/common';
import { MatchProfileError, compareCompatibility } from '@subatime/jyotisha-engine';
import { okResponse } from '../../common/utils/response.util';
import { PrismaService } from '../../database/prisma.service';
import { CompareMatchingDto } from './dto/matching.dto';
import { CreateCompatibilityProfileDto } from './dto/profile.dto';

@Injectable()
export class MatchingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Orchestration only — normalization, scoring, and dosha detection live in
   * `@subatime/jyotisha-engine`. This just translates its plain `MatchProfileError`
   * into the NestJS `BadRequestException` the API contract expects.
   *
   * Not exposed over HTTP — used internally to gate {@link createProfile} and by
   * `SubatimeService.compareMatch` (`POST /api/subatime/match/compare`).
   */
  compare(dto: CompareMatchingDto) {
    try {
      const result = compareCompatibility(dto.profileA, dto.profileB);
      return okResponse(result, 'Matching completed');
    } catch (err) {
      if (err instanceof MatchProfileError) {
        throw new BadRequestException({ message: err.message, code: err.code });
      }
      throw err;
    }
  }

  async createProfile(userId: string, dto: CreateCompatibilityProfileDto) {
    const dob = new Date(dto.dateOfBirth);
    if (Number.isNaN(dob.getTime())) {
      throw new BadRequestException('Invalid dateOfBirth');
    }
    await this.ensurePartnerCompareWillSucceed(userId, dto.zodiacSign);

    const profile = await this.prisma.compatibilityProfile.create({
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
    const cdLagna = typeof cd.lagna === 'string' ? cd.lagna : '';
    const cdNakshatra = typeof cd.nakshatra === 'string' ? cd.nakshatra : '';
    const lagnaMe = (me.lagna ?? cdLagna ?? '').trim();
    const nakshatraMe = (me.nakshatra ?? cdNakshatra ?? '').trim();
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
}
