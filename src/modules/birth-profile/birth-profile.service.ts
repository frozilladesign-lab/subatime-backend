import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../../database/prisma.service';
import { okResponse } from '../../common/utils/response.util';
import { find as geoTzFind } from 'geo-tz';
import { UpsertBirthProfileAuthDto, UpsertBirthProfileDto } from './dto/birth-profile.dto';
import { ChartService } from '../astrology/services/chart.service';

@Injectable()
export class BirthProfileService {
  private readonly logger = new Logger(BirthProfileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chartService: ChartService,
  ) {}

  /** Legacy upsert by arbitrary user id (bootstrap tooling only). */
  async upsert(dto: UpsertBirthProfileDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      select: { id: true },
    });
    if (!user) {
      await this.prisma.user.create({
        data: {
          id: dto.userId,
          name: 'User',
          email: `${dto.userId}@local.subatime`,
        },
      });
    }

    let lat = dto.latitude;
    let lon = dto.longitude;
    if ((!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) && dto.placeOfBirth.trim()) {
      try {
        const g = await this.geocode(dto.placeOfBirth.trim());
        lat = g.lat;
        lon = g.lon;
      } catch (e) {
        this.logger.warn(`Geocode failed for legacy upsert: ${String(e)}`);
      }
    }

    const dateOfBirth = new Date(`${dto.dateOfBirth}T00:00:00.000Z`);
    const tzResolved = this.resolveTimezone(lat, lon);
    const tz =
      tzResolved ??
      (dto.timezone?.trim() ? dto.timezone.trim() : 'UTC');
    const timezoneSource = tzResolved ? 'geo-tz' : dto.timezone?.trim() ? 'user-input' : 'legacy-unknown';
    const localClock = this.normalizeClock(dto.timeOfBirth);
    const timeOfBirth = this.composeBirthInstant(dto.dateOfBirth, localClock, tz);
    const timezoneOffsetMinutes = this.resolveOffsetMinutes(
      dto.dateOfBirth,
      localClock,
      tz,
    );
    const accuracy = this.normalizeBirthTimeAccuracy(dto.birthTimeAccuracy);

    const profile = await this.prisma.birthProfile.upsert({
      where: { userId: dto.userId },
      update: {
        birthLocalDate: dto.dateOfBirth,
        birthLocalTime: localClock,
        birthUtcTime: timeOfBirth,
        dateOfBirth,
        timeOfBirth,
        placeOfBirth: dto.placeOfBirth,
        latitude: lat,
        longitude: lon,
        onboardingIntent: dto.onboardingIntent ?? undefined,
        birthTimeAccuracy: accuracy ?? undefined,
        timezone: tz,
        timezoneSource,
        timezoneOffsetMinutes,
        migrationSource: null,
      },
      create: {
        userId: dto.userId,
        birthLocalDate: dto.dateOfBirth,
        birthLocalTime: localClock,
        birthUtcTime: timeOfBirth,
        dateOfBirth,
        timeOfBirth,
        placeOfBirth: dto.placeOfBirth,
        latitude: lat,
        longitude: lon,
        onboardingIntent: dto.onboardingIntent ?? null,
        birthTimeAccuracy: accuracy ?? null,
        timezone: tz,
        timezoneSource,
        timezoneOffsetMinutes,
        migrationSource: null,
      },
    });
    await this.refreshChartSnapshot(dto.userId, profile.id, {
      fullName: 'User',
      birthDate: dto.dateOfBirth,
      birthTime: localClock,
      birthPlace: dto.placeOfBirth,
      latitude: lat,
      longitude: lon,
      timezone: tz,
    });

    return okResponse(profile, 'Birth profile saved');
  }

  async upsertForAuthedUser(userId: string, dto: UpsertBirthProfileAuthDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    let lat = dto.latitude ?? 0;
    let lon = dto.longitude ?? 0;
    const needsGeo =
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      (lat === 0 && lon === 0);

    if (needsGeo) {
      const coords = await this.geocode(dto.placeOfBirth.trim());
      lat = coords.lat;
      lon = coords.lon;
    }

    if (dto.predictionTier === 'veryAccurate') {
      if (this.normalizeBirthTimeAccuracy(dto.birthTimeAccuracy) !== 'exact') {
        throw new BadRequestException(
          'Very accurate tier requires birth time marked as exact.',
        );
      }
      const coordsWeak =
        !Number.isFinite(lat) ||
        !Number.isFinite(lon) ||
        (Math.abs(lat) < 1e-7 && Math.abs(lon) < 1e-7);
      if (coordsWeak) {
        throw new BadRequestException(
          'Very accurate tier requires resolved latitude and longitude for birthplace.',
        );
      }
    }

    const tzResolved = this.resolveTimezone(lat, lon);
    const tz =
      tzResolved ??
      (dto.timezone?.trim() ? dto.timezone.trim() : null);
    const timezoneSource = tzResolved ? 'geo-tz' : dto.timezone?.trim() ? 'user-input' : 'legacy-unknown';
    const localClock = this.normalizeClock(dto.timeOfBirth);
    const dateOfBirth = new Date(`${dto.dateOfBirth}T00:00:00.000Z`);
    const timeOfBirth = this.composeBirthInstant(
      dto.dateOfBirth,
      localClock,
      tz ?? 'UTC',
    );
    const timezoneOffsetMinutes = this.resolveOffsetMinutes(
      dto.dateOfBirth,
      localClock,
      tz ?? 'UTC',
    );
    const accuracy = this.normalizeBirthTimeAccuracy(dto.birthTimeAccuracy);
    const intentNorm = this.normalizeIntent(dto.onboardingIntent);
    const normalizedName = dto.fullName?.trim();
    if (normalizedName && normalizedName.length >= 2 && normalizedName !== user.name) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { name: normalizedName },
      });
    }

    const profile = await this.prisma.birthProfile.upsert({
      where: { userId },
      update: {
        birthLocalDate: dto.dateOfBirth,
        birthLocalTime: localClock,
        birthUtcTime: timeOfBirth,
        dateOfBirth,
        timeOfBirth,
        placeOfBirth: dto.placeOfBirth.trim(),
        latitude: lat,
        longitude: lon,
        onboardingIntent: intentNorm ?? undefined,
        birthTimeAccuracy: accuracy ?? undefined,
        timezone: tz ?? undefined,
        timezoneSource,
        timezoneOffsetMinutes,
        migrationSource: null,
        predictionTier: dto.predictionTier ?? undefined,
      },
      create: {
        userId,
        birthLocalDate: dto.dateOfBirth,
        birthLocalTime: localClock,
        birthUtcTime: timeOfBirth,
        dateOfBirth,
        timeOfBirth,
        placeOfBirth: dto.placeOfBirth.trim(),
        latitude: lat,
        longitude: lon,
        onboardingIntent: intentNorm,
        birthTimeAccuracy: accuracy ?? null,
        timezone: tz,
        timezoneSource,
        timezoneOffsetMinutes,
        migrationSource: null,
        predictionTier: dto.predictionTier ?? null,
      },
    });
    await this.refreshChartSnapshot(userId, profile.id, {
      fullName:
        normalizedName && normalizedName.length >= 2
          ? normalizedName
          : (user.name?.trim() || user.email.split('@')[0] || 'User'),
      birthDate: dto.dateOfBirth,
      birthTime: localClock,
      birthPlace: dto.placeOfBirth.trim(),
      latitude: lat,
      longitude: lon,
      timezone: tz ?? 'UTC',
    });

    return okResponse(profile, 'Birth profile saved');
  }

  async getMine(userId: string) {
    const profile = await this.prisma.birthProfile.findUnique({
      where: { userId },
    });
    if (!profile) {
      throw new NotFoundException('Birth profile not found');
    }
    return okResponse(profile, 'Birth profile fetched');
  }

  async getAuditSnapshot(userId: string) {
    const profile = await this.prisma.birthProfile.findUnique({ where: { userId } });
    if (!profile) {
      throw new NotFoundException('Birth profile not found');
    }

    const localDate = profile.birthLocalDate ?? profile.dateOfBirth.toISOString().slice(0, 10);
    const localTime = profile.birthLocalTime ?? DateTime.fromJSDate(profile.timeOfBirth, { zone: 'UTC' }).toFormat('HH:mm');
    const timezone = profile.timezone ?? 'UTC';
    const local = DateTime.fromISO(`${localDate}T${localTime}:00`, { zone: timezone });
    const utc = local.isValid ? local.toUTC() : DateTime.fromJSDate(profile.timeOfBirth, { zone: 'UTC' });
    const storedUtc = profile.birthUtcTime ?? profile.timeOfBirth;
    const recomputedUtc = utc.toJSDate();
    const recomputedMatchesStored =
      Math.abs(recomputedUtc.getTime() - storedUtc.getTime()) <= 1000;

    const generated = this.chartService.generate({
      fullName: 'Audit Snapshot',
      birthDate: localDate,
      birthTime: localTime,
      birthPlace: profile.placeOfBirth,
      latitude: profile.latitude,
      longitude: profile.longitude,
      timezone,
      ayanamsa: 'lahiri',
    });
    const chart = (generated.chartData ?? {}) as Record<string, unknown>;
    const planetMap = (generated.planetaryData ?? {}) as Record<string, unknown>;

    const offsetMinutes =
      profile.timezoneOffsetMinutes ?? (local.isValid ? local.offset : 0);

    return okResponse(
      {
        input: {
          birthLocalDate: localDate,
          birthLocalTime: localTime,
          birthTimezone: timezone,
          birthPlace: profile.placeOfBirth,
          latitude: profile.latitude,
          longitude: profile.longitude,
        },
        timezoneResolution: {
          source: profile.timezoneSource ?? 'legacy-unknown',
          offsetMinutes,
          historicalOffsetVerified: offsetMinutes !== null,
        },
        normalization: {
          localDateTime: local.isValid ? local.toISO() : null,
          utcDateTime: utc.toUTC().toISO(),
          unixTimestamp: Math.floor(storedUtc.getTime() / 1000),
        },
        calculation: {
          julianDay: chart['julianDay'] ?? null,
          ayanamsa: chart['ayanamsaMode'] ?? 'lahiri',
          houseSystem: chart['houseSystem'] ?? 'whole-sign',
          ephemerisVersion: chart['ephemeris'] ?? 'unknown',
        },
        derived: {
          sunSign: planetMap['sun'] ?? null,
          moonSign: planetMap['moon'] ?? null,
          ascendant: generated.lagna ?? null,
        },
        integrity: {
          recomputedUtcMatchesStoredUtc: recomputedMatchesStored,
          migrationSource: profile.migrationSource ?? null,
          birthTimeAccuracy: profile.birthTimeAccuracy ?? 'unknown',
        },
      },
      'Birth chart audit snapshot fetched',
    );
  }

  private normalizeIntent(raw?: string): string | null {
    const t = raw?.trim();
    return t ? t : null;
  }

  private resolveTimezone(lat: number, lon: number): string | null {
    try {
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const zones = geoTzFind(lat, lon);
      return zones?.length ? zones[0] : null;
    } catch (e) {
      this.logger.warn(`geo-tz lookup failed: ${String(e)}`);
      return null;
    }
  }

  private composeBirthInstant(
    dateOfBirth: string,
    timeOfBirth: string,
    timezone: string,
  ): Date {
    const local = DateTime.fromISO(`${dateOfBirth}T${timeOfBirth}:00`, {
      zone: timezone,
    });
    if (!local.isValid) {
      return new Date(`${dateOfBirth}T12:00:00.000Z`);
    }
    return local.toUTC().toJSDate();
  }

  private normalizeClock(value: string): string {
    const t = value.trim();
    if (t.length === 4 && !t.includes(':')) {
      return `${t.slice(0, 2)}:${t.slice(2)}`;
    }
    if (t.length >= 5 && t.includes(':')) return t.slice(0, 5);
    return '12:00';
  }

  private resolveOffsetMinutes(
    dateOfBirth: string,
    timeOfBirth: string,
    timezone: string,
  ): number | null {
    const local = DateTime.fromISO(`${dateOfBirth}T${timeOfBirth}:00`, {
      zone: timezone,
    });
    if (!local.isValid) return null;
    return local.offset;
  }

  private normalizeBirthTimeAccuracy(
    raw?: string | null,
  ): 'exact' | 'approx' | 'unknown' | null {
    const v = raw?.trim().toLowerCase();
    if (!v) return null;
    if (v === 'exact') return 'exact';
    if (v === 'approx' || v === 'approximate') return 'approx';
    if (v === 'unknown') return 'unknown';
    return null;
  }

  private async geocode(place: string): Promise<{ lat: number; lon: number }> {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(place)}&format=json&limit=1`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'SubatimeBackend/1.0 (birth-profile geocode)',
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      throw new BadRequestException('Geocoding service unavailable');
    }
    const rows = (await res.json()) as { lat?: string; lon?: string }[];
    if (!rows?.length || rows[0].lat == null || rows[0].lon == null) {
      throw new BadRequestException(`Could not resolve coordinates for “${place}”.`);
    }
    return { lat: Number(rows[0].lat), lon: Number(rows[0].lon) };
  }

  private async refreshChartSnapshot(
    userId: string,
    birthProfileId: string,
    input: {
      fullName: string;
      birthDate: string;
      birthTime: string;
      birthPlace: string;
      latitude: number;
      longitude: number;
      timezone: string;
    },
  ): Promise<void> {
    try {
      const generated = this.chartService.generate({
        fullName: input.fullName,
        birthDate: input.birthDate,
        birthTime: input.birthTime,
        birthPlace: input.birthPlace,
        latitude: input.latitude,
        longitude: input.longitude,
        timezone: input.timezone,
        ayanamsa: 'lahiri',
      });
      const latest = await this.prisma.astrologyChart.findFirst({
        where: { birthProfileId },
        orderBy: { version: 'desc' },
      });
      const version = (latest?.version ?? 0) + 1;
      await this.prisma.astrologyChart.create({
        data: {
          birthProfileId,
          version,
          chartData: generated.chartData as any,
          planetaryData: generated.planetaryData as any,
        },
      });
      await this.prisma.birthProfile.update({
        where: { id: birthProfileId },
        data: {
          lagna: generated.lagna,
          nakshatra: generated.nakshatra,
        },
      });
    } catch (e) {
      this.logger.warn(`Chart snapshot refresh failed: ${String(e)}`);
    }
  }
}
