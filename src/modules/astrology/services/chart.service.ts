import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { JyotishaChartEngine } from '@subatime/jyotisha-engine';
import type { GeneratedChart, PlanetaryData } from '@subatime/jyotisha-engine';
import { GenerateChartDto } from '../dto/astrology.dto';

export { SIDEREAL_SIGNS, NAKSHATRA_LIST } from '@subatime/jyotisha-engine';
export type { AspectHit, BirthMomentUtc, BirthTimeResolution, PlanetaryStrength } from '@subatime/jyotisha-engine';

/**
 * Thin NestJS wrapper around the pure `@subatime/jyotisha-engine` chart engine.
 * Keep this file free of calculation logic — that lives in the engine package so it
 * can be reused outside this backend (and tested without NestJS).
 */
@Injectable()
export class ChartService implements OnModuleDestroy {
  private readonly engine = new JyotishaChartEngine();

  onModuleDestroy(): void {
    this.engine.close();
  }

  generate(dto: GenerateChartDto): GeneratedChart {
    return this.engine.generate(dto);
  }

  moonSiderealLongitudeUtc(dateUtc: Date, ayanamsaMode?: string): number {
    return this.engine.moonSiderealLongitudeUtc(dateUtc, ayanamsaMode);
  }

  sunSiderealLongitudeUtc(dateUtc: Date, ayanamsaMode?: string): number {
    return this.engine.sunSiderealLongitudeUtc(dateUtc, ayanamsaMode);
  }

  nakshatraNameFromMoonLongitude(moonLongitude: number): string {
    return this.engine.nakshatraNameFromMoonLongitude(moonLongitude);
  }

  planetSiderealLongitudeUtc(
    dateUtc: Date,
    planet: 'saturn' | 'jupiter' | 'mars' | 'rahu' | 'ketu',
    ayanamsaMode?: string,
  ): number {
    return this.engine.planetSiderealLongitudeUtc(dateUtc, planet, ayanamsaMode);
  }
}

export type { PlanetaryData };
