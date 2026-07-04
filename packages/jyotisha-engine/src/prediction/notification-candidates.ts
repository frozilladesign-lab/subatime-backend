import type { DayTransitDto } from '../scoring/day-transits';
import type { TimeBlock } from '../scoring/scoring-engine';

/**
 * Notification candidates — the single source of notification wording.
 *
 * The prediction engine decides meaning; this builder decides the message; delivery
 * services (backend FCM schedulers, Flutter local notifications) only select and send.
 * Nothing here may talk to Firebase, the database, or any delivery mechanism.
 *
 * `buildNotificationCandidates` is deterministic: the same input always produces the
 * same candidates (no Date.now(), no randomness). All copy is emitted in both English
 * and Sinhala so no consumer ever needs its own fallback wording.
 */

export type NotificationBlockType = 'peak' | 'strong' | 'caution' | 'neutral';
export type NotificationContext = 'career' | 'love' | 'health' | 'overall';

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
  title: string;
  titleSi: string;
  body: string;
  bodySi: string;
  deepLink: string;
  /** Machine-readable origin of the copy, e.g. `transit:moon_trine_jupiter` or `context:career`. */
  reasonCode: string;
  astroSource: NotificationCandidateAstroSource;
}

export interface BestWindowNotificationCandidate {
  blockId: string;
  /** Local wall-clock 'HH:mm' — 8 minutes before the peak block starts. */
  sendAt: string;
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
  title: string;
  titleSi: string;
  body: string;
  bodySi: string;
  horaLord: string;
  deepLink: string;
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

export function buildNotificationCandidates(
  input: BuildNotificationCandidatesInput,
): NotificationCandidates {
  const context = normalizeContext(input.dominantContext);
  const rating = ratingFromScore(input.confidenceScore);
  const scoreByStart = new Map(
    (input.blockScores ?? []).map((s) => [s.start, clamp01(s.score)]),
  );

  const peakStart = input.goodTimes[0]?.start;
  const strongStart = input.goodTimes[1]?.start;
  const cautionStart = input.badTimes[0]?.start;
  const weakStart = input.badTimes[1]?.start;

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
      rating,
      lagna: input.lagna,
      dashaLord: input.dashaLord,
      confidenceScore: input.confidenceScore,
      date: input.date,
    }),
  );

  const peakCandidate = blocks.find((b) => b.type === 'peak');
  const bestWindow = peakCandidate
    ? buildBestWindow(peakCandidate, input.goodTimes[0], input.date)
    : undefined;

  const powerHours = (input.favorableHoras ?? [])
    .filter((h) => h.lord.trim() && isIsoInstant(h.startUtc) && isIsoInstant(h.endUtc))
    .map((h) => buildPowerHour(h, input.lagna, input.date));

  return {
    version: 1,
    date: input.date,
    timezone: input.timezone,
    blocks,
    ...(bestWindow ? { bestWindow } : {}),
    powerHours,
  };
}

// ── Block candidates ─────────────────────────────────────────────────────────

function buildBlockCandidate(p: {
  block: TimeBlock;
  kind: 'peak' | 'strong' | 'caution' | 'weak' | 'neutral';
  score: number;
  transits: DayTransitDto[];
  context: NotificationContext;
  rating: DayRating;
  lagna: string;
  dashaLord?: string;
  confidenceScore: number;
  date: string;
}): BlockNotificationCandidate {
  const labelSi = BLOCK_LABEL_SI[p.block.label] ?? p.block.label;

  let type: NotificationBlockType;
  let priority: number;
  let title: string;
  let titleSi: string;
  let body: string;
  let bodySi: string;
  let reasonCode: string;
  let transitLabel: string | undefined;

  if (p.kind === 'peak') {
    type = 'peak';
    priority = 1;
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
      body = peakBodyEn(p.context, p.dashaLord);
      bodySi = peakBodySi(p.context);
      reasonCode = `context:${p.context}`;
    }
  } else if (p.kind === 'strong') {
    type = 'strong';
    priority = 2;
    const transit = bestTransitOfType(p.transits, 'opportunity');
    title = `✦ ${p.block.label} — Strong window`;
    titleSi = `✦ ${labelSi}`;
    if (transit) {
      body = trimTransit(transit.description, TRANSIT_BODY_MAX);
      bodySi = trimPlain(transit.descriptionSi ?? transit.description, TRANSIT_BODY_MAX);
      reasonCode = `transit:${transit.id}`;
      transitLabel = transit.title;
    } else {
      body = `Good ${p.context} energy. Keep steady momentum.`;
      bodySi = 'හොඳ ශක්තියක්. ස්ථාවර ප්‍රවේගය රඳවා ගන්න.';
      reasonCode = `context:${p.context}`;
    }
  } else if (p.kind === 'caution') {
    type = 'caution';
    priority = 3;
    const transit = bestTransitOfType(p.transits, 'challenge');
    title = `⚠️ ${p.block.label} — Low-energy hora`;
    titleSi = `⚠️ ${labelSi}`;
    if (transit) {
      body = trimTransit(transit.description, TRANSIT_BODY_MAX);
      bodySi = trimPlain(transit.descriptionSi ?? transit.description, TRANSIT_BODY_MAX);
      reasonCode = `transit:${transit.id}`;
      transitLabel = transit.title;
    } else {
      body = cautionBodyEn(p.context);
      bodySi = cautionBodySi(p.context);
      reasonCode = `context:${p.context}`;
    }
  } else if (p.kind === 'weak') {
    type = 'caution';
    priority = 4;
    title = `· ${p.block.label} — Go gently`;
    titleSi = `· ${labelSi}`;
    body = p.rating === 'tense' ? 'Conserve energy.' : 'Lighter tasks serve you better now.';
    bodySi = p.rating === 'tense' ? 'ශක්තිය රැකගන්න.' : 'දැන් සැහැල්ලු කාර්යවලට යොමු වන්න.';
    reasonCode = 'secondary-caution';
  } else {
    type = 'neutral';
    priority = 5;
    title = `· ${p.block.label}`;
    titleSi = `· ${labelSi}`;
    body = neutralBodyEn(p.block.start, p.rating, p.context);
    bodySi = neutralBodySi(p.block.start);
    reasonCode = `neutral:${p.rating}`;
  }

  return {
    id: `block-${p.block.start.replace(':', '')}`,
    type,
    startTime: p.block.start,
    endTime: p.block.end,
    score: p.score,
    priority,
    title,
    titleSi,
    body,
    bodySi,
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
): BestWindowNotificationCandidate {
  const label = (peakBlock?.label ?? 'Strong window').trim() || 'Strong window';
  const labelSi = BLOCK_LABEL_SI[label] ?? label;
  return {
    blockId: peak.id,
    sendAt: hmMinusMinutes(peak.startTime, BEST_WINDOW_LEAD_MIN),
    title: '✨ Your strongest window soon',
    titleSi: '✨ ඔබේ ප්‍රබලම කාලය ළඟයි',
    body: `${label} opens soon — tap for today’s line and timing.`,
    bodySi: `${labelSi} ළඟදීම ඇරඹේ — අදේ මඟපෙන්වීම බලන්න.`,
    deepLink: `subatime://guide?planDate=${date}`,
  };
}

// ── Power hours ──────────────────────────────────────────────────────────────

function buildPowerHour(
  hora: FavorableHoraInput,
  lagna: string,
  date: string,
): PowerHourNotificationCandidate {
  const lord = hora.lord.trim();
  return {
    id: `hora-${lord}-${hora.startUtc}`,
    sendAt: new Date(Date.parse(hora.startUtc) - POWER_HOUR_LEAD_MIN * 60_000).toISOString(),
    startTime: hora.startUtc,
    endTime: hora.endUtc,
    title: '🌟 Your power hour soon',
    titleSi: '🌟 ඔබේ බල පැය ළඟයි',
    body: `A favorable ${lord} Horā for your ${lagna} chart starts in ${POWER_HOUR_LEAD_MIN} minutes.`,
    bodySi: `ඔබේ ${lagna} කේන්දරයට හිතකර ${lord} හෝරාව විනාඩි ${POWER_HOUR_LEAD_MIN}කින් ඇරඹේ.`,
    horaLord: lord,
    deepLink: `subatime://guide?planDate=${date}&slot=hora`,
  };
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

function peakBodyEn(context: NotificationContext, dashaLord?: string): string {
  const dashaBoost = dashaLord && ['Sun', 'Moon', 'Jupiter'].includes(dashaLord)
    ? ` ${dashaLord} dasha amplifies.`
    : '';
  const lines: Record<NotificationContext, string> = {
    career: `Best window for decisive work.${dashaBoost} Act on what matters most.`,
    love: `Heart energy is clearest now.${dashaBoost} Express what matters.`,
    health: 'Physical energy peaks here. Move your body now.',
    overall: 'Peak hora — best window of the day. Move forward.',
  };
  return lines[context];
}

function peakBodySi(context: NotificationContext): string {
  const lines: Record<NotificationContext, string> = {
    career: 'තීරණාත්මක වැඩට හොඳම කාලය. වැදගත්ම දේ දැන් කරන්න.',
    love: 'හදවතේ ශක්තිය දැන් පැහැදිලියි. වැදගත් දේ ප්‍රකාශ කරන්න.',
    health: 'ශාරීරික ශක්තිය උපරිමයි. දැන් සක්‍රීය වන්න.',
    overall: 'දවසේ හොඳම කාලය. ඉදිරියට යන්න.',
  };
  return lines[context];
}

function cautionBodyEn(context: NotificationContext): string {
  const lines: Record<NotificationContext, string> = {
    career: 'Avoid risky decisions or new commitments now.',
    love: 'Emotional sensitivity is high. Pause before reacting.',
    health: 'Low physical energy. Rest is the right choice.',
    overall: 'Low-energy hora. Conserve and observe.',
  };
  return lines[context];
}

function cautionBodySi(context: NotificationContext): string {
  const lines: Record<NotificationContext, string> = {
    career: 'අවදානම් තීරණ හා නව බැඳීම් දැන් නොගන්න.',
    love: 'හැඟීම් සංවේදීයි. ප්‍රතිචාරයට පෙර මොහොතක් නවතින්න.',
    health: 'ශාරීරික ශක්තිය අඩුයි. විවේකය නිවැරදි තේරීමයි.',
    overall: 'අඩු ශක්ති කාලයක්. විවේක ගෙන නිරීක්ෂණය කරන්න.',
  };
  return lines[context];
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

function isIsoInstant(s: string): boolean {
  return Number.isFinite(Date.parse(s));
}
