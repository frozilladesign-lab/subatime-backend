import { NAKSHATRA_LIST, SIDEREAL_SIGNS } from '../chart/chart-engine';

export type DayTransitType = 'challenge' | 'opportunity' | 'neutral';

export type DayTransitAspectType = 'conjunction' | 'sextile' | 'square' | 'trine' | 'opposition';
export type DayTransitNatalReference = 'moon' | 'sun' | 'ascendant';

export interface DayTransitDto {
  id: string;
  title: string;
  titleSi?: string;
  description: string;
  descriptionSi?: string;
  intensity: number;
  type: DayTransitType;
  /** Optional time window when this transit is strongest. */
  window?: string;
  /**
   * True when this card was derived from a real transit-Moon longitude calculation and a
   * configured-orb aspect check. False for static fallback copy (see `degraded`/`degradedReason`).
   */
  isComputed?: boolean;
  /** True for static fallback copy that is not derived from a real transit calculation. */
  degraded?: boolean;
  degradedReason?: string;
  /** Always 'moon' for now — the only body whose transit is checked per time block/day. */
  transitBody?: 'moon';
  natalReference?: DayTransitNatalReference;
  aspectType?: DayTransitAspectType;
  /** Actual angular deviation (degrees) from the exact aspect angle, when `isComputed`. */
  orb?: number;
  transitLongitude?: number;
  natalLongitude?: number;
  transitMoonSign?: string;
  transitMoonNakshatra?: string;
  /** Whole-sign house of the transit Moon counted from the natal ascendant (lagna), 1–12. */
  transitMoonHouseFromLagna?: number;
  /** Whole-sign house of the transit Moon counted from the natal Moon sign (Janma Rāśi), 1–12. */
  transitMoonHouseFromNatalMoon?: number;
}

type PoolEntry = DayTransitDto & { intents?: string[] };

const POOL: PoolEntry[] = [
  {
    id: 'moon_conjunct_mars',
    title:         'Moon conjunct Mars',
    titleSi:       'සඳු සහ කුජ සංගමය',
    description:   'Surges energy and quick reactions. Channel intensity into movement or focused execution instead of friction.',
    descriptionSi: 'ශක්තිය හා ඉක්මන් ප්‍රතිචාර ඇති කරයි. ඝර්ෂණයෙන් වළකින්න — ශ්‍රමය හා ක්‍රියාවලට යොමු කරන්න.',
    intensity: 4,
    type: 'challenge',
    intents: ['career', 'growth'],
  },
  {
    id: 'moon_trine_jupiter',
    title:         'Moon trine Jupiter',
    titleSi:       'සඳු ගුරු ත්‍රිකෝණය',
    description:   'Optimistic momentum favors outreach and generous gestures. Good window for teaching, pitching, or celebrating progress.',
    descriptionSi: 'ශුභ ප්‍රවේගය ගෙනෙයි. ඉදිරිපත් කිරීමට, ඉගැන්වීමට හෝ ජය සැමරීමට ශ්‍රේෂ්ඨ කාලයකි.',
    intensity: 4,
    type: 'opportunity',
    intents: ['career', 'love'],
  },
  {
    id: 'sun_square_saturn',
    title:         'Sun square Saturn',
    titleSi:       'රවි සහ ශනි චතුරශ්‍රය',
    description:   'Reality checks slow things down. Keep expectations modest and finish what is already in motion.',
    descriptionSi: 'යථාර්ථය දළ කරයි. ඉලක්ක සාධාරණ කරන්න — දැනට ගමන් කරන දේ නිම කිරීමට ශ්‍රම කරන්න.',
    intensity: 3,
    type: 'challenge',
    intents: ['career'],
  },
  {
    id: 'venus_sextile_mercury',
    title:         'Venus sextile Mercury',
    titleSi:       'සිකුරු බුධ ෂෂ්ඨය',
    description:   'Words land softly — clarify feelings without drama. Useful for agreements and compassionate messaging.',
    descriptionSi: 'වචන මෘදුව ගැලෙයි — ආවේගයකින් තොරව හැඟීම් පැහැදිලි කරන්න. ගිවිසුම් සඳහා ශ්‍රේෂ්ඨ කාලයකි.',
    intensity: 3,
    type: 'opportunity',
    intents: ['love'],
  },
  {
    id: 'moon_conjunct_saturn',
    title:         'Moon conjunct Saturn',
    titleSi:       'සඳු සහ ශනි සංගමය',
    description:   'Emotional tone feels heavier or serious. Prefer boundaries, rest, and completing overdue duties.',
    descriptionSi: 'හැඟීම් බර හෝ බැරෑරුම් වේ. සීමා ආරක්ෂා කරන්න, විශ්‍රාමය ගන්න, ප්‍රමාද කාර්ය නිම කරන්න.',
    intensity: 3,
    type: 'neutral',
    intents: ['growth', 'dreams'],
  },
  {
    id: 'mars_opposite_venus',
    title:         'Mars opposite Venus',
    titleSi:       'කුජ සහ සිකුරු ප්‍රතිචාරය',
    description:   'Desire and pacing can clash. Pause before pushing intimacy or purchases; aim for honest pacing.',
    descriptionSi: 'ආශාව හා ගමනේ වේගය ගැටිය හැක. ළදරු සම්බන්ධ හෝ මිලදීගැනීමට පෙර නතර වෙන්න.',
    intensity: 4,
    type: 'challenge',
    intents: ['love'],
  },
  {
    id: 'mercury_station_direct_tone',
    title:         'Mercury clearing shadow phase',
    titleSi:       'බුධ ඡායා අදියර අවසන්',
    description:   'Details and schedules stabilize. Re-send confirmations and tighten loose ends with calm edits.',
    descriptionSi: 'විස්තර හා කාලසටහන් ස්ථාවර වේ. තහවුරු කිරීම් යවන්න, ලිහිල් කෙළවර සම්පූර්ණ කරන්න.',
    intensity: 2,
    type: 'opportunity',
    intents: ['career', 'growth'],
  },
  {
    id: 'moon_north_node_alignment',
    title:         'Moon aligned with growth axis',
    titleSi:       'සඳු ශ්‍රේෂ්ඨ ශ්‍රේෂ්ඨ',
    description:   'Instinct nudges toward longer-range priorities. Small experiments today matter more than perfection.',
    descriptionSi: 'අභ්‍යන්තර ස්වාභාවිකත්වය දිගු කාලීන ඉලක්ක දෙසට ලෙළදෙයි. කුඩා අත්හදා බැලීම් අද වැදගත්.',
    intensity: 3,
    type: 'opportunity',
    intents: ['dreams', 'growth'],
  },
  {
    id: 'lunar_dusthana_pressure',
    title:         'Moon across a tense house sector',
    titleSi:       'සඳු ආතතිය ගෘහ ඛණ්ඩය',
    description:   'Background fatigue or distraction rises. Batch tasks, shorten meetings, and guard sleep.',
    descriptionSi: 'පසුබිම් වෙහෙස හා අවධානය කාන්දු වේ. කාර්ය කාණ්ඩ කරන්න, රැස්වීම් කෙටි කරන්න, නිද්‍රාව ආරක්ෂා කරන්න.',
    intensity: 3,
    type: 'challenge',
    intents: ['growth'],
  },
  {
    id: 'stable_earth_trine',
    title:         'Earth-sign supportive trine',
    titleSi:       'පෘථිවි රාශි ශ්‍රේෂ්ඨ ත්‍රිකෝණය',
    description:   'Practical tasks compound. Strong for budgeting, logistics, and steady craft.',
    descriptionSi: 'ප්‍රායෝගික කාර්ය ශ්‍රේෂ්ඨ ලෙස ජය ගනී. අයවැය, සැලසුම් සහ ස්ථිර ශිල්පය සඳහා ශ්‍රේෂ්ඨ දිනයකි.',
    intensity: 3,
    type: 'neutral',
    intents: ['career'],
  },
  {
    id: 'moon_venus_harmony',
    title:         'Moon in harmony with Venus',
    titleSi:       'සඳු සිකුරු සම්මිශ්‍රණය',
    description:   'Warmth flows in relationships and creative work. Good for collaboration and appreciating beauty.',
    descriptionSi: 'සම්බන්ධකම් හා නිර්මාණශීලී කාර්යයේ උණුසුම ගලා යයි. සහයෝගිතාව සහ සෞන්දර්යය ලබා ගැනීමට ශ්‍රේෂ්ඨ.',
    intensity: 3,
    type: 'opportunity',
    intents: ['love', 'dreams'],
  },
  {
    id: 'sun_mercury_conjunction',
    title:         'Sun conjunct Mercury — clear mind',
    titleSi:       'රවි බුධ සංගමය — පැහැදිලි සිත',
    description:   'Thinking aligns with purpose. Ideal for writing, planning, or any work needing sharp focus.',
    descriptionSi: 'සිතුවිලි අරමුණ සමඟ ගැලෙයි. ලිවීමට, සැලසුම් කිරීමට හෝ තීව්‍ර ශ්‍රේෂ්ඨ ශ්‍රේෂ්ඨ අවශ්‍ය ශ්‍රේෂ්ඨ.',
    intensity: 3,
    type: 'opportunity',
    intents: ['career', 'growth'],
  },
];

function hashSeed(parts: string[]): number {
  const s = parts.join('|');
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

function rankPool(intent: string | null | undefined): PoolEntry[] {
  const raw = (intent ?? '').toLowerCase().trim();
  if (!raw) return [...POOL];
  const keys = raw
    .split(/[,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!keys.length) return [...POOL];
  const score = (entry: PoolEntry) =>
    keys.reduce((acc, key) => acc + (entry.intents?.includes(key) ? 1 : 0), 0);
  return [...POOL].sort((a, b) => score(b) - score(a));
}

/**
 * Deterministic fallback daily transit highlights — NOT derived from any real transit
 * calculation. Used only when natal longitudes (ascendant/Moon/Sun) aren't available to run
 * `computeRealDailyTransitCards`. Every card is stamped `isComputed: false`, `degraded: true`,
 * `degradedReason` so callers/UI can never mistake this static copy for a real transit.
 * When lang='si', returns Sinhala title and description.
 */
export function deriveDailyTransitsFromPool(params: {
  date: Date;
  userId: string;
  onboardingIntent?: string | null;
  lagna: string;
  nakshatra: string;
  lang?: string;
}): DayTransitDto[] {
  const isSi = (params.lang ?? 'en').toLowerCase().trim() === 'si';
  const seed = hashSeed([
    params.userId,
    params.date.toISOString().slice(0, 10),
    params.onboardingIntent ?? '',
    params.lagna,
    params.nakshatra,
  ]);
  const ranked = rankPool(params.onboardingIntent);
  const n = ranked.length;
  const picked: DayTransitDto[] = [];
  const seen = new Set<string>();

  for (let k = 0; k < n && picked.length < 3; k += 1) {
    const idx = (seed + k * 31) % n;
    const raw = ranked[idx];
    if (seen.has(raw.id)) continue;
    seen.add(raw.id);
    picked.push({
      id: raw.id,
      title:       isSi && raw.titleSi       ? raw.titleSi       : raw.title,
      description: isSi && raw.descriptionSi ? raw.descriptionSi : raw.description,
      intensity: Math.min(5, Math.max(1, Math.round(raw.intensity))),
      type: raw.type,
      isComputed: false,
      degraded: true,
      degradedReason: 'static-pool-fallback-no-natal-longitudes-available',
    });
  }

  picked.sort((a, b) => b.intensity - a.intensity || a.id.localeCompare(b.id));
  return picked;
}

/** Configured orb (degrees) per classical major aspect, used by `computeRealDailyTransitCards`. */
const DAY_TRANSIT_ASPECT_ORBS: { type: DayTransitAspectType; angle: number; orb: number }[] = [
  { type: 'conjunction', angle: 0, orb: 8 },
  { type: 'sextile', angle: 60, orb: 5 },
  { type: 'square', angle: 90, orb: 6 },
  { type: 'trine', angle: 120, orb: 7 },
  { type: 'opposition', angle: 180, orb: 8 },
];

const ASPECT_TYPE_LABEL: Record<DayTransitAspectType, string> = {
  conjunction: 'conjunct',
  sextile: 'sextile',
  square: 'square',
  trine: 'trine',
  opposition: 'opposite',
};

const NATAL_REFERENCE_LABEL: Record<DayTransitNatalReference, string> = {
  moon: 'Moon',
  sun: 'Sun',
  ascendant: 'Ascendant',
};

/** Geometric tone of each aspect type — conjunction is blending/intensifying, not inherently good or bad. */
const ASPECT_TONE: Record<DayTransitAspectType, DayTransitType> = {
  conjunction: 'neutral',
  sextile: 'opportunity',
  trine: 'opportunity',
  square: 'challenge',
  opposition: 'challenge',
};

function norm360(v: number): number {
  const n = v % 360;
  return n < 0 ? n + 360 : n;
}

function smallestArc(a: number, b: number): number {
  let d = Math.abs(norm360(a) - norm360(b)) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

function wholeSignHouse(pointLon: number, fromLon: number): number {
  return Math.floor(norm360(pointLon - fromLon) / 30) + 1;
}

/** Tighter orb match → stronger felt intensity (1–5). */
function intensityFromOrb(deviation: number, maxOrb: number): number {
  const t = Math.max(0, Math.min(1, deviation / maxOrb));
  return Math.max(1, Math.min(5, Math.round(5 - 3 * t)));
}

type AspectHitInternal = {
  ref: DayTransitNatalReference;
  natalLon: number;
  aspect: (typeof DAY_TRANSIT_ASPECT_ORBS)[number];
  separation: number;
  deviation: number;
};

/**
 * Real computed daily transit cards — no static/hash-selected copy. Calculates the transit
 * Moon's sidereal sign/nakṣatra/houses and checks its actual angular separation from natal
 * Moon, Sun, and ascendant against configured orbs for conjunction/sextile/square/trine/
 * opposition. A card is only emitted for an aspect that is actually within orb today; if none
 * are, a single neutral "Steady Lunar Influence" card is returned instead of a fabricated one.
 */
export function computeRealDailyTransitCards(params: {
  transitMoonLongitude: number;
  natalAscendantLongitude: number;
  natalMoonLongitude: number;
  natalSunLongitude: number;
  lang?: string;
}): DayTransitDto[] {
  const isSi = (params.lang ?? 'en').toLowerCase().trim() === 'si';
  const transitMoon = norm360(params.transitMoonLongitude);
  const transitMoonSign = SIDEREAL_SIGNS[Math.floor(transitMoon / 30)] ?? SIDEREAL_SIGNS[0];
  const transitMoonNakshatra =
    NAKSHATRA_LIST[Math.floor(transitMoon / (360 / 27))] ?? NAKSHATRA_LIST[0];
  const transitMoonHouseFromLagna = wholeSignHouse(transitMoon, params.natalAscendantLongitude);
  const transitMoonHouseFromNatalMoon = wholeSignHouse(transitMoon, params.natalMoonLongitude);

  const references: { ref: DayTransitNatalReference; lon: number }[] = [
    { ref: 'moon', lon: norm360(params.natalMoonLongitude) },
    { ref: 'sun', lon: norm360(params.natalSunLongitude) },
    { ref: 'ascendant', lon: norm360(params.natalAscendantLongitude) },
  ];

  const hits: AspectHitInternal[] = [];
  for (const { ref, lon } of references) {
    const separation = smallestArc(transitMoon, lon);
    let best: AspectHitInternal | null = null;
    for (const aspect of DAY_TRANSIT_ASPECT_ORBS) {
      const deviation = Math.abs(separation - aspect.angle);
      if (deviation <= aspect.orb && (!best || deviation < best.deviation)) {
        best = { ref, natalLon: lon, aspect, separation, deviation };
      }
    }
    if (best) hits.push(best);
  }
  hits.sort((a, b) => a.deviation - b.deviation);
  const top = hits.slice(0, 3);

  if (top.length === 0) {
    return [
      {
        id: 'steady_lunar_influence',
        title: 'Steady Lunar Influence',
        titleSi: isSi ? 'ස්ථාවර චන්ද්‍ර බලපෑම' : undefined,
        description:
          `No major Moon aspect (conjunction, sextile, square, trine, or opposition) to your natal ` +
          `Moon, Sun, or ascendant is active within the configured orb today. The transit Moon is in ` +
          `${transitMoonSign} (${transitMoonNakshatra} nakṣatra).`,
        descriptionSi: isSi
          ? `අද දින වින්‍යාසගත මාත්‍රාව තුළ චන්ද්‍රයාගේ ප්‍රධාන කෝණයක් ක්‍රියාත්මක නොවේ. සංක්‍රාන්ති චන්ද්‍රයා ${transitMoonSign} (${transitMoonNakshatra}) හි පවතී.`
          : undefined,
        intensity: 2,
        type: 'neutral',
        isComputed: true,
        transitBody: 'moon',
        transitLongitude: Number(transitMoon.toFixed(4)),
        transitMoonSign,
        transitMoonNakshatra,
        transitMoonHouseFromLagna,
        transitMoonHouseFromNatalMoon,
      },
    ];
  }

  return top.map((hit) => {
    const refLabel = NATAL_REFERENCE_LABEL[hit.ref];
    const aspectLabel = ASPECT_TYPE_LABEL[hit.aspect.type];
    const tone = ASPECT_TONE[hit.aspect.type];
    return {
      id: `transit_moon_${hit.aspect.type}_natal_${hit.ref}`,
      title: `Transit Moon ${aspectLabel} natal ${refLabel}`,
      description:
        `The transiting Moon (${transitMoonSign}, ${transitMoonNakshatra} nakṣatra) is in ${hit.aspect.type} ` +
        `with your natal ${refLabel.toLowerCase()} — ${hit.deviation.toFixed(1)}° from exact, within ` +
        `the configured ${hit.aspect.orb}° orb.`,
      intensity: intensityFromOrb(hit.deviation, hit.aspect.orb),
      type: tone,
      isComputed: true,
      transitBody: 'moon',
      natalReference: hit.ref,
      aspectType: hit.aspect.type,
      orb: Number(hit.deviation.toFixed(4)),
      transitLongitude: Number(transitMoon.toFixed(4)),
      natalLongitude: Number(hit.natalLon.toFixed(4)),
      transitMoonSign,
      transitMoonNakshatra,
      transitMoonHouseFromLagna,
      transitMoonHouseFromNatalMoon,
    };
  });
}
