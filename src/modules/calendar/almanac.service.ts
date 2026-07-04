import { BadRequestException, Injectable } from '@nestjs/common';
import { AlmanacCalculationError, computePanchanga } from '@subatime/jyotisha-engine';
import { okResponse } from '../../common/utils/response.util';
import { ChartService } from '../astrology/services/chart.service';
import { CalendarDayQueryDto } from './dto/calendar-day-query.dto';

type CachedEnvelope = ReturnType<typeof okResponse>;

/**
 * Thin NestJS orchestrator: validation, caching, and HTTP error translation only. The actual
 * pañcāṅga math (tithi, yoga, nakṣatra, sunrise/sunset, Abhijit, Rāhu kāla/Yamagaṇḍa/Gulika,
 * horā timelines) lives in `@subatime/jyotisha-engine`'s `computePanchanga` (pure, no NestJS/
 * DB/HTTP/Firebase) so it can be tested and reused outside this backend.
 */
@Injectable()
export class AlmanacService {
  private readonly cache = new Map<string, { expiresAt: number; payload: CachedEnvelope }>();
  private readonly cacheTtlMs = 6 * 60 * 60 * 1000;
  private readonly cacheMaxEntries = 512;

  constructor(private readonly chartService: ChartService) {}

  computeDay(dto: CalendarDayQueryDto): CachedEnvelope {
    const key = this.cacheKey(dto);
    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > now) {
      return hit.payload;
    }

    const payload = this.computeDayUncached(dto);
    this.pruneCache(now);
    if (this.cache.size >= this.cacheMaxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(key, { expiresAt: now + this.cacheTtlMs, payload });
    return payload;
  }

  private computeDayUncached(dto: CalendarDayQueryDto): CachedEnvelope {
    try {
      const result = computePanchanga(
        {
          date: dto.date,
          timezone: dto.timezone,
          latitude: dto.latitude,
          longitude: dto.longitude,
          lagna: dto.lagna,
        },
        this.chartService,
      );
      return okResponse(result, 'Calendar day almanac computed');
    } catch (err) {
      if (err instanceof AlmanacCalculationError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  private cacheKey(dto: CalendarDayQueryDto): string {
    const lat = Number(dto.latitude.toFixed(4));
    const lon = Number(dto.longitude.toFixed(4));
    const lagna = (dto.lagna ?? '').trim();
    return `${dto.date}|${dto.timezone.trim()}|${lat}|${lon}|${lagna}`;
  }

  private pruneCache(now: number): void {
    for (const [k, v] of this.cache) {
      if (v.expiresAt <= now) this.cache.delete(k);
    }
  }
}
