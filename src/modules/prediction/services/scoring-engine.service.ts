import { Injectable } from '@nestjs/common';
import { taraIndex1to9, taraScoreFromIndex1to9 } from '../../astrology/jyotisha-tara';
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
  antara: number;
  slowTransits: number;
  grahahDrishti: number;
  rahuKetuTransit: number;
  transitMoonDignity: number;
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
    const antaraLord = snap?.antaraLord ?? '';

    // Slow planets are constant for the whole day — compute once outside the block loop.
    const saturnLon = snap
      ? this.chartService.planetSiderealLongitudeUtc(dayUtc, 'saturn', ayanamsaMode)
      : null;
    const jupiterLon = snap
      ? this.chartService.planetSiderealLongitudeUtc(dayUtc, 'jupiter', ayanamsaMode)
      : null;
    const marsLon = snap
      ? this.chartService.planetSiderealLongitudeUtc(dayUtc, 'mars', ayanamsaMode)
      : null;
    const rahuLon = snap
      ? this.chartService.planetSiderealLongitudeUtc(dayUtc, 'rahu', ayanamsaMode)
      : null;

    const slowTransitDayN = snap && saturnLon !== null && jupiterLon !== null
      ? this.slowPlanetTransitScore(saturnLon, jupiterLon, snap.natalMoonSid)
      : 0.5;
    const grahahDrishtiDayN = snap && saturnLon !== null && jupiterLon !== null && marsLon !== null
      ? this.grahahDrishtiScore(saturnLon, jupiterLon, marsLon, snap.natalMoonSid)
      : 0.5;
    const rahuKetuDayN = snap && rahuLon !== null
      ? this.rahuKetuTransitScore(rahuLon, snap.natalMoonSid)
      : 0.5;

    return input.blocks.map((block, idx) => {
      const tMid = this.blockMidpointUtc(dayUtc, block);
      const transitMoon = this.chartService.moonSiderealLongitudeUtc(tMid, ayanamsaMode);
      const transitNakIdx = Math.floor(this.norm360(transitMoon) / (360 / 27));

      const moonHouseLagna = snap
        ? this.wholeSignHouse(transitMoon, snap.ascendantLongitude)
        : this.fallbackHouseFromLagna(input.lagna, idx);
      /** Janma Rāśi (Chandra lagna): whole-sign house from natal Moon — weights Sri Lankan Gochara emphasis. */
      const moonHouseChandra = snap
        ? this.wholeSignHouse(transitMoon, snap.natalMoonSid)
        : moonHouseLagna;
      const moonTransitN = snap
        ? Number(
            (
              0.55 * this.normalizeMoonHouseScore(moonHouseChandra) +
              0.45 * this.normalizeMoonHouseScore(moonHouseLagna)
            ).toFixed(4),
          )
        : this.normalizeMoonHouseScore(moonHouseLagna);

      const nakTaraN = this.nakshatraTaraScore(transitNakIdx, natalNakIdx);
      const aspectN = snap
        ? this.aspectLayerScore(transitMoon, snap.natalMoonSid, snap.natalSunSid, snap.ascendantLongitude)
        : 0.5;
      const dashaN = this.dashaMoonAffinity(dashaLord);
      const antaraN = this.antaraAffinity(dashaLord, antaraLord);
      const transitMoonDignityN = this.transitMoonDignity(transitMoon);
      const dignityN = moonStrength;
      const timeN = this.timeContextScore(tMid);

      const dignityAndTime = Number((0.5 * dignityN + 0.5 * timeN).toFixed(4));

      // Full scoring formula — 9 classical layers, total = 1.00
      let combined =
        0.25 * moonTransitN +        // Gochara (Chandra lagna blend)
        0.18 * nakTaraN +            // Tara Bāla (9-tara)
        0.13 * aspectN +             // Transiting Moon aspects vs natal
        0.09 * dashaN +              // Mahādaśā lord affinity
        0.09 * antaraN +             // Antara (sub-period) lord affinity
        0.09 * slowTransitDayN +     // Saturn / Jupiter house from Janma Rāśi
        0.07 * grahahDrishtiDayN +   // Graha Drishti (special aspects) — NEW
        0.06 * rahuKetuDayN +        // Rahu/Ketu transit vs Janma Rāśi — NEW
        0.03 * transitMoonDignityN + // Transit Moon dignity (exalt/debil)
        0.01 * timeN;                // Time-of-day context

      const feedbackM = Number(
        Math.min(1.15, Math.max(0.85, input.feedbackWeightAdjustment)).toFixed(4),
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
          antara: antaraN,
          slowTransits: slowTransitDayN,
          grahahDrishti: grahahDrishtiDayN,
          rahuKetuTransit: rahuKetuDayN,
          transitMoonDignity: transitMoonDignityN,
          dignityAndTime,
          finalScore: Number(combined.toFixed(4)),
        },
      };
    });
  }

  /** Surface-level transit copy. Pass lang='si' to receive Sinhala title + description. */
  deriveDailyTransits(params: {
    date: Date;
    userId: string;
    onboardingIntent?: string | null;
    lagna: string;
    nakshatra: string;
    lang?: string;
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
    antaraLord: string;
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
    const antaraRaw = dasha?.antara;
    const antaraLord = typeof antaraRaw === 'string' ? antaraRaw.trim() : '';

    return {
      ascendantLongitude: this.norm360(asc),
      natalMoonSid: this.norm360(moon),
      natalSunSid: Number.isFinite(sun) ? this.norm360(sun) : this.norm360(moon + 90),
      planetStrength: { moon: Number.isFinite(moonStr) ? this.clamp01(moonStr) : 0.55 },
      dashaLord,
      antaraLord,
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
   * Tara Bāla from birth nakṣatra to transiting Moon nakṣatra (nine-fold), mapped to 0–1 for scoring.
   */
  private nakshatraTaraScore(transitIdx: number, natalIdx: number): number {
    const ti = taraIndex1to9(natalIdx, transitIdx);
    return taraScoreFromIndex1to9(ti);
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

  /**
   * Antara (sub-period) lord affinity with the mahādaśā lord, 0–1.
   * Uses classical natural planetary friendship/enmity table.
   */
  private antaraAffinity(dashaLord: string, antaraLord: string): number {
    if (!dashaLord || !antaraLord) return 0.55;
    if (dashaLord === antaraLord) return 0.88; // same lord = strong continuity

    // Natural friends (mitra): score 0.75
    const FRIENDS: Record<string, string[]> = {
      Sun:     ['Moon', 'Mars', 'Jupiter'],
      Moon:    ['Sun', 'Mercury'],
      Mars:    ['Sun', 'Moon', 'Jupiter'],
      Mercury: ['Sun', 'Venus'],
      Jupiter: ['Sun', 'Moon', 'Mars'],
      Venus:   ['Mercury', 'Saturn'],
      Saturn:  ['Mercury', 'Venus'],
      Rahu:    ['Saturn', 'Venus', 'Mercury'],
      Ketu:    ['Mars', 'Venus', 'Saturn'],
    };
    // Natural enemies (shatru): score 0.30
    const ENEMIES: Record<string, string[]> = {
      Sun:     ['Venus', 'Saturn', 'Rahu', 'Ketu'],
      Moon:    ['Rahu', 'Ketu'],
      Mars:    ['Mercury', 'Rahu', 'Ketu'],
      Mercury: ['Moon', 'Rahu', 'Ketu'],
      Jupiter: ['Mercury', 'Venus', 'Rahu', 'Ketu'],
      Venus:   ['Sun', 'Moon', 'Rahu', 'Ketu'],
      Saturn:  ['Sun', 'Moon', 'Mars', 'Rahu', 'Ketu'],
      Rahu:    ['Sun', 'Moon', 'Mars', 'Ketu'],
      Ketu:    ['Sun', 'Moon', 'Mercury', 'Rahu'],
    };

    if (FRIENDS[dashaLord]?.includes(antaraLord)) return 0.75;
    if (ENEMIES[dashaLord]?.includes(antaraLord)) return 0.30;
    return 0.55; // neutral (sama)
  }

  /**
   * Saturn & Jupiter transit quality relative to Janma Rāśi (natal Moon sign).
   * This captures Sade Sati (Saturn transit over natal Moon ±1 sign) and
   * Jupiter's beneficial/challenging transit houses — major Sri Lankan Jyotiṣya factors.
   * Returns 0–1 combined score.
   */
  private slowPlanetTransitScore(saturnLon: number, jupiterLon: number, natalMoonSid: number): number {
    // House of transit planet counted from natal Moon sign (Janma Rāśi)
    const houseFromMoon = (transitLon: number): number =>
      Math.floor(this.norm360(transitLon - natalMoonSid) / 30) + 1;

    const satHouse = houseFromMoon(saturnLon);
    const jupHouse = houseFromMoon(jupiterLon);

    // Saturn transit quality: Sade Sati = houses 12, 1, 2 (very difficult)
    // Houses 3, 6, 11 = ok; 10 = mixed but industrious; rest = challenging
    let saturnScore: number;
    if ([12, 1, 2].includes(satHouse)) saturnScore = 0.18;      // Sade Sati
    else if ([3, 6, 11].includes(satHouse)) saturnScore = 0.72; // Favourable Saturn houses
    else if (satHouse === 10) saturnScore = 0.52;                // Work-heavy but ok
    else saturnScore = 0.35;                                      // Challenging transit

    // Jupiter transit quality: 2, 5, 7, 9, 11 = favourable (Guru transit good houses)
    // 8, 12 = difficult; others = moderate
    let jupiterScore: number;
    if (jupHouse === 11) jupiterScore = 0.92;                    // Best Jupiter transit
    else if ([2, 5, 9].includes(jupHouse)) jupiterScore = 0.80; // Very favourable
    else if (jupHouse === 7) jupiterScore = 0.70;                // Moderately good
    else if ([8, 12].includes(jupHouse)) jupiterScore = 0.28;   // Difficult
    else if ([6].includes(jupHouse)) jupiterScore = 0.42;        // Mixed
    else jupiterScore = 0.55;                                     // Neutral

    // Saturn weighs slightly more — it has bigger negative impact in Sri Lankan practice
    return this.clamp01(0.55 * saturnScore + 0.45 * jupiterScore);
  }

  /**
   * Graha Drishti — special house aspects of slow planets onto natal Moon sign.
   * Saturn aspects 3rd, 7th, 10th sign from itself (malefic drishti on Moon = reduce).
   * Jupiter aspects 5th, 7th, 9th sign (benefic drishti on Moon = boost).
   * Mars aspects 4th, 7th, 8th sign (malefic drishti on Moon = reduce).
   * Returns 0–1 combined quality.
   */
  private grahahDrishtiScore(
    saturnLon: number,
    jupiterLon: number,
    marsLon: number,
    natalMoonSid: number,
  ): number {
    const signOf = (lon: number) => Math.floor(this.norm360(lon) / 30); // 0–11
    const natalMoonSign = signOf(natalMoonSid);

    const aspectsSign = (planetSign: number, offsets: number[]): boolean =>
      offsets.some((o) => (planetSign + o - 1 + 12) % 12 === natalMoonSign);

    // Jupiter drishti on natal Moon → benefic boost
    const jupDrishti = aspectsSign(signOf(jupiterLon), [5, 7, 9]);
    // Saturn drishti on natal Moon → malefic reduction
    const satDrishti = aspectsSign(signOf(saturnLon), [3, 7, 10]);
    // Mars drishti on natal Moon → malefic reduction (stronger than Saturn)
    const marsDrishti = aspectsSign(signOf(marsLon), [4, 7, 8]);

    let score = 0.55; // neutral baseline
    if (jupDrishti) score += 0.20;
    if (satDrishti) score -= 0.18;
    if (marsDrishti) score -= 0.22;
    return this.clamp01(score);
  }

  /**
   * Rahu / Ketu transit quality relative to Janma Rāśi (natal Moon sign).
   * Rahu moves retrograde ~1.5 years per sign — major life-phase influence.
   * Returns 0–1.
   */
  private rahuKetuTransitScore(rahuLon: number, natalMoonSid: number): number {
    const rahuHouse = Math.floor(this.norm360(rahuLon - natalMoonSid) / 30) + 1; // 1–12
    const ketuHouse = ((rahuHouse + 5) % 12) + 1; // always opposite

    // Rahu quality from Janma Rāśi
    let rahuScore: number;
    if ([3, 6, 11].includes(rahuHouse)) rahuScore = 0.72;      // Upachaya = growth
    else if ([1, 2, 12].includes(rahuHouse)) rahuScore = 0.28; // Very challenging
    else if ([5, 9].includes(rahuHouse)) rahuScore = 0.42;     // Spiritual; worldly mixed
    else if ([4, 7].includes(rahuHouse)) rahuScore = 0.38;     // Unstable
    else rahuScore = 0.52;                                      // Moderate

    // Ketu quality from Janma Rāśi (moksha-karaka; detachment)
    let ketuScore: number;
    if ([3, 6, 11].includes(ketuHouse)) ketuScore = 0.68;
    else if ([1, 12].includes(ketuHouse)) ketuScore = 0.32;
    else if ([5, 9].includes(ketuHouse)) ketuScore = 0.60;     // Spiritually beneficial
    else ketuScore = 0.50;

    return this.clamp01(0.60 * rahuScore + 0.40 * ketuScore);
  }

  /**
   * Transit Moon dignity: exaltation / own sign / debilitation.
   * Moon exalted in Vrishabha (Taurus), debilitated in Vrischika (Scorpio),
   * own sign Karka (Cancer). Returns 0–1.
   */
  private transitMoonDignity(transitMoonLon: number): number {
    const signIdx = Math.floor(this.norm360(transitMoonLon) / 30); // 0=Mesha … 11=Meena
    // Vrishabha=1 (exalt), Karka=3 (own), Vrischika=7 (debil)
    if (signIdx === 1) return 1.0;   // Exaltation (Vrishabha)
    if (signIdx === 3) return 0.85;  // Own sign (Karka)
    if (signIdx === 7) return 0.15;  // Debilitation (Vrischika)
    // Friendly signs for Moon: Mesha, Mithuna, Simha, Kanya, Dhanu, Meena
    if ([0, 2, 4, 5, 8, 11].includes(signIdx)) return 0.65;
    return 0.50; // neutral
  }

  private clamp01(v: number): number {
    return Number(Math.min(1, Math.max(0, v)).toFixed(4));
  }
}
