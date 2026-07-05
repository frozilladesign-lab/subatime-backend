import type { LifeTheme } from './chart-context';

/**
 * Weekly & monthly digest engine — chart-personalized, deterministic rollups.
 *
 * Digests aggregate per-day chart-derived themes (which already follow the Lagna-first /
 * Moon / Dasha / Panchanga hierarchy) into a period summary: the leading theme, the best
 * and caution days/periods, a focus highlight, and one practical action. Two users with
 * different Lagna/Moon/Dasha get different weekly/monthly themes, dates, and reasons — a
 * generic digest is never produced.
 *
 * Pure & deterministic: same per-day inputs ⇒ same digest. No Date.now(), no randomness,
 * no Firebase/DB. All copy in English + Sinhala.
 */

const ALL_THEMES: readonly LifeTheme[] = [
  'career', 'money', 'relationship', 'health', 'education', 'travel', 'business', 'spiritual', 'overall',
];

/** One day's chart-derived signal feeding a digest. */
export interface DigestDayInput {
  /** yyyy-MM-dd. */
  date: string;
  dominantTheme: LifeTheme;
  /** Normalized 0–1 score per theme (chart-context output). */
  themeScores: Record<string, number>;
  /** Day confidence 0–1 (higher = stronger, clearer day). */
  confidenceScore: number;
}

export interface WeeklyDigestInput {
  /** yyyy-MM-dd of the week's first day. */
  weekStart: string;
  /** 7 day inputs, in date order. */
  days: DigestDayInput[];
  lagna: string;
  focusAreas?: string[];
  tones?: string[];
}

export interface MonthlyDigestInput {
  /** yyyy-MM (or the 1st as yyyy-MM-dd). */
  monthStart: string;
  /** ~28–31 day inputs, in date order. */
  days: DigestDayInput[];
  lagna: string;
  focusAreas?: string[];
  tones?: string[];
}

export interface DigestDayRef {
  date: string;
  /** Human-readable weekday/date-ish label the caller can localize further if needed. */
  reason: string;
}

export interface WeeklyDigest {
  version: 1;
  weekStart: string;
  weekEnd: string;
  dominantTheme: LifeTheme;
  bestDay: DigestDayRef;
  cautionDay: DigestDayRef;
  focusHighlight?: { theme: LifeTheme; line: string; lineSi: string };
  action: string;
  actionSi: string;
  title: string;
  titleSi: string;
  body: string;
  bodySi: string;
  /** Dev audit: theme totals + reasoning. */
  audit: {
    themeTotals: Record<string, number>;
    chartTheme: LifeTheme;
    focusBoostApplied: boolean;
    reasons: string[];
  };
}

export interface MonthlyDigest {
  version: 1;
  monthStart: string;
  dominantTheme: LifeTheme;
  standoutDates: DigestDayRef[];
  bestPeriod: { start: string; end: string };
  cautionPeriod: { start: string; end: string };
  mostActivatedArea: LifeTheme;
  action: string;
  actionSi: string;
  title: string;
  titleSi: string;
  body: string;
  bodySi: string;
  audit: {
    themeTotals: Record<string, number>;
    chartTheme: LifeTheme;
    focusBoostApplied: boolean;
    reasons: string[];
  };
}

const FOCUS_BOOST = 1.2;

// ── Weekly ───────────────────────────────────────────────────────────────────

export function buildWeeklyDigest(input: WeeklyDigestInput): WeeklyDigest {
  const days = [...input.days].sort((a, b) => a.date.localeCompare(b.date));
  const weekEnd = days.length ? days[days.length - 1].date : input.weekStart;

  const { totals, chartTheme, dominantTheme, focusBoostApplied } = aggregateThemes(
    days, input.focusAreas,
  );

  // Best day = highest confidence; caution day = lowest. Deterministic tie-break by date.
  const byConfDesc = [...days].sort((a, b) => b.confidenceScore - a.confidenceScore || a.date.localeCompare(b.date));
  const best = byConfDesc[0];
  const caution = byConfDesc[byConfDesc.length - 1];

  const focusHighlight = buildFocusHighlight(input.focusAreas, totals);
  const themeWord = THEME_WORD_EN[dominantTheme];
  const themeWordSi = THEME_WORD_SI[dominantTheme];

  const bestDay: DigestDayRef = {
    date: best?.date ?? input.weekStart,
    reason: `Strongest, clearest day of the week — front-load ${themeWord} priorities here.`,
  };
  const cautionDay: DigestDayRef = {
    date: caution?.date ?? weekEnd,
    reason: 'A lighter day — keep it gentle and avoid big new commitments.',
  };

  const action = weeklyActionEn(dominantTheme);
  const actionSi = weeklyActionSi(dominantTheme);

  return {
    version: 1,
    weekStart: input.weekStart,
    weekEnd,
    dominantTheme,
    bestDay,
    cautionDay,
    ...(focusHighlight ? { focusHighlight } : {}),
    action,
    actionSi,
    title: `🗓️ This week: ${cap(themeWord)}`,
    titleSi: `🗓️ මේ සතිය: ${themeWordSi}`,
    body:
      `This week leans toward ${themeWord}. ` +
      `Your strongest day is ${best?.date ?? '—'}; keep ${caution?.date ?? '—'} lighter. ${action}`,
    bodySi:
      `මේ සතිය ${themeWordSi} වෙත නැඹුරුයි. ` +
      `ඔබේ ප්‍රබලම දිනය ${best?.date ?? '—'}; ${caution?.date ?? '—'} සැහැල්ලුව තබන්න. ${actionSi}`,
    audit: {
      themeTotals: totals,
      chartTheme,
      focusBoostApplied,
      reasons: [
        `Week's transits most activate ${themeWord} houses across the 7 days.`,
        `Best day by confidence: ${best?.date ?? '—'}; lightest: ${caution?.date ?? '—'}.`,
      ],
    },
  };
}

// ── Monthly ──────────────────────────────────────────────────────────────────

export function buildMonthlyDigest(input: MonthlyDigestInput): MonthlyDigest {
  const days = [...input.days].sort((a, b) => a.date.localeCompare(b.date));
  const { totals, chartTheme, dominantTheme, focusBoostApplied } = aggregateThemes(
    days, input.focusAreas,
  );

  // Standout dates: top-3 confidence days, in date order.
  const byConf = [...days].sort((a, b) => b.confidenceScore - a.confidenceScore || a.date.localeCompare(b.date));
  const standoutDates: DigestDayRef[] = byConf.slice(0, 3)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({ date: d.date, reason: 'A standout day — strong, clear energy for action.' }));

  // Best / caution period: the strongest and weakest 5-day windows by mean confidence.
  const bestPeriod = extremeWindow(days, 5, 'max');
  const cautionPeriod = extremeWindow(days, 5, 'min');

  const themeWord = THEME_WORD_EN[dominantTheme];
  const themeWordSi = THEME_WORD_SI[dominantTheme];
  const action = monthlyActionEn(dominantTheme);
  const actionSi = monthlyActionSi(dominantTheme);

  return {
    version: 1,
    monthStart: input.monthStart,
    dominantTheme,
    standoutDates,
    bestPeriod,
    cautionPeriod,
    mostActivatedArea: dominantTheme,
    action,
    actionSi,
    title: `🌙 This month: ${cap(themeWord)}`,
    titleSi: `🌙 මේ මාසය: ${themeWordSi}`,
    body:
      `This month highlights ${themeWord}. ` +
      `Best window ${bestPeriod.start}–${bestPeriod.end}; go gentler ${cautionPeriod.start}–${cautionPeriod.end}. ${action}`,
    bodySi:
      `මේ මාසය ${themeWordSi} ඉස්මතු කරයි. ` +
      `හොඳම කාලය ${bestPeriod.start}–${bestPeriod.end}; ${cautionPeriod.start}–${cautionPeriod.end} සැහැල්ලුව. ${actionSi}`,
    audit: {
      themeTotals: totals,
      chartTheme,
      focusBoostApplied,
      reasons: [
        `Month's transits most activate ${themeWord} houses.`,
        `Best 5-day window: ${bestPeriod.start}–${bestPeriod.end}.`,
        `Standout dates: ${standoutDates.map((d) => d.date).join(', ') || '—'}.`,
      ],
    },
  };
}

// ── Shared aggregation ───────────────────────────────────────────────────────

function aggregateThemes(days: DigestDayInput[], focusAreas?: string[]): {
  totals: Record<string, number>;
  chartTheme: LifeTheme;
  dominantTheme: LifeTheme;
  focusBoostApplied: boolean;
} {
  const totals: Record<string, number> = Object.fromEntries(ALL_THEMES.map((t) => [t, 0]));
  for (const d of days) {
    for (const t of ALL_THEMES) {
      const v = Number(d.themeScores?.[t]);
      if (Number.isFinite(v)) totals[t] += v;
    }
  }
  const chartTheme = argmax(totals);

  const focus = normalizeFocus(focusAreas);
  for (const f of focus) totals[f] += totals[f] * (FOCUS_BOOST - 1);
  const dominantTheme = argmax(totals);

  return {
    totals: roundTotals(totals),
    chartTheme,
    dominantTheme,
    focusBoostApplied: focus.length > 0 && dominantTheme !== chartTheme,
  };
}

/** Contiguous window of `size` days with max/min mean confidence. */
function extremeWindow(days: DigestDayInput[], size: number, mode: 'max' | 'min'): { start: string; end: string } {
  if (days.length === 0) return { start: '', end: '' };
  const w = Math.min(size, days.length);
  let bestI = 0;
  let bestMean = mode === 'max' ? -Infinity : Infinity;
  for (let i = 0; i + w <= days.length; i++) {
    let sum = 0;
    for (let j = i; j < i + w; j++) sum += days[j].confidenceScore;
    const mean = sum / w;
    if ((mode === 'max' && mean > bestMean) || (mode === 'min' && mean < bestMean)) {
      bestMean = mean;
      bestI = i;
    }
  }
  return { start: days[bestI].date, end: days[bestI + w - 1].date };
}

function buildFocusHighlight(
  focusAreas: string[] | undefined,
  totals: Record<string, number>,
): { theme: LifeTheme; line: string; lineSi: string } | undefined {
  const focus = normalizeFocus(focusAreas);
  if (!focus.length) return undefined;
  // The user's top focus that the chart actually supports this period.
  const supported = [...focus].sort((a, b) => (totals[b] ?? 0) - (totals[a] ?? 0))[0];
  if (!supported || (totals[supported] ?? 0) <= 0) return undefined;
  return {
    theme: supported,
    line: `Your ${THEME_WORD_EN[supported]} focus is supported this period.`,
    lineSi: `ඔබේ ${THEME_WORD_SI[supported]} අවධානයට මෙම කාලයේ සහාය ලැබේ.`,
  };
}

// ── Copy ─────────────────────────────────────────────────────────────────────

const THEME_WORD_EN: Record<LifeTheme, string> = {
  career: 'career & work', money: 'money & resources', relationship: 'relationships',
  health: 'health & energy', education: 'learning', travel: 'travel & movement',
  business: 'business & deals', spiritual: 'inner life', overall: 'steady progress',
};
const THEME_WORD_SI: Record<LifeTheme, string> = {
  career: 'රැකියාව හා වැඩ', money: 'මුදල් හා සම්පත්', relationship: 'සබඳතා',
  health: 'සෞඛ්‍යය හා ශක්තිය', education: 'ඉගෙනීම', travel: 'ගමන් හා චලනය',
  business: 'ව්‍යාපාර හා ගනුදෙනු', spiritual: 'අභ්‍යන්තර ජීවිතය', overall: 'ස්ථාවර ප්‍රගතිය',
};

function weeklyActionEn(t: LifeTheme): string {
  const m: Record<LifeTheme, string> = {
    career: 'Pick one work goal and move it forward early in the week.',
    money: 'Review one money decision calmly before acting.',
    relationship: 'Make time for one honest, unhurried conversation.',
    health: 'Protect your rest and keep the routine light.',
    education: 'Set aside focused time to learn or finish one thing.',
    travel: 'Plan or confirm one trip or outing.',
    business: 'Follow up on one key contact or deal.',
    spiritual: 'Keep a short daily practice for grounding.',
    overall: 'Choose one priority and pace yourself through it.',
  };
  return m[t];
}
function weeklyActionSi(t: LifeTheme): string {
  const m: Record<LifeTheme, string> = {
    career: 'එක් වැඩ ඉලක්කයක් තෝරා සතිය මුලදීම ඉදිරියට ගන්න.',
    money: 'ක්‍රියාවට පෙර එක් මුදල් තීරණයක් සන්සුන්ව සමාලෝචනය කරන්න.',
    relationship: 'එක් අවංක, නොඉක්මන් සංවාදයකට කාලය වෙන් කරන්න.',
    health: 'විවේකය රැකගෙන දිනචරියාව සැහැල්ලුව තබන්න.',
    education: 'එක් දෙයක් ඉගෙනීමට හෝ නිම කිරීමට අවධාන කාලයක් වෙන් කරන්න.',
    travel: 'එක් ගමනක් සැලසුම් කරන්න හෝ තහවුරු කරන්න.',
    business: 'එක් ප්‍රධාන සම්බන්ධතාවක් හෝ ගනුදෙනුවක් පසුවිපරම් කරන්න.',
    spiritual: 'ස්ථාවරත්වය සඳහා කෙටි දෛනික පුහුණුවක් තබන්න.',
    overall: 'එක් ප්‍රමුඛතාවක් තෝරා සන්සුන්ව ඉදිරියට යන්න.',
  };
  return m[t];
}
function monthlyActionEn(t: LifeTheme): string {
  const m: Record<LifeTheme, string> = {
    career: 'Set one clear career milestone for the month.',
    money: 'Plan the month\'s budget and one saving or investment step.',
    relationship: 'Invest steady, honest attention in the relationships that matter.',
    health: 'Build one sustainable health habit this month.',
    education: 'Commit to finishing one course, book, or skill.',
    travel: 'Map out the month\'s travel or a meaningful outing.',
    business: 'Line up the month\'s key meetings and follow-throughs.',
    spiritual: 'Keep a steady practice and one monthly reflection.',
    overall: 'Choose a monthly focus and revisit it weekly.',
  };
  return m[t];
}
function monthlyActionSi(t: LifeTheme): string {
  const m: Record<LifeTheme, string> = {
    career: 'මාසය සඳහා පැහැදිලි රැකියා ඉලක්කයක් තබන්න.',
    money: 'මාසයේ අයවැය හා එක් ඉතිරි කිරීමේ පියවරක් සැලසුම් කරන්න.',
    relationship: 'වැදගත් සබඳතාවලට ස්ථාවර, අවංක අවධානයක් යොදන්න.',
    health: 'මෙම මාසයේ තිරසාර සෞඛ්‍ය පුරුද්දක් ගොඩනඟන්න.',
    education: 'එක් පාඨමාලාවක්, පොතක් හෝ කුසලතාවක් නිම කිරීමට කැපවන්න.',
    travel: 'මාසයේ ගමන් හෝ අර්ථවත් සංචාරයක් සැලසුම් කරන්න.',
    business: 'මාසයේ ප්‍රධාන රැස්වීම් හා පසුවිපරම් සකසන්න.',
    spiritual: 'ස්ථාවර පුහුණුවක් හා මාසික ආවර්ජනයක් තබන්න.',
    overall: 'මාසික අවධානයක් තෝරා සතිපතා නැවත බලන්න.',
  };
  return m[t];
}

// ── Utility ──────────────────────────────────────────────────────────────────

function argmax(totals: Record<string, number>): LifeTheme {
  let best: LifeTheme = 'overall';
  let bestScore = -Infinity;
  for (const t of ALL_THEMES) {
    if (t === 'overall') continue;
    if ((totals[t] ?? 0) > bestScore) {
      bestScore = totals[t] ?? 0;
      best = t;
    }
  }
  return bestScore > 0 ? best : 'overall';
}

function normalizeFocus(raw?: string[]): LifeTheme[] {
  const out: LifeTheme[] = [];
  for (const item of raw ?? []) {
    const v = String(item).trim().toLowerCase() as LifeTheme;
    if ((ALL_THEMES as readonly string[]).includes(v) && v !== 'overall' && !out.includes(v)) out.push(v);
  }
  return out;
}

function roundTotals(totals: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of ALL_THEMES) out[t] = Number((totals[t] ?? 0).toFixed(4));
  return out;
}

function cap(s: string): string {
  return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
