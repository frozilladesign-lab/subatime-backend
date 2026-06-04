export type DayTransitType = 'challenge' | 'opportunity' | 'neutral';

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
 * Deterministic daily transit highlights for UI depth.
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
    });
  }

  picked.sort((a, b) => b.intensity - a.intensity || a.id.localeCompare(b.id));
  return picked;
}
