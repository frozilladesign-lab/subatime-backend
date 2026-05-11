import { Injectable } from '@nestjs/common';
import { ChartService, NAKSHATRA_LIST } from '../../astrology/services/chart.service';
import {
  deriveDailyTransitsFromPool,
  type DayTransitDto,
  type DayTransitType,
} from './day-transits';

export type { DayTransitDto, DayTransitType } from './day-transits';

type TimeBlock = { start: string; end: string; label: string };

export type ScoreParts = {
  moonTransit: number;
  nakshatraTara: number;
  aspects: number;
  dasha: number;
  dignityAndTime: number;
  finalScore: number;
};

export type ScoredBlock = {
  block: TimeBlock;
  score: number;
  parts: ScoreParts;
};

@Injectable()
export class ScoringEngineService {
  constructor(private readonly chartService: ChartService) {}

  scoreBlocks(input: {
    blocks: TimeBlock[];
    lagna: string;
    nakshatra: string;
    date: Date;
    planetaryData: Record<string, unknown>;
    /**
     * Accuracy-derived nudge only (`FeedbackLearningService.getWeightAdjustment`).
     * Clamped to `[0.94, 1.06]` here so chart math stays anchored.
     */
    feedbackWeightAdjustment: number;
    /**
     * Context accent on block scores (typically ~0.90–1.10 from `accentMultiplierFromContextWeight`).
     * Applied *after* the feedback clamp so it does not erase sub‑6% accuracy nuance.
     */
    primaryContextWeight?: number;
    /** Birth chart snapshot (ascendant, longitudes, dasha, planetStrength). */
    chartData?: Record<string, unknown>;
    /** 0–1; lower when birth time unknown (optional). */
    dataQuality?: number;
  }): ScoredBlock[] {
    const snap = this.parseChartSnapshot(input.chartData);
    const nameIdx = (NAKSHATRA_LIST as readonly string[]).indexOf(input.nakshatra.trim());
    const natalNakIdx = snap
      ? Math.floor(this.norm360(snap.natalMoonSid) / (360 / 27))
      : (nameIdx >= 0 ? nameIdx : 0);

    const dayUtc = this.utcDayStart(input.date);
    const ayanamsaMode =
      typeof input.chartData?.ayanamsaMode === 'string' ? input.chartData.ayanamsaMode : undefined;
    const moonStrength = snap?.planetStrength?.moon ?? 0.55;
    const dashaLord = snap?.dashaLord ?? '';

    return input.blocks.map((block, idx) => {
      const tMid = this.blockMidpointUtc(dayUtc, block);
      const transitMoon = this.chartService.moonSiderealLongitudeUtc(tMid, ayanamsaMode);
      const transitNakIdx = Math.floor(this.norm360(transitMoon) / (360 / 27));

      const moonHouse = snap
        ? this.wholeSignHouse(transitMoon, snap.ascendantLongitude)
        : this.fallbackHouseFromLagna(input.lagna, idx);
      const moonTransitN = this.normalizeMoonHouseScore(moonHouse);

      const nakTaraN = this.nakshatraTaraScore(transitNakIdx, natalNakIdx);
      const aspectN = snap
        ? this.aspectLayerScore(transitMoon, snap.natalMoonSid, snap.natalSunSid, snap.ascendantLongitude)
        : 0.5;
      const dashaN = this.dashaMoonAffinity(dashaLord);
      const dignityN = moonStrength;
      const timeN = this.timeContextScore(tMid);

      const dignityAndTime = Number((0.5 * dignityN + 0.5 * timeN).toFixed(4));

      let combined =
        0.3 * moonTransitN +
        0.25 * nakTaraN +
        0.2 * aspectN +
        0.15 * dashaN +
        0.05 * dignityN +
        0.05 * timeN;

      const feedbackM = Number(
        Math.min(1.06, Math.max(0.94, input.feedbackWeightAdjustment)).toFixed(4),
      );
      const contextScale = input.primaryContextWeight ?? 1;
      combined *= feedbackM;
      combined *= contextScale;
      combined = this.clamp01(combined);

      return {
        block,
        score: Number(combined.toFixed(4)),
        parts: {
          moonTransit: moonTransitN,
          nakshatraTara: nakTaraN,
          aspects: aspectN,
          dasha: dashaN,
          dignityAndTime,
          finalScore: Number(combined.toFixed(4)),
        },
      };
    });
  }

  /** Surface-level transit copy for Day Plan until ephemeris aspects are fully wired. */
  deriveDailyTransits(params: {
    date: Date;
    userId: string;
    onboardingIntent?: string | null;
    lagna: string;
    nakshatra: string;
  }): DayTransitDto[] {
    return deriveDailyTransitsFromPool(params);
  }

  calculateConfidence(scored: ScoredBlock[], dataQuality = 0.85): number {
    const sorted = [...scored].sort((a, b) => b.score - a.score);
    const top = sorted.slice(0, 2);
    if (!top.length) return 0.5;
    const avgTop = top.reduce((s, x) => s + x.score, 0) / top.length;
    const spread = sorted[0].score - sorted[sorted.length - 1].score;
    const consistency = spread > 0.22 ? 0.08 : 0;
    const base = 0.42 + avgTop * 0.48 + consistency;
    return Number(Math.min(0.92, Math.max(0.48, base * dataQuality)).toFixed(2));
  }

  private parseChartSnapshot(cd: Record<string, unknown> | undefined): {
    ascendantLongitude: number;
    natalMoonSid: number;
    natalSunSid: number;
    planetStrength: { moon: number };
    dashaLord: string;
  } | null {
    if (!cd) return null;
    const asc = Number(cd.ascendantLongitude);
    const pl = cd.planetLongitudes as Record<string, unknown> | undefined;
    const moon = Number(pl?.moon);
    const sun = Number(pl?.sun);
    if (!Number.isFinite(asc) || !Number.isFinite(moon)) return null;

    const ps = cd.planetStrength as Record<string, unknown> | undefined;
    const moonStr = Number(ps?.moon);
    const dasha = cd.dasha as Record<string, unknown> | undefined;
    const lordRaw = dasha?.current;
    const dashaLord = typeof lordRaw === 'string' ? lordRaw.trim() : '';

    return {
      ascendantLongitude: this.norm360(asc),
      natalMoonSid: this.norm360(moon),
      natalSunSid: Number.isFinite(sun) ? this.norm360(sun) : this.norm360(moon + 90),
      planetStrength: { moon: Number.isFinite(moonStr) ? this.clamp01(moonStr) : 0.55 },
      dashaLord,
    };
  }

  private utcDayStart(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }

  private blockMidpointUtc(dayUtc: Date, block: TimeBlock): Date {
    const [sh, sm] = this.parseClock(block.start);
    const [eh, em] = this.parseClock(block.end);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    const mid = Math.round((startMin + endMin) / 2);
    const h = Math.floor(mid / 60);
    const m = mid % 60;
    return new Date(
      Date.UTC(dayUtc.getUTCFullYear(), dayUtc.getUTCMonth(), dayUtc.getUTCDate(), h, m, 0),
    );
  }

  private parseClock(s: string): [number, number] {
    const [a, b] = s.split(':').map((x) => Number(x.trim()));
    return [Number.isFinite(a) ? a : 0, Number.isFinite(b) ? b : 0];
  }

  private norm360(x: number): number {
    const n = x % 360;
    return n < 0 ? n + 360 : n;
  }

  private smallestArc(a: number, b: number): number {
    let d = Math.abs(this.norm360(a) - this.norm360(b)) % 360;
    if (d > 180) d = 360 - d;
    return d;
  }

  private wholeSignHouse(moonSid: number, ascSid: number): number {
    const rel = this.norm360(moonSid - ascSid);
    return Math.floor(rel / 30) + 1;
  }

  /** Map house to 0–1 (favourable dusthana penalty encoded). */
  private normalizeMoonHouseScore(house: number): number {
    let raw = 0.12;
    if ([1, 5, 9].includes(house)) raw = 1;
    else if ([4, 7, 10].includes(house)) raw = 0.7;
    else if ([2, 11].includes(house)) raw = 0.5;
    else if ([6, 8, 12].includes(house)) raw = -0.7;
    return this.clamp01((raw + 0.7) / 1.7);
  }

  /**
   * Distance between birth star and transit Moon star (27-fold), then tiered score.
   */
  private nakshatraTaraScore(transitIdx: number, natalIdx: number): number {
    const d = (transitIdx - natalIdx + 27) % 27;
    if ([0, 2, 4, 6].includes(d)) return 1;
    if ([1, 3, 5].includes(d)) return 0.72;
    return 0.28;
  }

  private gauss(delta: number, target: number, orb: number): number {
    const x = delta - target;
    return Math.exp(-(x * x) / (2 * orb * orb));
  }

  /** Transiting Moon vs natal Moon / Sun / ascendant: soft conjunctions, trines, squares, oppositions. */
  private aspectLayerScore(trMoon: number, natMoon: number, natSun: number, asc: number): number {
    const targets: { t: number; w: number; orb: number }[] = [
      { t: 0, w: 1.0, orb: 8 },
      { t: 120, w: 0.55, orb: 7 },
      { t: 60, w: 0.35, orb: 5 },
      { t: 90, w: -0.65, orb: 6 },
      { t: 180, w: -0.95, orb: 8 },
    ];
    const scorePoint = (lon: number): number => {
      const sep = this.smallestArc(trMoon, lon);
      let s = 0;
      for (const { t, w, orb } of targets) {
        s += w * this.gauss(sep, t, orb);
      }
      return s;
    };
    const raw = (scorePoint(natMoon) + scorePoint(natSun) + scorePoint(asc)) / 3;
    return this.clamp01((raw + 1.1) / 2.2);
  }

  private dashaMoonAffinity(lord: string): number {
    const L = lord.trim();
    if (!L) return 0.55;
    if (L === 'Moon') return 0.88;
    if (['Sun', 'Mercury', 'Jupiter'].includes(L)) return 0.62;
    if (['Venus', 'Mars', 'Saturn'].includes(L)) return 0.42;
    if (['Rahu', 'Ketu'].includes(L)) return 0.32;
    return 0.5;
  }

  private timeContextScore(utc: Date): number {
    const h = utc.getUTCHours();
    let v = 0.52;
    if (h >= 6 && h < 10) v += 0.18;
    else if (h >= 17 && h < 22) v += 0.12;
    return this.clamp01(v);
  }

  /** Legacy-friendly fallback if chart JSON is missing longitudes. */
  private fallbackHouseFromLagna(_lagna: string, idx: number): number {
    const cycle = [1, 5, 9, 4, 7, 10, 2, 11];
    return cycle[idx % cycle.length] ?? 3;
  }

  private clamp01(v: number): number {
    return Number(Math.min(1, Math.max(0, v)).toFixed(4));
  }
}
