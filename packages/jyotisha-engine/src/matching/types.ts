export type RawCompatibilityProfile = Record<string, unknown>;

export type NormalizedCompatibilityProfile = {
  lagna: string;
  nakshatra: string;
  moonSign: string;
  marsHouse: number;
};

export type DoshaFlags = {
  aManglik: boolean;
  bManglik: boolean;
  hasManglikMismatch: boolean;
};

export type CompatibilityBreakdown = {
  communication: number;
  intimacy: number;
  longTerm: number;
  emotional: number;
};

export type CompatibilityResult = {
  /** Labels which compatibility method produced this result — always "heuristic" for this type. */
  method: 'heuristic';
  score: number;
  summary: string;
  breakdown: CompatibilityBreakdown;
  doshaFlags: DoshaFlags;
  recommendations: string[];
};

export type AshtakootaKootaResult = {
  name: string;
  score: number;
  maxScore: number;
  explanation: string;
};

export type AshtakootaCompatibilityResult = {
  method: 'ashtakoota';
  totalScore: number;
  maxScore: 36;
  percentage: number;
  kootas: AshtakootaKootaResult[];
  warnings: string[];
  doshaNotes: string[];
  accuracy: {
    tier: 'classical-rule';
    degraded: false;
    notes: string[];
  };
};

/** Thrown when a raw profile is missing the minimum chart identifiers needed to compare. */
export class MatchProfileError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = 'MatchProfileError';
  }
}
