/**
 * Chart-derived dominant theme — the P0 personalization core.
 *
 * The daily prediction's THEME (career / money / relationship / health / …) must come
 * from the user's OWN chart, not from a coarse default. This module implements the
 * astrology decision hierarchy:
 *
 *   1. Lagna houses (35%)  — transits through the ascendant's whole-sign houses drive the
 *                            main life theme.
 *   2. Moon houses (20%)   — transits through the Moon-sign (Chandra Lagna) houses colour
 *                            the emotional / day-to-day tone.
 *   3. Dasha (20%)         — the current Mahādaśā lord's natal house biases the background
 *                            period theme.
 *   4. Natal promise (15%) — natal planets (by strength) give the chart's baseline theme.
 *   5. Panchanga (10%)     — timing only; NOT part of theme selection (it decides good/avoid
 *                            windows elsewhere).
 *
 * Focus areas only BOOST ranking — a strong chart signal still wins (astrologically honest).
 *
 * Fully deterministic: same chart + same transit longitudes ⇒ same theme. Different
 * Lagna / Moon / Dasha ⇒ different active houses ⇒ different theme, reason, and message.
 * No randomness, no Firebase, no DB.
 */

export type LifeTheme =
  | 'career'
  | 'money'
  | 'relationship'
  | 'health'
  | 'education'
  | 'travel'
  | 'business'
  | 'spiritual'
  | 'overall';

/** Coarse 4-value context the existing block-scoring accent still uses. */
export type CoreContext = 'overall' | 'career' | 'love' | 'health';

export interface TransitLongitude {
  planet: 'sun' | 'moon' | 'mars' | 'jupiter' | 'saturn' | 'rahu' | 'ketu';
  /** Sidereal longitude in degrees [0,360). */
  longitude: number;
}

export interface ChartContextInput {
  /** Natal sidereal ascendant longitude (degrees). */
  ascendantLongitude: number;
  /** Natal sidereal Moon longitude (degrees). */
  natalMoonLongitude: number;
  /** Current Mahādaśā lord (e.g. "Jupiter"), if known. */
  dashaLord?: string;
  /** Natal sidereal planet longitudes (degrees) keyed by planet name, for dasha-house + promise. */
  natalPlanets?: Partial<Record<string, number>>;
  /** Today's transiting planet sidereal longitudes. */
  transits: TransitLongitude[];
  /** User life-focus areas — boost matching themes, never override a strong chart signal. */
  focusAreas?: string[];
}

export interface ActiveHouse {
  house: number;
  planet: string;
  theme: LifeTheme;
}

export interface ChartContextResult {
  /** The chart-derived dominant life theme (8 areas + overall). Drives copy + notification priority. */
  dominantTheme: LifeTheme;
  /** Coarse context for the existing scoring accent (career/love/health/overall). */
  dominantContext: CoreContext;
  /** Normalized 0–1 score per theme (for audit / tie inspection). */
  themeScores: Record<LifeTheme, number>;
  /** Transiting planets and the Lagna house they activate today. */
  activeHousesFromLagna: ActiveHouse[];
  /** Transiting planets and the Moon-sign house they activate today. */
  activeHousesFromMoon: ActiveHouse[];
  /** Natal house (from Lagna) of the current Dasha lord, when resolvable. */
  dashaHouseFromLagna?: number;
  /** Human-readable "Saturn in your 10th house (career)" lines, strongest first. */
  topTransitInfluences: string[];
  /** Explainable reasons the theme was chosen (deterministic). */
  reasons: string[];
  /** True when focus areas changed the ranking outcome. */
  focusBoostApplied: boolean;
}

const ALL_THEMES: readonly LifeTheme[] = [
  'career', 'money', 'relationship', 'health', 'education', 'travel', 'business', 'spiritual', 'overall',
];

/**
 * Whole-sign house (1–12) significations → theme weights. Classical Vedic significations,
 * aligned with the Dasha rules (10/6/11 career-money, 2/11 money, 5/7 relationship,
 * 9/12 travel-spiritual).
 */
const HOUSE_THEME_WEIGHTS: Record<number, Partial<Record<LifeTheme, number>>> = {
  1:  { health: 0.6, career: 0.2, overall: 0.2 },
  2:  { money: 0.8, relationship: 0.2 },
  3:  { business: 0.4, career: 0.3, travel: 0.3 },
  4:  { health: 0.4, money: 0.3, relationship: 0.3 },
  5:  { education: 0.4, relationship: 0.4, spiritual: 0.2 },
  6:  { health: 0.5, career: 0.4, money: 0.1 },
  7:  { relationship: 0.6, business: 0.4 },
  8:  { health: 0.5, spiritual: 0.3, money: 0.2 },
  9:  { education: 0.35, travel: 0.35, spiritual: 0.3 },
  10: { career: 0.8, business: 0.2 },
  11: { money: 0.6, career: 0.2, relationship: 0.2 },
  12: { travel: 0.4, spiritual: 0.4, health: 0.2 },
};

/** How strongly each transiting body "activates" the house it occupies. */
const TRANSIT_PLANET_WEIGHT: Record<string, number> = {
  saturn: 1.0,
  jupiter: 1.0,
  rahu: 0.8,
  ketu: 0.6,
  mars: 0.7,
  sun: 0.6,
  moon: 0.5,
};

/** Natural theme affinity of a planet as Dasha lord (its own karakatva). */
const DASHA_LORD_THEMES: Record<string, Partial<Record<LifeTheme, number>>> = {
  Sun:     { career: 0.6, health: 0.2, spiritual: 0.2 },
  Moon:    { relationship: 0.4, health: 0.4, overall: 0.2 },
  Mars:    { career: 0.4, business: 0.3, health: 0.3 },
  Mercury: { business: 0.4, education: 0.4, money: 0.2 },
  Jupiter: { education: 0.35, spiritual: 0.3, money: 0.35 },
  Venus:   { relationship: 0.6, money: 0.2, travel: 0.2 },
  Saturn:  { career: 0.4, health: 0.3, spiritual: 0.3 },
  Rahu:    { travel: 0.4, career: 0.3, money: 0.3 },
  Ketu:    { spiritual: 0.6, health: 0.4 },
};

const LAYER_WEIGHT = { lagna: 0.35, moon: 0.20, dasha: 0.20, natal: 0.15 } as const;
const FOCUS_BOOST = 1.3;

export function computeChartContext(input: ChartContextInput): ChartContextResult {
  const scores: Record<LifeTheme, number> = zeroThemes();
  const activeHousesFromLagna: ActiveHouse[] = [];
  const activeHousesFromMoon: ActiveHouse[] = [];
  const influences: { text: string; weight: number }[] = [];

  // ── Layer 1 + 2: transits through Lagna houses (35%) and Moon houses (20%) ──
  for (const t of input.transits) {
    const w = TRANSIT_PLANET_WEIGHT[t.planet] ?? 0.5;
    const lagnaHouse = wholeSignHouse(t.longitude, input.ascendantLongitude);
    const moonHouse = wholeSignHouse(t.longitude, input.natalMoonLongitude);

    addHouse(scores, lagnaHouse, w * LAYER_WEIGHT.lagna);
    addHouse(scores, moonHouse, w * LAYER_WEIGHT.moon);

    const lagnaTheme = dominantHouseTheme(lagnaHouse);
    const moonTheme = dominantHouseTheme(moonHouse);
    activeHousesFromLagna.push({ house: lagnaHouse, planet: t.planet, theme: lagnaTheme });
    activeHousesFromMoon.push({ house: moonHouse, planet: t.planet, theme: moonTheme });

    // Slow/karmic planets make the most explainable "why" lines.
    if (t.planet === 'saturn' || t.planet === 'jupiter' || t.planet === 'rahu' || t.planet === 'mars') {
      influences.push({
        text: `${cap(t.planet)} is transiting your ${ordinal(lagnaHouse)} house (${lagnaTheme})`,
        weight: w,
      });
    }
  }

  // ── Layer 3: Dasha (20%) — lord's natal house + its natural karakatva ──
  let dashaHouseFromLagna: number | undefined;
  const dashaKey = normalizePlanetKey(input.dashaLord);
  if (dashaKey) {
    const natalLon = input.natalPlanets?.[dashaKey];
    if (typeof natalLon === 'number' && Number.isFinite(natalLon)) {
      dashaHouseFromLagna = wholeSignHouse(natalLon, input.ascendantLongitude);
      addHouse(scores, dashaHouseFromLagna, LAYER_WEIGHT.dasha * 0.6);
    }
    const capName = cap(dashaKey);
    const natural = DASHA_LORD_THEMES[capName];
    if (natural) addThemes(scores, natural, LAYER_WEIGHT.dasha * 0.4);
  }

  // ── Layer 4: Natal promise (15%) — natal planets by house (equal weight; strength optional) ──
  const natal = input.natalPlanets ?? {};
  const natalKeys = Object.keys(natal);
  if (natalKeys.length) {
    const per = LAYER_WEIGHT.natal / natalKeys.length;
    for (const key of natalKeys) {
      const lon = natal[key];
      if (typeof lon !== 'number' || !Number.isFinite(lon)) continue;
      addHouse(scores, wholeSignHouse(lon, input.ascendantLongitude), per);
    }
  }

  // Base scores (chart only) — capture the pre-focus winner to detect focus overrides.
  const chartWinner = argmaxTheme(scores);

  // ── Focus boost — ranking nudge only; never overrides a strong chart signal ──
  const focus = normalizeFocusAreas(input.focusAreas);
  for (const f of focus) addTheme(scores, f, scores[f] * (FOCUS_BOOST - 1));

  const dominantTheme = argmaxTheme(scores);
  const focusBoostApplied = focus.length > 0 && dominantTheme !== chartWinner;

  const reasons = buildReasons({
    dominantTheme,
    chartWinner,
    dashaLord: dashaKey ? cap(dashaKey) : undefined,
    dashaHouseFromLagna,
    focusBoostApplied,
    focus,
  });

  const topTransitInfluences = influences
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((i) => i.text);

  return {
    dominantTheme,
    dominantContext: coreContextOf(dominantTheme),
    themeScores: normalizeScores(scores),
    activeHousesFromLagna,
    activeHousesFromMoon,
    ...(dashaHouseFromLagna ? { dashaHouseFromLagna } : {}),
    topTransitInfluences,
    reasons,
    focusBoostApplied,
  };
}

/** Chart theme → coarse context for the existing block-scoring accent. */
export function coreContextOf(theme: LifeTheme): CoreContext {
  switch (theme) {
    case 'career':
    case 'business':
    case 'education':
    case 'money':
      return 'career';
    case 'relationship':
      return 'love';
    case 'health':
      return 'health';
    default:
      return 'overall';
  }
}

// ── House math ───────────────────────────────────────────────────────────────

/** Whole-sign house (1–12) of `pointLon` counted from `referenceLon`. */
export function wholeSignHouse(pointLon: number, referenceLon: number): number {
  const pSign = Math.floor(norm360(pointLon) / 30);
  const rSign = Math.floor(norm360(referenceLon) / 30);
  return ((pSign - rSign + 12) % 12) + 1;
}

function dominantHouseTheme(house: number): LifeTheme {
  const weights = HOUSE_THEME_WEIGHTS[house];
  if (!weights) return 'overall';
  let best: LifeTheme = 'overall';
  let bestW = -1;
  for (const [theme, w] of Object.entries(weights)) {
    if ((w ?? 0) > bestW) {
      bestW = w ?? 0;
      best = theme as LifeTheme;
    }
  }
  return best;
}

function addHouse(scores: Record<LifeTheme, number>, house: number, weight: number): void {
  const themes = HOUSE_THEME_WEIGHTS[house];
  if (!themes) return;
  for (const [theme, w] of Object.entries(themes)) {
    scores[theme as LifeTheme] += (w ?? 0) * weight;
  }
}

function addThemes(scores: Record<LifeTheme, number>, themes: Partial<Record<LifeTheme, number>>, weight: number): void {
  for (const [theme, w] of Object.entries(themes)) {
    scores[theme as LifeTheme] += (w ?? 0) * weight;
  }
}

function addTheme(scores: Record<LifeTheme, number>, theme: LifeTheme, amount: number): void {
  scores[theme] += amount;
}

// ── Utility ──────────────────────────────────────────────────────────────────

function zeroThemes(): Record<LifeTheme, number> {
  const o = {} as Record<LifeTheme, number>;
  for (const t of ALL_THEMES) o[t] = 0;
  return o;
}

/**
 * Argmax theme. 'overall' only wins if it strictly beats every specific theme, so a
 * chart with any real house activation always surfaces a concrete life area.
 */
function argmaxTheme(scores: Record<LifeTheme, number>): LifeTheme {
  let best: LifeTheme = 'overall';
  let bestScore = -Infinity;
  // Deterministic tie-break by fixed theme order.
  for (const t of ALL_THEMES) {
    if (t === 'overall') continue;
    if (scores[t] > bestScore) {
      bestScore = scores[t];
      best = t;
    }
  }
  return bestScore > 0 ? best : 'overall';
}

function normalizeScores(scores: Record<LifeTheme, number>): Record<LifeTheme, number> {
  const max = Math.max(...ALL_THEMES.map((t) => scores[t]), 1e-9);
  const out = zeroThemes();
  for (const t of ALL_THEMES) out[t] = Number((scores[t] / max).toFixed(4));
  return out;
}

function normalizeFocusAreas(raw?: string[]): LifeTheme[] {
  const out: LifeTheme[] = [];
  for (const item of raw ?? []) {
    const v = item.trim().toLowerCase() as LifeTheme;
    if ((ALL_THEMES as readonly string[]).includes(v) && v !== 'overall' && !out.includes(v)) {
      out.push(v);
    }
  }
  return out;
}

function normalizePlanetKey(name?: string): string | undefined {
  if (!name) return undefined;
  const k = name.trim().toLowerCase();
  return ['sun', 'moon', 'mars', 'mercury', 'jupiter', 'venus', 'saturn', 'rahu', 'ketu'].includes(k)
    ? k
    : undefined;
}

function buildReasons(p: {
  dominantTheme: LifeTheme;
  chartWinner: LifeTheme;
  dashaLord?: string;
  dashaHouseFromLagna?: number;
  focusBoostApplied: boolean;
  focus: LifeTheme[];
}): string[] {
  const reasons: string[] = [];
  if (p.dominantTheme !== 'overall') {
    reasons.push(`Today's transits most activate your ${themeLabel(p.dominantTheme)} houses.`);
  } else {
    reasons.push('No single life area dominates today — general guidance applies.');
  }
  if (p.dashaLord && p.dashaHouseFromLagna) {
    reasons.push(`${p.dashaLord} Mahādaśā (natal ${ordinal(p.dashaHouseFromLagna)} house) shapes the background period.`);
  }
  if (p.focusBoostApplied) {
    reasons.push(`Your focus (${p.focus.join(', ')}) raised ${themeLabel(p.dominantTheme)} above the chart baseline (${themeLabel(p.chartWinner)}).`);
  }
  return reasons;
}

function themeLabel(t: LifeTheme): string {
  return t === 'overall' ? 'general' : t;
}

function norm360(v: number): number {
  const n = v % 360;
  return n < 0 ? n + 360 : n;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}
