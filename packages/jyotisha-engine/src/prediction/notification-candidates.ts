import type { DayTransitDto } from '../scoring/day-transits';
import type { TimeBlock } from '../scoring/scoring-engine';

/**
 * Notification candidates — the single source of notification wording.
 *
 * The prediction engine decides meaning; this builder decides the message; delivery
 * services (Flutter local notifications first, backend FCM as fallback) only select
 * and send. Nothing here may talk to Firebase, the database, or any delivery mechanism.
 *
 * `buildNotificationCandidates` is deterministic: the same input always produces the
 * same candidates (no Date.now(), no randomness). All copy is emitted in both English
 * and Sinhala so no consumer ever needs its own fallback wording.
 *
 * Phase B: candidates carry a topical `category` and an `importance` level, copy is
 * shaped by the user's tone styles (up to two combined) and life-focus areas, and the
 * day's Rahu Kāla window is carried along so the plan builder can suppress
 * action-oriented alerts inside it. No scary or fixed-fate wording, ever.
 */

export type NotificationBlockType = 'peak' | 'strong' | 'caution' | 'neutral';
export type NotificationContext = 'career' | 'love' | 'health' | 'overall';

/** Topical category for settings-based filtering (Notifications & Guidance screen). */
export type NotificationCandidateCategory =
  | 'daily_guidance'
  | 'career'
  | 'education'
  | 'money'
  | 'relationship'
  | 'health'
  | 'travel'
  | 'business'
  | 'spiritual'
  | 'best_time'
  | 'avoid_time';

/** Delivery importance — the frequency filter keeps only the strongest. */
export type NotificationImportance = 'critical' | 'high' | 'medium' | 'low';

/** User tone styles; up to two are combined by the copy pipeline. */
export type NotificationTone =
  | 'simple'
  | 'spiritual'
  | 'practical'
  | 'detailed'
  | 'positive'
  | 'balanced';

/** Life-focus areas from notificationSettings.focusAreas. */
export type NotificationFocusArea =
  | 'career'
  | 'education'
  | 'money'
  | 'relationship'
  | 'travel'
  | 'business'
  | 'health'
  | 'spiritual';

export interface NotificationCandidateAstroSource {
  context: NotificationContext;
  dashaLord?: string;
  /** Title of the transit card whose description became the body, when transit-based. */
  transitLabel?: string;
  horaLord?: string;
  confidenceScore: number;
}

export interface BlockNotificationCandidate {
  /** Stable per-day id, e.g. `block-0600`. Usable as a delivery dedup key. */
  id: string;
  type: NotificationBlockType;
  /** Local wall-clock 'HH:mm' in `NotificationCandidates.timezone`. */
  startTime: string;
  endTime: string;
  /** Engine block score scaled to 0–100. */
  score: number;
  /** 1 = highest. peak=1, strong=2, primary caution=3, secondary caution=4, neutral=5. */
  priority: number;
  category: NotificationCandidateCategory;
  importance: NotificationImportance;
  title: string;
  titleSi: string;
  body: string;
  bodySi: string;
  deepLink: string;
  /** Machine-readable origin of the copy, e.g. `transit:moon_trine_jupiter` or `topic:money`. */
  reasonCode: string;
  astroSource: NotificationCandidateAstroSource;
}

export interface BestWindowNotificationCandidate {
  /** Stable id for plan/dedup references. */
  id: string;
  blockId: string;
  /** Local wall-clock 'HH:mm' — 8 minutes before the peak block starts. */
  sendAt: string;
  category: NotificationCandidateCategory;
  importance: NotificationImportance;
  title: string;
  titleSi: string;
  body: string;
  bodySi: string;
  deepLink: string;
}

export interface PowerHourNotificationCandidate {
  /** Stable id, e.g. `hora-Jupiter-2026-07-04T04:30:00.000Z`. */
  id: string;
  /** ISO UTC instant — 15 minutes before the horā starts. */
  sendAt: string;
  /** ISO UTC instants from the almanac horā timeline. */
  startTime: string;
  endTime: string;
  category: NotificationCandidateCategory;
  importance: NotificationImportance;
  title: string;
  titleSi: string;
  body: string;
  bodySi: string;
  horaLord: string;
  deepLink: string;
}

/** Morning/evening daily-guidance anchors; the plan assigns their send time from user preferences. */
export interface GuidanceNotificationCandidate {
  id: 'daily-morning' | 'daily-evening';
  slot: 'morning' | 'evening';
  category: 'daily_guidance';
  importance: NotificationImportance;
  title: string;
  titleSi: string;
  body: string;
  bodySi: string;
  deepLink: string;
  reasonCode: string;
}

export interface NotificationCandidates {
  version: 1;
  /** yyyy-MM-dd of the prediction day. */
  date: string;
  /** IANA timezone the local 'HH:mm' fields refer to. */
  timezone: string;
  blocks: BlockNotificationCandidate[];
  bestWindow?: BestWindowNotificationCandidate;
  powerHours: PowerHourNotificationCandidate[];
  /** Morning + evening daily-guidance candidates (Phase B). */
  guidance: GuidanceNotificationCandidate[];
  /** Rahu Kāla in local 'HH:mm', when the caller provided it — used for suppression. */
  rahuKalam?: { start: string; end: string };
  /** Tone styles the copy was built with (for debugging/inspection). */
  tonesApplied: NotificationTone[];
  /** Focus topic that shaped topical copy, when focus areas were provided. */
  focusTopic?: NotificationFocusArea;
}

export interface FavorableHoraInput {
  lord: string;
  /** ISO UTC. */
  startUtc: string;
  endUtc: string;
}

export interface BuildNotificationCandidatesInput {
  /** yyyy-MM-dd. */
  date: string;
  timezone: string;
  /** The 8 engine time blocks, in day order. */
  blocks: TimeBlock[];
  /** Per-block scores (0–1) keyed by matching block start; optional. */
  blockScores?: { start: string; score: number }[];
  /** Top-2 blocks by score (goodTimes[0] = peak). */
  goodTimes: TimeBlock[];
  /** Bottom-2 blocks by score (badTimes[0] = primary caution). */
  badTimes: TimeBlock[];
  transits: DayTransitDto[];
  confidenceScore: number;
  dominantContext: string;
  lagna: string;
  dashaLord?: string;
  /** Favorable horā windows for the day; omit to produce no power-hour candidates. */
  favorableHoras?: FavorableHoraInput[];
  /** Day summary line (guidance candidates draw from it). */
  summary?: string;
  /** User tone styles (max 2 honored); default practical+balanced keeps base copy. */
  tones?: string[];
  /** User life-focus areas — shape topic, copy emphasis, and importance boosts. */
  focusAreas?: string[];
  /** Rahu Kāla in LOCAL 'HH:mm' for `date` (caller converts from UTC). */
  rahuKalamLocal?: { start: string; end: string };
}

const BEST_WINDOW_LEAD_MIN = 8;
const POWER_HOUR_LEAD_MIN = 15;
const TRANSIT_BODY_MAX = 90;

/** Sinhala names for the 8 engine blocks (fallback: English label). */
const BLOCK_LABEL_SI: Record<string, string> = {
  'Early Morning': 'පුරා උදෑසන',
  'Morning Focus': 'උදෑසන කාලය',
  'Late Morning': 'අග උදෑසන',
  'Noon Window': 'දිවා කාලය',
  'Afternoon Push': 'දහවල් කාලය',
  'Evening Start': 'සන්ධ්‍යාව',
  'Evening Prime': 'සන්ධ්‍යා ප්‍රධාන',
  'Night Calm': 'රාත්‍රිය',
};

const LAGNA_EMOJI: Record<string, string> = {
  Mesha: '♈', Vrishabha: '♉', Mithuna: '♊', Karka: '♋',
  Simha: '♌', Kanya: '♍', Tula: '♎', Vrischika: '♏',
  Dhanu: '♐', Makara: '♑', Kumbha: '♒', Meena: '♓',
};

type DayRating = 'great' | 'good' | 'mixed' | 'tense';

const FOCUS_AREA_LIST: readonly NotificationFocusArea[] = [
  'career', 'education', 'money', 'relationship', 'travel', 'business', 'health', 'spiritual',
];
const TONE_LIST: readonly NotificationTone[] = [
  'simple', 'spiritual', 'practical', 'detailed', 'positive', 'balanced',
];

export function buildNotificationCandidates(
  input: BuildNotificationCandidatesInput,
): NotificationCandidates {
  const context = normalizeContext(input.dominantContext);
  const rating = ratingFromScore(input.confidenceScore);
  const tones = normalizeTones(input.tones);
  const focusAreas = normalizeFocusAreas(input.focusAreas);
  const focusTopic = focusAreas[0];
  const topic: NotificationTopic = focusTopic ?? topicFromContext(context);
  const scoreByStart = new Map(
    (input.blockScores ?? []).map((s) => [s.start, clamp01(s.score)]),
  );

  const peakStart = input.goodTimes[0]?.start;
  const strongStart = input.goodTimes[1]?.start;
  const cautionStart = input.badTimes[0]?.start;
  const weakStart = input.badTimes[1]?.start;

  const toneCtx: ToneContext = {
    tones,
    astroNoteEn: astroNoteEn(input, context),
    astroNoteSi: astroNoteSi(input),
  };

  const blocks = input.blocks.map((block) =>
    buildBlockCandidate({
      block,
      kind:
        block.start === peakStart ? 'peak'
        : block.start === strongStart ? 'strong'
        : block.start === cautionStart ? 'caution'
        : block.start === weakStart ? 'weak'
        : 'neutral',
      score: Math.round((scoreByStart.get(block.start) ?? 0.5) * 100),
      transits: input.transits,
      context,
      topic,
      focusAreas,
      rating,
      lagna: input.lagna,
      dashaLord: input.dashaLord,
      confidenceScore: input.confidenceScore,
      date: input.date,
      toneCtx,
    }),
  );

  const peakCandidate = blocks.find((b) => b.type === 'peak');
  const bestWindow = peakCandidate
    ? buildBestWindow(peakCandidate, input.goodTimes[0], input.date, topic, focusAreas, toneCtx)
    : undefined;

  const powerHours = (input.favorableHoras ?? [])
    .filter((h) => h.lord.trim() && isIsoInstant(h.startUtc) && isIsoInstant(h.endUtc))
    .map((h) => buildPowerHour(h, input.lagna, input.date, toneCtx));

  const guidance = buildGuidanceCandidates({
    date: input.date,
    summary: (input.summary ?? '').trim(),
    rating,
    topic,
    toneCtx,
  });

  const rahu = input.rahuKalamLocal;
  const rahuValid = rahu && isHm(rahu.start) && isHm(rahu.end);

  return {
    version: 1,
    date: input.date,
    timezone: input.timezone,
    blocks,
    ...(bestWindow ? { bestWindow } : {}),
    powerHours,
    guidance,
    ...(rahuValid ? { rahuKalam: { start: rahu.start, end: rahu.end } } : {}),
    tonesApplied: tones,
    ...(focusTopic ? { focusTopic } : {}),
  };
}

// ── Block candidates ─────────────────────────────────────────────────────────

/** Topic used for copy emphasis: a focus area, or 'overall'. */
type NotificationTopic = NotificationFocusArea | 'overall';

function buildBlockCandidate(p: {
  block: TimeBlock;
  kind: 'peak' | 'strong' | 'caution' | 'weak' | 'neutral';
  score: number;
  transits: DayTransitDto[];
  context: NotificationContext;
  topic: NotificationTopic;
  focusAreas: NotificationFocusArea[];
  rating: DayRating;
  lagna: string;
  dashaLord?: string;
  confidenceScore: number;
  date: string;
  toneCtx: ToneContext;
}): BlockNotificationCandidate {
  const labelSi = BLOCK_LABEL_SI[p.block.label] ?? p.block.label;
  const focusMatched = p.topic !== 'overall' && p.focusAreas.includes(p.topic);

  let type: NotificationBlockType;
  let priority: number;
  let category: NotificationCandidateCategory;
  let importance: NotificationImportance;
  let title: string;
  let titleSi: string;
  let body: string;
  let bodySi: string;
  let reasonCode: string;
  let transitLabel: string | undefined;

  if (p.kind === 'peak') {
    type = 'peak';
    priority = 1;
    category = categoryForTopic(p.topic);
    importance = focusMatched ? 'critical' : 'high';
    const transit =
      bestTransitOfType(p.transits, 'opportunity') ?? bestTransitOfType(p.transits, 'neutral');
    title = `${LAGNA_EMOJI[p.lagna] ?? '✦'} ${p.block.label} — ✨ Peak hora`;
    titleSi = `✨ ${labelSi}`;
    if (transit) {
      body = trimTransit(transit.description, TRANSIT_BODY_MAX);
      bodySi = trimPlain(transit.descriptionSi ?? transit.description, TRANSIT_BODY_MAX);
      reasonCode = `transit:${transit.id}`;
      transitLabel = transit.title;
    } else {
      body = peakBodyEn(p.topic, p.dashaLord);
      bodySi = peakBodySi(p.topic);
      reasonCode = `topic:${p.topic}`;
    }
  } else if (p.kind === 'strong') {
    type = 'strong';
    priority = 2;
    category = categoryForTopic(p.topic);
    importance = 'medium';
    const transit = bestTransitOfType(p.transits, 'opportunity');
    title = `✦ ${p.block.label} — Strong window`;
    titleSi = `✦ ${labelSi}`;
    if (transit) {
      body = trimTransit(transit.description, TRANSIT_BODY_MAX);
      bodySi = trimPlain(transit.descriptionSi ?? transit.description, TRANSIT_BODY_MAX);
      reasonCode = `transit:${transit.id}`;
      transitLabel = transit.title;
    } else {
      body = `Good ${topicWordEn(p.topic)} energy. Keep steady momentum.`;
      bodySi = 'හොඳ ශක්තියක්. ස්ථාවර ප්‍රවේගය රඳවා ගන්න.';
      reasonCode = `topic:${p.topic}`;
    }
  } else if (p.kind === 'caution') {
    type = 'caution';
    priority = 3;
    category = 'avoid_time';
    importance = 'high';
    const transit = bestTransitOfType(p.transits, 'challenge');
    title = `⚠️ ${p.block.label} — Low-energy hora`;
    titleSi = `⚠️ ${labelSi}`;
    if (transit) {
      body = trimTransit(transit.description, TRANSIT_BODY_MAX);
      bodySi = trimPlain(transit.descriptionSi ?? transit.description, TRANSIT_BODY_MAX);
      reasonCode = `transit:${transit.id}`;
      transitLabel = transit.title;
    } else {
      body = cautionBodyEn(p.topic);
      bodySi = cautionBodySi(p.topic);
      reasonCode = `topic:${p.topic}`;
    }
  } else if (p.kind === 'weak') {
    type = 'caution';
    priority = 4;
    category = 'avoid_time';
    importance = 'low';
    title = `· ${p.block.label} — Go gently`;
    titleSi = `· ${labelSi}`;
    body = p.rating === 'tense' ? 'Conserve energy.' : 'Lighter tasks serve you better now.';
    bodySi = p.rating === 'tense' ? 'ශක්තිය රැකගන්න.' : 'දැන් සැහැල්ලු කාර්යවලට යොමු වන්න.';
    reasonCode = 'secondary-caution';
  } else {
    type = 'neutral';
    priority = 5;
    category = 'daily_guidance';
    importance = 'low';
    title = `· ${p.block.label}`;
    titleSi = `· ${labelSi}`;
    body = neutralBodyEn(p.block.start, p.rating, p.context);
    bodySi = neutralBodySi(p.block.start);
    reasonCode = `neutral:${p.rating}`;
  }

  const toned = applyTones(body, bodySi, p.toneCtx, { isCaution: category === 'avoid_time' });
  return {
    id: `block-${p.block.start.replace(':', '')}`,
    type,
    startTime: p.block.start,
    endTime: p.block.end,
    score: p.score,
    priority,
    category,
    importance,
    title,
    titleSi,
    body: toned.en,
    bodySi: toned.si,
    deepLink: `subatime://feed?planDate=${p.date}&block=${encodeURIComponent(p.block.start)}`,
    reasonCode,
    astroSource: {
      context: p.context,
      ...(p.dashaLord ? { dashaLord: p.dashaLord } : {}),
      ...(transitLabel ? { transitLabel } : {}),
      confidenceScore: p.confidenceScore,
    },
  };
}

// ── Best window ──────────────────────────────────────────────────────────────

function buildBestWindow(
  peak: BlockNotificationCandidate,
  peakBlock: TimeBlock | undefined,
  date: string,
  topic: NotificationTopic,
  focusAreas: NotificationFocusArea[],
  toneCtx: ToneContext,
): BestWindowNotificationCandidate {
  const label = (peakBlock?.label ?? 'Strong window').trim() || 'Strong window';
  const labelSi = BLOCK_LABEL_SI[label] ?? label;
  const focusMatched = topic !== 'overall' && focusAreas.includes(topic);
  const toned = applyTones(
    `${label} opens soon — ${bestWindowUseEn(topic)}`,
    `${labelSi} ළඟදීම ඇරඹේ — ${bestWindowUseSi(topic)}`,
    toneCtx,
    { isCaution: false },
  );
  return {
    id: 'best-window',
    blockId: peak.id,
    sendAt: hmMinusMinutes(peak.startTime, BEST_WINDOW_LEAD_MIN),
    category: 'best_time',
    importance: focusMatched ? 'critical' : 'high',
    title: '✨ Your strongest window soon',
    titleSi: '✨ ඔබේ ප්‍රබලම කාලය ළඟයි',
    body: toned.en,
    bodySi: toned.si,
    deepLink: `subatime://guide?planDate=${date}`,
  };
}

// ── Power hours ──────────────────────────────────────────────────────────────

function buildPowerHour(
  hora: FavorableHoraInput,
  lagna: string,
  date: string,
  toneCtx: ToneContext,
): PowerHourNotificationCandidate {
  const lord = hora.lord.trim();
  const toned = applyTones(
    `A favorable ${lord} Horā for your ${lagna} chart starts in ${POWER_HOUR_LEAD_MIN} minutes.`,
    `ඔබේ ${lagna} කේන්දරයට හිතකර ${lord} හෝරාව විනාඩි ${POWER_HOUR_LEAD_MIN}කින් ඇරඹේ.`,
    toneCtx,
    { isCaution: false, skipDetailed: true },
  );
  return {
    id: `hora-${lord}-${hora.startUtc}`,
    sendAt: new Date(Date.parse(hora.startUtc) - POWER_HOUR_LEAD_MIN * 60_000).toISOString(),
    startTime: hora.startUtc,
    endTime: hora.endUtc,
    category: 'best_time',
    importance: 'medium',
    title: '🌟 Your power hour soon',
    titleSi: '🌟 ඔබේ බල පැය ළඟයි',
    body: toned.en,
    bodySi: toned.si,
    horaLord: lord,
    deepLink: `subatime://guide?planDate=${date}&slot=hora`,
  };
}

// ── Daily guidance ───────────────────────────────────────────────────────────

function buildGuidanceCandidates(p: {
  date: string;
  summary: string;
  rating: DayRating;
  topic: NotificationTopic;
  toneCtx: ToneContext;
}): GuidanceNotificationCandidate[] {
  const morningBase = p.summary.length
    ? trimPlain(p.summary, 130)
    : morningBodyEn(p.rating, p.topic);
  const morning = applyTones(morningBase, morningBodySi(p.rating), p.toneCtx, { isCaution: false });
  const evening = applyTones(
    eveningBodyEn(p.rating, p.topic),
    eveningBodySi(p.rating),
    p.toneCtx,
    { isCaution: false, skipDetailed: true },
  );
  return [
    {
      id: 'daily-morning',
      slot: 'morning',
      category: 'daily_guidance',
      importance: 'high',
      title: '🌅 Today’s guidance',
      titleSi: '🌅 අදේ මඟපෙන්වීම',
      body: morning.en,
      bodySi: morning.si,
      deepLink: `subatime://guide?planDate=${p.date}`,
      reasonCode: p.summary.length ? 'summary' : `rating:${p.rating}`,
    },
    {
      id: 'daily-evening',
      slot: 'evening',
      category: 'daily_guidance',
      importance: 'medium',
      title: '🌙 Evening check-in',
      titleSi: '🌙 සවස් විමසුම',
      body: evening.en,
      bodySi: evening.si,
      deepLink: `subatime://guide?planDate=${p.date}`,
      reasonCode: `evening:${p.rating}`,
    },
  ];
}

function morningBodyEn(rating: DayRating, topic: NotificationTopic): string {
  const focus = topic === 'overall' ? 'one important task' : `one ${topicWordEn(topic)} task`;
  switch (rating) {
    case 'great': return `Today's energy is strong. Put ${focus} first while momentum is with you.`;
    case 'good': return `Today supports steady progress. Focus on ${focus} before noon.`;
    case 'mixed': return `A mixed day — plan calmly and keep ${focus} simple.`;
    default: return `Today may feel heavier. Keep the load light and be gentle with yourself.`;
  }
}

function morningBodySi(rating: DayRating): string {
  switch (rating) {
    case 'great': return 'අදේ ශක්තිය ප්‍රබලයි. වැදගත්ම කාර්යය මුලින්ම කරන්න.';
    case 'good': return 'අද ස්ථාවර ප්‍රගතියට සහාය දක්වයි. දහවල් වන විට වැදගත් දේ කරන්න.';
    case 'mixed': return 'මිශ්‍ර දිනයක් — සන්සුන්ව සැලසුම් කර සරලව තබන්න.';
    default: return 'අද බරපතල හැඟීමක් දිය හැක. සැහැල්ලුවෙන්, ඉවසීමෙන් ගමන් කරන්න.';
  }
}

function eveningBodyEn(rating: DayRating, topic: NotificationTopic): string {
  if (topic === 'relationship') return 'Evening is better for calm conversations. Avoid replying when emotional.';
  if (rating === 'tense') return 'Wind down gently tonight. Rest restores tomorrow\'s clarity.';
  return 'Evening suits reflection and lighter plans. Note one thing that went well today.';
}

function eveningBodySi(rating: DayRating): string {
  if (rating === 'tense') return 'අද රාත්‍රියේ සන්සුන්ව විවේක ගන්න. විවේකය හෙට පැහැදිලිභාවය ගෙනෙයි.';
  return 'සවස ආවර්ජනයට හොඳයි. අද හොඳින් ගිය එක දෙයක් සටහන් කරන්න.';
}

// ── Tone pipeline ────────────────────────────────────────────────────────────

interface ToneContext {
  tones: NotificationTone[];
  astroNoteEn: string;
  astroNoteSi: string;
}

/**
 * Applies up to two tone styles to base copy. Deterministic transforms only:
 * - positive: soften caution wording (never scary, never fixed-fate)
 * - simple: keep only the first sentence
 * - spiritual: add a gentle grounding line
 * - detailed: append the astrological reason (lagna/transit/dasha)
 * practical/balanced keep the base voice (our default copy is already both).
 */
function applyTones(
  en: string,
  si: string,
  ctx: ToneContext,
  opts: { isCaution: boolean; skipDetailed?: boolean },
): { en: string; si: string } {
  let outEn = en.trim();
  let outSi = si.trim();
  const has = (t: NotificationTone) => ctx.tones.includes(t);

  if (has('positive')) {
    outEn = softenEn(outEn);
    // Sinhala copy is already gentle; keep as-is to avoid awkward machine rewrites.
  }
  if (has('simple')) {
    outEn = firstSentence(outEn);
    outSi = firstSentence(outSi);
  }
  if (has('spiritual')) {
    outEn = `${outEn} Breathe, and trust your timing.`;
    outSi = `${outSi} සන්සුන්ව, ඔබේ වේලාව විශ්වාස කරන්න.`;
  }
  if (has('detailed') && !opts.skipDetailed && ctx.astroNoteEn) {
    outEn = `${outEn} (${ctx.astroNoteEn})`;
    if (ctx.astroNoteSi) outSi = `${outSi} (${ctx.astroNoteSi})`;
  }
  return { en: outEn, si: outSi };
}

/** Gentle rewrites for the positive tone — cautions become invitations, never warnings. */
function softenEn(s: string): string {
  return s
    .replace(/\bAvoid starting\b/g, 'Hold off on starting')
    .replace(/\bAvoid\b/g, 'Go easy on')
    .replace(/\bavoid\b/g, 'go easy on')
    .replace(/\bLow-energy\b/gi, 'Gentler-energy')
    .replace(/\bruns heavier\b/gi, 'asks for patience')
    .replace(/\bConserve energy\.\s*/g, 'Save your energy for what matters. ')
    .replace(/\brisky\b/gi, 'big');
}

function firstSentence(s: string): string {
  const m = /^[^.!?…]*[.!?…]/.exec(s.trim());
  return (m ? m[0] : s).trim();
}

function astroNoteEn(input: BuildNotificationCandidatesInput, context: NotificationContext): string {
  const bits: string[] = [];
  if (input.lagna.trim()) bits.push(`${input.lagna} lagna`);
  const transit = input.transits.find((t) => t.isComputed) ?? input.transits[0];
  if (transit) bits.push(transit.title);
  if (input.dashaLord) bits.push(`${input.dashaLord} dasha`);
  void context;
  return bits.slice(0, 3).join(' · ');
}

function astroNoteSi(input: BuildNotificationCandidatesInput): string {
  const bits: string[] = [];
  if (input.lagna.trim()) bits.push(`${input.lagna} ලග්නය`);
  const transit = input.transits.find((t) => t.isComputed) ?? input.transits[0];
  if (transit) bits.push(transit.titleSi ?? transit.title);
  return bits.slice(0, 2).join(' · ');
}

// ── Topic copy (focus-area emphasis; en + si) ────────────────────────────────

function categoryForTopic(topic: NotificationTopic): NotificationCandidateCategory {
  return topic === 'overall' ? 'daily_guidance' : topic;
}

function topicFromContext(context: NotificationContext): NotificationTopic {
  switch (context) {
    case 'career': return 'career';
    case 'love': return 'relationship';
    case 'health': return 'health';
    default: return 'overall';
  }
}

function topicWordEn(topic: NotificationTopic): string {
  switch (topic) {
    case 'career': return 'career';
    case 'education': return 'study';
    case 'money': return 'financial';
    case 'relationship': return 'relationship';
    case 'travel': return 'travel';
    case 'business': return 'business';
    case 'health': return 'health';
    case 'spiritual': return 'inner';
    default: return 'overall';
  }
}

function peakBodyEn(topic: NotificationTopic, dashaLord?: string): string {
  const dashaBoost = dashaLord && ['Sun', 'Moon', 'Jupiter'].includes(dashaLord)
    ? ` ${dashaLord} dasha amplifies.`
    : '';
  const lines: Record<NotificationTopic, string> = {
    career: `Best window for decisive work.${dashaBoost} Act on what matters most.`,
    education: `Sharp-focus window.${dashaBoost} Ideal for study, applications, or exams prep.`,
    money: `Clear-headed window for money matters.${dashaBoost} Review plans and decisions calmly.`,
    relationship: `Heart energy is clearest now.${dashaBoost} Express what matters.`,
    travel: `Good window for travel plans and bookings.${dashaBoost} Move on pending arrangements.`,
    business: `Strong window for deals and outreach.${dashaBoost} Follow up on key contacts.`,
    health: 'Physical energy peaks here. Move your body now.',
    spiritual: 'A clear, quiet window. Ideal for practice, prayer, or reflection.',
    overall: 'Peak hora — best window of the day. Move forward.',
  };
  return lines[topic];
}

function peakBodySi(topic: NotificationTopic): string {
  const lines: Record<NotificationTopic, string> = {
    career: 'තීරණාත්මක වැඩට හොඳම කාලය. වැදගත්ම දේ දැන් කරන්න.',
    education: 'තියුණු අවධානයේ කාලය. පාඩම්, අයදුම්පත් සඳහා ඉතා හොඳයි.',
    money: 'මුදල් කටයුතුවලට පැහැදිලි කාලයක්. සන්සුන්ව සමාලෝචනය කරන්න.',
    relationship: 'හදවතේ ශක්තිය දැන් පැහැදිලියි. වැදගත් දේ ප්‍රකාශ කරන්න.',
    travel: 'ගමන් සැලසුම්වලට හොඳ කාලයක්. අත්හිටුවූ කටයුතු ඉදිරියට ගන්න.',
    business: 'ගනුදෙනු හා සම්බන්ධතාවලට ප්‍රබල කාලයක්. පසු විපරම් කරන්න.',
    health: 'ශාරීරික ශක්තිය උපරිමයි. දැන් සක්‍රීය වන්න.',
    spiritual: 'නිසංසල පැහැදිලි කාලයක්. භාවනාවට හෝ ආවර්ජනයට ඉතා හොඳයි.',
    overall: 'දවසේ හොඳම කාලය. ඉදිරියට යන්න.',
  };
  return lines[topic];
}

function cautionBodyEn(topic: NotificationTopic): string {
  const lines: Record<NotificationTopic, string> = {
    career: 'Keep major work decisions light during this period.',
    education: 'A softer stretch for study — review rather than start new topics.',
    money: 'Keep spending and money decisions light during this period.',
    relationship: 'Emotional sensitivity is high. Pause before reacting.',
    travel: 'Keep travel plans flexible for now; confirm details later.',
    business: 'Hold new commitments for now; routine follow-ups are fine.',
    health: 'Low physical energy. Rest is the right choice.',
    spiritual: 'A restless stretch — short, simple practice serves best.',
    overall: 'Low-energy hora. Conserve and observe.',
  };
  return lines[topic];
}

function cautionBodySi(topic: NotificationTopic): string {
  const lines: Record<NotificationTopic, string> = {
    career: 'මෙම කාලයේ විශාල රැකියා තීරණ සැහැල්ලුවෙන් තබන්න.',
    education: 'නව මාතෘකා ආරම්භයට වඩා සමාලෝචනයට හොඳ කාලයක්.',
    money: 'මෙම කාලයේ වියදම් හා මුදල් තීරණ සැහැල්ලුවෙන් තබන්න.',
    relationship: 'හැඟීම් සංවේදීයි. ප්‍රතිචාරයට පෙර මොහොතක් නවතින්න.',
    travel: 'ගමන් සැලසුම් නම්‍යශීලීව තබන්න; විස්තර පසුව තහවුරු කරන්න.',
    business: 'නව බැඳීම් දැනට නවත්වන්න; සාමාන්‍ය පසු විපරම් කළ හැක.',
    health: 'ශාරීරික ශක්තිය අඩුයි. විවේකය නිවැරදි තේරීමයි.',
    spiritual: 'නොසන්සුන් කාලයක් — කෙටි සරල පුහුණුවක් හොඳම යි.',
    overall: 'අඩු ශක්ති කාලයක්. විවේක ගෙන නිරීක්ෂණය කරන්න.',
  };
  return lines[topic];
}

function bestWindowUseEn(topic: NotificationTopic): string {
  switch (topic) {
    case 'career': return 'good for applications, meetings, or focused work.';
    case 'education': return 'good for study sessions or submitting applications.';
    case 'money': return 'good for financial planning or reviews.';
    case 'relationship': return 'good for meaningful conversations.';
    case 'travel': return 'good for bookings and travel arrangements.';
    case 'business': return 'good for pitches, deals, or follow-ups.';
    case 'health': return 'good for training or an energising routine.';
    case 'spiritual': return 'good for practice, prayer, or quiet focus.';
    default: return 'use it for what matters most today.';
  }
}

function bestWindowUseSi(topic: NotificationTopic): string {
  switch (topic) {
    case 'career': return 'අයදුම්පත්, රැස්වීම්, අවධාන වැඩට හොඳයි.';
    case 'relationship': return 'අර්ථවත් සංවාදවලට හොඳයි.';
    case 'money': return 'මූල්‍ය සැලසුම්වලට හොඳයි.';
    default: return 'අදේ වැදගත්ම දේට යොදාගන්න.';
  }
}

// ── Copy helpers (ported from backend push service; single home now) ─────────

function bestTransitOfType(transits: DayTransitDto[], type: string): DayTransitDto | null {
  const candidates = transits
    .filter((t) => t.type === type)
    .sort((a, b) => b.intensity - a.intensity || a.id.localeCompare(b.id));
  return candidates[0] ?? null;
}

function trimTransit(desc: string, max: number): string {
  let s = desc.trim();
  s = s.replace(/^(Emotional tone|Desire and|Words land|This aspect|The)/i, '').trimStart();
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return s.length > max ? `${s.slice(0, max - 1).trim()}…` : s;
}

function trimPlain(desc: string, max: number): string {
  const s = desc.trim();
  return s.length > max ? `${s.slice(0, max - 1).trim()}…` : s;
}

function neutralBodyEn(start: string, rating: DayRating, context: NotificationContext): string {
  const hour = parseInt(start, 10);
  if (hour < 8) return rating === 'tense' ? 'Ease into the day gently.' : 'Set a clear intention before starting.';
  if (hour < 12) return context === 'career' ? 'Focused work flows well now.' : 'Keep the morning energy steady.';
  if (hour < 14) return rating === 'tense' ? 'Midday is heavy. Rest if possible.' : 'Check progress and adjust.';
  if (hour < 18) return context === 'love' ? 'Afternoon is good for connection.' : 'Creative momentum builds now.';
  if (hour < 20) return rating === 'great' ? 'Evening energy is strong. Use it.' : 'Wind down tasks and reflect.';
  return rating === 'tense' ? 'Rest fully. Tomorrow the engine recalculates.' : 'Night hora. Restore and prepare.';
}

function neutralBodySi(start: string): string {
  switch (start) {
    case '06:00': return 'දවස සන්සුන්ව ආරම්භ කරන්න.';
    case '08:00': return 'වැදගත්ම කාර්යය දැන් කරන්න.';
    case '10:00': return 'ප්‍රවේගය රඳවා ගන්න.';
    case '12:00': return 'දිවා විමසුම — සැලසුමට අනුවද?';
    case '14:00': return 'නිර්මාණශීලී ශක්තිය වැඩේ.';
    case '16:00': return 'විවෘත කාර්ය නිම කරන්න.';
    case '18:00': return 'සම්බන්ධතාවලට හොඳ කාලයක්.';
    case '20:00': return 'සන්සුන් වී විවේක ගන්න.';
    default: return 'මේ මොහොතේ සිහියෙන් සිටින්න.';
  }
}

// ── Utility ──────────────────────────────────────────────────────────────────

function ratingFromScore(score: number): DayRating {
  if (score >= 0.8) return 'great';
  if (score >= 0.65) return 'good';
  if (score >= 0.5) return 'mixed';
  return 'tense';
}

function normalizeContext(raw: string): NotificationContext {
  return raw === 'career' || raw === 'love' || raw === 'health' ? raw : 'overall';
}

function normalizeTones(raw?: string[]): NotificationTone[] {
  const out: NotificationTone[] = [];
  for (const item of raw ?? []) {
    const v = item.trim().toLowerCase() as NotificationTone;
    if (TONE_LIST.includes(v) && !out.includes(v)) out.push(v);
    if (out.length === 2) break;
  }
  return out.length ? out : ['practical', 'balanced'];
}

function normalizeFocusAreas(raw?: string[]): NotificationFocusArea[] {
  const out: NotificationFocusArea[] = [];
  for (const item of raw ?? []) {
    const v = item.trim().toLowerCase() as NotificationFocusArea;
    if (FOCUS_AREA_LIST.includes(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function hmMinusMinutes(hm: string, minutes: number): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return hm;
  const total = Math.max(0, parseInt(m[1], 10) * 60 + parseInt(m[2], 10) - minutes);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function isHm(s: unknown): boolean {
  return typeof s === 'string' && /^([01]?\d|2[0-3]):[0-5]\d$/.test(s.trim());
}

function isIsoInstant(s: string): boolean {
  return Number.isFinite(Date.parse(s));
}
