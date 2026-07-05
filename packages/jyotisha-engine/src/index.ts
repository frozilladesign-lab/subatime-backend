export { JyotishaChartEngine, SIDEREAL_SIGNS, NAKSHATRA_LIST } from './chart/chart-engine';
export type {
  AccuracyMetadata,
  AccuracyTier,
  AspectHit,
  BirthMomentUtc,
  BirthTimeResolution,
  GeneratedChart,
  GenerateChartInput,
  PlanetLongitudes,
  PlanetName,
  PlanetaryData,
  PlanetaryStrength,
} from './types/chart';
export { ChartCalculationError } from './types/chart';

export { TARA_NAMES_EN, taraIndex1to9, taraNameEn, taraScoreFromIndex1to9 } from './calendar/tara';
export {
  getHoraFavorability,
  resolveLagnaEnglishKey,
  subhaDirectionOppositeMaru,
} from './calendar/hora-lagna';

export type { DayTransitAspectType, DayTransitDto, DayTransitNatalReference, DayTransitType } from './scoring/day-transits';
export { computeRealDailyTransitCards, deriveDailyTransitsFromPool } from './scoring/day-transits';

export type { FeedbackContextCounts } from './scoring/feedback-weights';
export {
  DEFAULT_CONTEXT_WEIGHTS,
  accuracyScoreFromCounts,
  contextWeightsFromCounts,
  weightAdjustmentFromAccuracy,
} from './scoring/feedback-weights';

export type {
  ChartLongitudeSource,
  ScoreBreakdownComponent,
  ScoreParts,
  ScoredBlock,
  ScoringAccuracyMetadata,
  TimeBlock,
} from './scoring/scoring-engine';
export { JyotishaScoringEngine, SCORE_COMPONENT_WEIGHTS } from './scoring/scoring-engine';

export type {
  AshtakootaCompatibilityResult,
  AshtakootaKootaResult,
  CompatibilityBreakdown,
  CompatibilityResult,
  DoshaFlags,
  NormalizedCompatibilityProfile,
  RawCompatibilityProfile,
} from './matching/types';
export { MatchProfileError } from './matching/types';
export type { ManglikAnalysisInput, ManglikAnalysisResult } from './matching/dosha';
export { analyzeManglikDosha, detectDosha } from './matching/dosha';
export {
  compareCompatibility,
  compareHeuristicCompatibility,
  normalizeProfileStrict,
} from './matching/compatibility-engine';
export { compareAshtakootaCompatibility } from './matching/ashtakoota';

export { AlmanacCalculationError } from './almanac/errors';
export type {
  PanchangaChartSource,
  PanchangaInput,
  PanchangaResult,
} from './almanac/panchanga';
export { computePanchanga } from './almanac/panchanga';
export type { SunriseSunsetResult } from './almanac/sunrise-sunset';
export { computeSunriseSunset } from './almanac/sunrise-sunset';
export type { TithiResult } from './almanac/tithi';
export { computeTithi } from './almanac/tithi';
export type { YogaResult } from './almanac/yoga';
export { computeYoga } from './almanac/yoga';
export type { NakshatraSnapshot } from './almanac/nakshatra-timeline';
export { computeNakshatraSnapshot } from './almanac/nakshatra-timeline';
export type { HoraSegment, HoraTimelineResult } from './almanac/hora';
export { CHALDEAN_LORDS, computeHoraTimeline } from './almanac/hora';
export type { DaySegment, RahuKalamResult } from './almanac/rahu-kalam';
export { computeRahuKalam } from './almanac/rahu-kalam';

export type {
  BestWindowNotificationCandidate,
  BlockNotificationCandidate,
  BuildNotificationCandidatesInput,
  FavorableHoraInput,
  NotificationBlockType,
  NotificationCandidateAstroSource,
  NotificationCandidates,
  NotificationContext,
  PowerHourNotificationCandidate,
} from './prediction/notification-candidates';
export type {
  GuidanceNotificationCandidate,
  NotificationCandidateCategory,
  NotificationFocusArea,
  NotificationImportance,
  NotificationTone,
} from './prediction/notification-candidates';
export { buildNotificationCandidates } from './prediction/notification-candidates';

export type {
  BuildNotificationPlanInput,
  DroppedNotification,
  NotificationFrequency,
  NotificationPlan,
  NotificationPlanSettings,
  PlannedNotification,
} from './prediction/notification-plan';
export { buildNotificationPlan } from './prediction/notification-plan';

export type {
  ActiveHouse,
  ChartContextInput,
  ChartContextResult,
  CoreContext,
  LifeTheme,
  TransitLongitude,
} from './prediction/chart-context';
export { computeChartContext, coreContextOf, wholeSignHouse as wholeSignHouseFromRef } from './prediction/chart-context';

export type {
  DigestDayInput,
  DigestDayRef,
  MonthlyDigest,
  MonthlyDigestInput,
  WeeklyDigest,
  WeeklyDigestInput,
} from './prediction/digest';
export { buildMonthlyDigest, buildWeeklyDigest } from './prediction/digest';
