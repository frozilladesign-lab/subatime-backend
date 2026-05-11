import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { PrismaService } from '../../database/prisma.service';
import { okResponse } from '../../common/utils/response.util';
import { find as geoTzFind } from 'geo-tz';
import { UpsertBirthProfileAuthDto, UpsertBirthProfileDto } from './dto/birth-profile.dto';
import { PatchBirthProfileDto } from './dto/patch-birth-profile.dto';
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

  async suggestPlaces(_userId: string, query: string) {
    const q = query.trim();
    if (q.length < 2) {
      return okResponse({ items: [] as unknown[] }, 'Places suggestions');
    }
    if (q.length > 200) {
      throw new BadRequestException('Search text is too long.');
    }

    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&addressdetails=0`;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          'User-Agent': 'SubatimeBackend/1.0 (birth-profile places)',
          Accept: 'application/json',
        },
      });
    } catch (e) {
      this.logger.warn(`Places suggest fetch failed: ${String(e)}`);
      throw new ServiceUnavailableException('Location search is temporarily unavailable.');
    }
    if (!res.ok) {
      throw new ServiceUnavailableException('Location search is temporarily unavailable.');
    }
    const rows = (await res.json()) as { display_name?: string; lat?: string; lon?: string }[];
    if (!Array.isArray(rows)) {
      return okResponse({ items: [] }, 'Places suggestions');
    }
    const items = rows
      .map((r) => {
        const label = typeof r.display_name === 'string' ? r.display_name.trim() : '';
        const lat = Number(r.lat);
        const lon = Number(r.lon);
        if (!label || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        return { label, lat, lon };
      })
      .filter((x): x is { label: string; lat: number; lon: number } => x != null);
    return okResponse({ items }, 'Places suggestions');
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

    const explicitTz = dto.timezone?.trim();
    const tzResolved = this.resolveTimezone(lat, lon);
    const tz =
      explicitTz && this.isValidIanaZone(explicitTz)
        ? explicitTz
        : (tzResolved ?? (explicitTz ?? null));
    const timezoneSource =
      explicitTz && this.isValidIanaZone(explicitTz)
        ? 'user-input'
        : tzResolved
          ? 'geo-tz'
          : explicitTz
            ? 'user-input'
            : 'legacy-unknown';
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

    if (dto.gender?.trim()) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { gender: dto.gender.trim() },
      });
    }

    const lagnaStored = dto.userKnownLagna?.trim() ? dto.userKnownLagna.trim() : null;

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
        ...(dto.userKnownLagna !== undefined ? { userKnownLagna: lagnaStored } : {}),
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
        userKnownLagna: lagnaStored,
      },
    });

    await this.mergeOnboardingMoods(userId, dto.onboardingMoods);

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
      lagnaUserOverride: profile.userKnownLagna ?? undefined,
    });

    const refreshed = await this.prisma.birthProfile.findUnique({ where: { userId } });
    return okResponse(refreshed ?? profile, 'Birth profile saved');
  }

  async patchMine(userId: string, dto: PatchBirthProfileDto) {
    const profile = await this.prisma.birthProfile.findUnique({ where: { userId } });
    if (!profile) {
      throw new NotFoundException('Birth profile not found');
    }

    if (dto.gender?.trim()) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { gender: dto.gender.trim() },
      });
    }

    await this.mergeOnboardingMoods(userId, dto.onboardingMoods);

    let nextProfile = profile;
    const lagnaPatchProvided = dto.userKnownLagna !== undefined;
    if (lagnaPatchProvided) {
      const t = dto.userKnownLagna?.trim() ?? '';
      const stored = t.length ? t : null;
      nextProfile = await this.prisma.birthProfile.update({
        where: { userId },
        data: { userKnownLagna: stored },
      });
    }

    if (lagnaPatchProvided) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, name: true },
      });
      const birthDate =
        nextProfile.birthLocalDate ?? nextProfile.dateOfBirth.toISOString().slice(0, 10);
      const localClock =
        nextProfile.birthLocalTime ??
        DateTime.fromJSDate(nextProfile.timeOfBirth, { zone: 'UTC' }).toFormat('HH:mm');

      await this.refreshChartSnapshot(userId, nextProfile.id, {
        fullName: user?.name?.trim() || user?.email?.split('@')[0] || 'User',
        birthDate,
        birthTime: localClock,
        birthPlace: nextProfile.placeOfBirth,
        latitude: nextProfile.latitude,
        longitude: nextProfile.longitude,
        timezone: nextProfile.timezone ?? 'UTC',
        lagnaUserOverride: nextProfile.userKnownLagna ?? undefined,
      });
    }

    const out = await this.prisma.birthProfile.findUnique({ where: { userId } });
    return okResponse(out ?? nextProfile, 'Birth profile updated');
  }

  async getMine(userId: string) {
    const [profile, user] = await Promise.all([
      this.prisma.birthProfile.findUnique({ where: { userId } }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { gender: true, preferences: true },
      }),
    ]);
    if (!profile) {
      throw new NotFoundException('Birth profile not found');
    }
    const onboardingMoods = this.readOnboardingMoods(user?.preferences);
    return okResponse(
      { ...profile, gender: user?.gender ?? null, onboardingMoods },
      'Birth profile fetched',
    );
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
      lagnaUserOverride: profile.userKnownLagna ?? undefined,
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

  private isValidIanaZone(zone: string): boolean {
    const z = zone.trim();
    if (!z) return false;
    const dt = DateTime.now().setZone(z);
    return dt.isValid;
  }

  private readOnboardingMoods(raw: unknown): string[] {
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const m = (raw as Record<string, unknown>).onboardingMoods;
    if (!Array.isArray(m)) return [];
    return m.map((x) => String(x).trim()).filter(Boolean);
  }

  private async mergeOnboardingMoods(userId: string, moods?: string[] | null): Promise<void> {
    if (!moods?.length) return;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { preferences: true },
    });
    const baseRaw = user?.preferences;
    const base =
      baseRaw != null && typeof baseRaw === 'object' && !Array.isArray(baseRaw)
        ? { ...(baseRaw as Record<string, unknown>) }
        : {};
    const prev = base.onboardingMoods;
    const prevList = Array.isArray(prev) ? prev.map((x) => String(x).trim()).filter(Boolean) : [];
    const next = [...new Set([...prevList, ...moods.map((m) => m.trim()).filter(Boolean)])];
    base.onboardingMoods = next;
    await this.prisma.user.update({
      where: { id: userId },
      data: { preferences: base as Prisma.InputJsonValue },
    });
  }

  private normalizeIntent(raw?: string): string | null {
    const allowed = new Set(['love', 'career', 'growth', 'dreams']);
    const parts = (raw ?? '')
      .split(/[,]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => allowed.has(s));
    const uniq = [...new Set(parts)];
    if (!uniq.length) return null;
    uniq.sort();
    return uniq.join(',');
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
      lagnaUserOverride?: string;
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
        lagnaUserOverride: input.lagnaUserOverride,
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
