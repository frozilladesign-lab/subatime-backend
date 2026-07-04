/** Plain input for chart generation — structurally compatible with backend's GenerateChartDto. */
export interface GenerateChartInput {
  userId?: string;
  fullName?: string;
  birthDate: string;
  birthTime: string;
  birthPlace: string;
  latitude?: number;
  longitude?: number;
  ayanamsa?: 'lahiri' | 'krishnamurti';
  /** IANA id from birth profile (e.g. Asia/Colombo); optional on anonymous chart requests. */
  timezone?: string;
  /** Whole-sign rising override (Mesha…Meena); rotates houses vs computed ascendant. */
  lagnaUserOverride?: string;
}

export type PlanetName = 'sun' | 'moon' | 'mars' | 'mercury' | 'jupiter' | 'venus' | 'saturn' | 'rahu' | 'ketu';
export type PlanetaryData = Record<PlanetName, string>;
export type PlanetLongitudes = Record<PlanetName, number>;

export type AspectHit = {
  from: PlanetName;
  to: PlanetName;
  /** Canonical angle matched (0, 60, 90, 120, 180). */
  aspect: number;
  /** True smallest geocentric separation in degrees (0–180). */
  separation: number;
};

export type PlanetaryStrength = Record<PlanetName, number>;

/** How birth local time was turned into UTC for the ephemeris. */
export type BirthTimeResolution = 'iana-local' | 'utc-wallclock-fallback';

export type BirthMomentUtc = {
  utc: Date;
  /** IANA zone used when resolution is iana-local (e.g. Asia/Colombo). */
  zoneUsed: string;
  resolution: BirthTimeResolution;
  /** ISO-8601 local wall-clock string as given (with zone offset), before UTC conversion. */
  inputLocalDateTime: string;
};

export type GeneratedChart = {
  lagna: string;
  nakshatra: string;
  planetaryData: PlanetaryData;
  chartData: Record<string, unknown>;
};

/** Provenance tier for a calculated value — see `AccuracyMetadata`. */
export type AccuracyTier = 'ephemeris' | 'approximate' | 'classical-rule' | 'heuristic';

/**
 * Transparent provenance for a calculated result.
 * - "ephemeris": Swiss Ephemeris astronomical position — sub-degree accurate.
 * - "approximate": legacy mean-orbit math. Legacy calculations are approximate and may be
 *   wrong near sign, nakṣatra, pāda, aspect, or house boundaries. They must not be used for
 *   production-grade chart interpretation.
 * - "classical-rule": a deterministic classical Jyotiṣya rule applied exactly as documented
 *   (e.g. Manglik houses, Vimśottarī sequence, Aṣṭakūṭa koota tables) — not a probabilistic
 *   astronomical measurement, but not a product/scoring heuristic either. Regional variations
 *   in classical rules exist; "classical-rule" means "applied this specific documented rule
 *   exactly," not "the only correct interpretation."
 * - "heuristic": product/scoring logic (not an astronomical or classical-rule claim).
 */
export type AccuracyMetadata = {
  tier: AccuracyTier;
  degraded: boolean;
  degradedReason?: string;
  verifiedAgainst?: string[];
  notes?: string[];
};

/**
 * Thrown when a production-grade chart calculation cannot be produced (e.g. Swiss Ephemeris
 * failed in `CHART_ENGINE=strict-swiss` mode, where silent fallback to legacy math is disallowed).
 */
export class ChartCalculationError extends Error {
  readonly code: string;
  readonly cause?: unknown;

  constructor(message: string, code: string, cause?: unknown) {
    super(message);
    this.name = 'ChartCalculationError';
    this.code = code;
    this.cause = cause;
  }
}
