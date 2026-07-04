import { taraIndex1to9, taraScoreFromIndex1to9 } from '../calendar/tara';
import { NAKSHATRA_LIST } from '../chart/chart-engine';
import {
  computeRealDailyTransitCards,
  deriveDailyTransitsFromPool,
  type DayTransitDto,
  type DayTransitType,
} from './day-transits';

export type { DayTransitAspectType, DayTransitDto, DayTransitNatalReference, DayTransitType } from './day-transits';
export { computeRealDailyTransitCards, deriveDailyTransitsFromPool } from './day-transits';

export type TimeBlock = { start: string; end: string; label: string };

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

/** Component key → weight in the combined score formula. Must sum to exactly 1.0. */
export const SCORE_COMPONENT_WEIGHTS: Record<keyof Omit<ScoreParts, 'dignityAndTime' | 'finalScore'>, number> = {
  moonTransit: 0.25,
  nakshatraTara: 0.18,
  aspects: 0.13,
  dasha: 0.09,
  antara: 0.09,
  slowTransits: 0.09,
  grahahDrishti: 0.07,
  rahuKetuTransit: 0.06,
  transitMoonDignity: 0.03,
};
/** Time-of-day bias weight — kept separate from `ScoreParts` (only surfaced via `dignityAndTime`/breakdown). */
const TIME_OF_DAY_WEIGHT = 0.01;

const COMPONENT_TYPE: Record<string, 'astronomical' | 'heuristic' | 'product'> = {
  moonTransit: 'heuristic',
  nakshatraTara: 'heuristic',
  aspects: 'heuristic',
  dasha: 'heuristic',
  antara: 'heuristic',
  slowTransits: 'heuristic',
  grahahDrishti: 'heuristic',
  rahuKetuTransit: 'heuristic',
  transitMoonDignity: 'heuristic',
  timeOfDay: 'product',
};

const COMPONENT_EXPLANATION: Record<string, string> = {
  moonTransit:
    'Whole-sign house of the transiting Moon counted from both the ascendant (45%) and the natal ' +
    'Moon sign / Janma Rāśi (55%); classical kendra/trikona-vs-dusthāna house favorability.',
  nakshatraTara:
    'Tārā Bāla — nakṣatra count from the birth star to the transiting Moon\'s nakṣatra, reduced to ' +
    'one of nine tārā categories.',
  aspects:
    'Soft-aspect (conjunction/trine/sextile favorable, square/opposition unfavorable) angular ' +
    'relationship of the transiting Moon to natal Moon, Sun, and ascendant.',
  dasha: 'Mahādaśā lord\'s natural affinity with the Moon (Moon-ruled or Moon-friendly lords score higher).',
  antara: 'Antardaśā lord\'s classical planetary-friendship (maitri) relationship with the mahādaśā lord.',
  slowTransits:
    'Saturn/Jupiter transit house from natal Moon sign — captures Sade Sātī and Jupiter\'s classically ' +
    'favorable/unfavorable transit houses.',
  grahahDrishti: 'Special house-based aspects (graha dṛṣṭi) of Saturn, Jupiter, and Mars onto the natal Moon sign.',
  rahuKetuTransit: 'Rāhu/Ketu transit house from the natal Moon sign.',
  transitMoonDignity: 'Exaltation / own-sign / debilitation of the transiting Moon.',
  timeOfDay: 'Mild morning/evening time-of-day bias (product convenience, not a classical signal).',
};

export type ScoreBreakdownComponent = {
  component: string;
  rawValue: number;
  weight: number;
  weightedContribution: number;
  /** "astronomical" = direct ephemeris fact, "heuristic" = classical interpretive rule, "product" = non-classical convenience. */
  type: 'astronomical' | 'heuristic' | 'product';
  explanation: string;
};

/**
 * This score is a weighted interpretation model based on selected Jyotiṣya signals — it is
 * product/scoring logic, not a verifiable astronomical fact. See `ScoreBreakdownComponent.type`
 * for which inputs are direct astronomical calculations vs. classical/product heuristics.
 */
export type ScoringAccuracyMetadata = {
  tier: 'heuristic';
  degraded: boolean;
  notes: string[];
};

export type ScoredBlock = {
  block: TimeBlock;
  score: number;
  parts: ScoreParts;
  scoreBreakdown: ScoreBreakdownComponent[];
  accuracy: ScoringAccuracyMetadata;
};

/** Minimal surface the scoring engine needs from a chart engine (duck-typed; satisfied by `JyotishaChartEngine`). */
export interface ChartLongitudeSource {
  moonSiderealLongitudeUtc(dateUtc: Date, ayanamsaMode?: string): number;
  planetSiderealLongitudeUtc(
    dateUtc: Date,
    planet: 'saturn' | 'jupiter' | 'mars' | 'rahu' | 'ketu',
    ayanamsaMode?: string,
  ): number;
}

/** Pure sidereal day/time-block scoring engine. No NestJS, no DB. */
export class JyotishaScoringEngine {
  constructor(private readonly chartSource: ChartLongitudeSource) {}

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
      ? this.chartSource.planetSiderealLongitudeUtc(dayUtc, 'saturn', ayanamsaMode)
      : null;
    const jupiterLon = snap
      ? this.chartSource.planetSiderealLongitudeUtc(dayUtc, 'jupiter', ayanamsaMode)
      : null;
    const marsLon = snap
      ? this.chartSource.planetSiderealLongitudeUtc(dayUtc, 'mars', ayanamsaMode)
      : null;
    const rahuLon = snap
      ? this.chartSource.planetSiderealLongitudeUtc(dayUtc, 'rahu', ayanamsaMode)
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
      const transitMoon = this.chartSource.moonSiderealLongitudeUtc(tMid, ayanamsaMode);
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

      const rawValues: Record<keyof typeof SCORE_COMPONENT_WEIGHTS, number> = {
        moonTransit: moonTransitN,
        nakshatraTara: nakTaraN,
        aspects: aspectN,
        dasha: dashaN,
        antara: antaraN,
        slowTransits: slowTransitDayN,
        grahahDrishti: grahahDrishtiDayN,
        rahuKetuTransit: rahuKetuDayN,
        transitMoonDignity: transitMoonDignityN,
      };

      // Full scoring formula — 9 classical layers + time-of-day, total weight = 1.00
      let combined = 0;
      const scoreBreakdown: ScoreBreakdownComponent[] = [];
      for (const key of Object.keys(SCORE_COMPONENT_WEIGHTS) as (keyof typeof SCORE_COMPONENT_WEIGHTS)[]) {
        const weight = SCORE_COMPONENT_WEIGHTS[key];
        const rawValue = rawValues[key];
        const weightedContribution = Number((weight * rawValue).toFixed(6));
        combined += weightedContribution;
        scoreBreakdown.push({
          component: key,
          rawValue,
          weight,
          weightedContribution,
          type: COMPONENT_TYPE[key],
          explanation: COMPONENT_EXPLANATION[key],
        });
      }
      const timeWeightedContribution = Number((TIME_OF_DAY_WEIGHT * timeN).toFixed(6));
      combined += timeWeightedContribution;
      scoreBreakdown.push({
        component: 'timeOfDay',
        rawValue: timeN,
        weight: TIME_OF_DAY_WEIGHT,
        weightedContribution: timeWeightedContribution,
        type: COMPONENT_TYPE.timeOfDay,
        explanation: COMPONENT_EXPLANATION.timeOfDay,
      });

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
        scoreBreakdown,
        accuracy: {
          tier: 'heuristic',
          degraded: !snap,
          notes: [
            'This score is a weighted interpretation model based on selected Jyotiṣya signals — ' +
              'not a verifiable astronomical fact.',
            ...(!snap
              ? ['No natal chart snapshot was available; several components used neutral fallback values.']
              : []),
          ],
        },
      };
    });
  }

  /**
   * Daily transit highlight cards. When `chartData` carries natal ascendant/Moon/Sun longitudes,
   * computes real transit-Moon aspect cards via `computeRealDailyTransitCards` (each stamped
   * `isComputed: true`). Falls back to the static, clearly-`degraded` card pool only when those
   * natal longitudes aren't available. Pass lang='si' to receive Sinhala title + description
   * (fallback path only — computed cards are English-only for now).
   */
  deriveDailyTransits(params: {
    date: Date;
    userId: string;
    onboardingIntent?: string | null;
    lagna: string;
    nakshatra: string;
    lang?: string;
    /** Birth chart snapshot (ascendant, planet longitudes) — enables real transit computation. */
    chartData?: Record<string, unknown>;
  }): DayTransitDto[] {
    const cd = params.chartData;
    const asc = Number(cd?.ascendantLongitude);
    const pl = cd?.planetLongitudes as Record<string, unknown> | undefined;
    const natalMoon = Number(pl?.moon);
    const natalSun = Number(pl?.sun);
    const ayanamsaMode = typeof cd?.ayanamsaMode === 'string' ? cd.ayanamsaMode : undefined;

    if (cd && Number.isFinite(asc) && Number.isFinite(natalMoon) && Number.isFinite(natalSun)) {
      const dayNoonUtc = new Date(
        Date.UTC(
          params.date.getUTCFullYear(),
          params.date.getUTCMonth(),
          params.date.getUTCDate(),
          12,
          0,
          0,
        ),
      );
      const transitMoonLongitude = this.chartSource.moonSiderealLongitudeUtc(dayNoonUtc, ayanamsaMode);
      return computeRealDailyTransitCards({
        transitMoonLongitude,
        natalAscendantLongitude: asc,
        natalMoonLongitude: natalMoon,
        natalSunLongitude: natalSun,
        lang: params.lang,
      });
    }

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
