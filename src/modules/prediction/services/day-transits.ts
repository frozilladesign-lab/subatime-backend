export type DayTransitType = 'challenge' | 'opportunity' | 'neutral';

export interface DayTransitDto {
  id: string;
  title: string;
  description: string;
  intensity: number;
  type: DayTransitType;
}

type PoolEntry = DayTransitDto & { intents?: string[] };

const POOL: PoolEntry[] = [
  {
    id: 'moon_conjunct_mars',
    title: 'Moon conjunct Mars',
    description:
      'Surges energy and quick reactions. Channel intensity into movement or focused execution instead of friction.',
    intensity: 4,
    type: 'challenge',
    intents: ['career', 'growth'],
  },
  {
    id: 'moon_trine_jupiter',
    title: 'Moon trine Jupiter',
    description:
      'Optimistic momentum favors outreach and generous gestures. Good window for teaching, pitching, or celebrating progress.',
    intensity: 4,
    type: 'opportunity',
    intents: ['career', 'love'],
  },
  {
    id: 'sun_square_saturn',
    title: 'Sun square Saturn',
    description:
      'Reality checks slow things down. Keep expectations modest and finish what is already in motion.',
    intensity: 3,
    type: 'challenge',
    intents: ['career'],
  },
  {
    id: 'venus_sextile_mercury',
    title: 'Venus sextile Mercury',
    description:
      'Words land softly — clarify feelings without drama. Useful for agreements and compassionate messaging.',
    intensity: 3,
    type: 'opportunity',
    intents: ['love'],
  },
  {
    id: 'moon_conjunct_saturn',
    title: 'Moon conjunct Saturn',
    description:
      'Emotional tone feels heavier or serious. Prefer boundaries, rest, and completing overdue duties.',
    intensity: 3,
    type: 'neutral',
    intents: ['growth', 'dreams'],
  },
  {
    id: 'mars_opposite_venus',
    title: 'Mars opposite Venus',
    description:
      'Desire and pacing can clash. Pause before pushing intimacy or purchases; aim for honest pacing.',
    intensity: 4,
    type: 'challenge',
    intents: ['love'],
  },
  {
    id: 'mercury_station_direct_tone',
    title: 'Mercury clearing shadow phase',
    description:
      'Details and schedules stabilize. Re-send confirmations and tighten loose ends with calm edits.',
    intensity: 2,
    type: 'opportunity',
    intents: ['career', 'growth'],
  },
  {
    id: 'moon_north_node_alignment',
    title: 'Moon aligned with growth axis',
    description:
      'Instinct nudges toward longer-range priorities. Small experiments today matter more than perfection.',
    intensity: 3,
    type: 'opportunity',
    intents: ['dreams', 'growth'],
  },
  {
    id: 'lunar_dusthana_pressure',
    title: 'Moon across a tense house sector',
    description:
      'Background fatigue or distraction rises. Batch tasks, shorten meetings, and guard sleep.',
    intensity: 3,
    type: 'challenge',
    intents: ['growth'],
  },
  {
    id: 'stable_earth_trine',
    title: 'Earth-sign supportive trine',
    description:
      'Practical tasks compound. Strong for budgeting, logistics, and steady craft.',
    intensity: 3,
    type: 'neutral',
    intents: ['career'],
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
 * Deterministic “transit highlights” for UI depth until full ephemeris aspects ship.
 */
export function deriveDailyTransitsFromPool(params: {
  date: Date;
  userId: string;
  onboardingIntent?: string | null;
  lagna: string;
  nakshatra: string;
}): DayTransitDto[] {
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
      title: raw.title,
      description: raw.description,
      intensity: Math.min(5, Math.max(1, Math.round(raw.intensity))),
      type: raw.type,
    });
  }

  picked.sort((a, b) => b.intensity - a.intensity || a.id.localeCompare(b.id));
  return picked;
}
