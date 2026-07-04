import { NAKSHATRA_LIST, SIDEREAL_SIGNS } from '../chart/chart-engine';
import { normalizeProfileStrict } from './compatibility-engine';
import { taraIndex1to9 } from '../calendar/tara';
import type { AshtakootaCompatibilityResult, AshtakootaKootaResult, RawCompatibilityProfile } from './types';
import { MatchProfileError } from './types';

/**
 * Classical Aṣṭakūṭa (8-koota) guṇa matching — Varna, Vashya, Tara, Yoni, Graha Maitri, Gana,
 * Bhakoot, Nadi. This is a deterministic application of widely-published classical rules, not
 * an original scoring model (contrast with `compareHeuristicCompatibility`). Regional and
 * lineage variations of these rules exist (especially Vashya cross-group scoring, the full
 * 14×14 Yoni matrix, and Gana cross-group scoring); the simplifications made here are called
 * out explicitly in `warnings` below. Treat this as one documented classical-rule application,
 * not the single authoritative answer.
 */

type RashiName = (typeof SIDEREAL_SIGNS)[number];
type NakshatraName = (typeof NAKSHATRA_LIST)[number];

function rashiIndex(name: string): number {
  return (SIDEREAL_SIGNS as readonly string[]).indexOf(name.trim());
}

function nakshatraIndex(name: string): number {
  return (NAKSHATRA_LIST as readonly string[]).indexOf(name.trim());
}

// ---- 1. Varna (max 1) ----------------------------------------------------
const VARNA_RANK: Record<RashiName, number> = {
  Karka: 4, Vrischika: 4, Meena: 4, // Brahmin
  Mesha: 3, Simha: 3, Dhanu: 3, // Kshatriya
  Vrishabha: 2, Kanya: 2, Makara: 2, // Vaishya
  Mithuna: 1, Tula: 1, Kumbha: 1, // Shudra
};

function scoreVarna(rashiA: RashiName, rashiB: RashiName): AshtakootaKootaResult {
  const score = VARNA_RANK[rashiA] >= VARNA_RANK[rashiB] ? 1 : 0;
  return {
    name: 'Varna',
    score,
    maxScore: 1,
    explanation:
      'Spiritual/social aptitude hierarchy by Moon-sign (Brahmin > Kshatriya > Vaishya > Shudra). ' +
      'Full point when the first profile\'s varna rank is at or above the second\'s.',
  };
}

// ---- 2. Vashya (max 2) ----------------------------------------------------
type VashyaGroup = 'chatushpada' | 'manava' | 'jalachara' | 'vanachara' | 'keeta';
// Whole-sign simplification: classically Dhanu and Makara are each split across two Vashya
// groups by degree (pāda); this whole-sign table assigns each fully to one group (Dhanu →
// Manava, Makara → Jalachara), which is a documented simplification, not the only convention.
const VASHYA_GROUP: Record<RashiName, VashyaGroup> = {
  Mesha: 'chatushpada', Vrishabha: 'chatushpada',
  Mithuna: 'manava', Kanya: 'manava', Tula: 'manava', Dhanu: 'manava', Kumbha: 'manava',
  Karka: 'jalachara', Makara: 'jalachara', Meena: 'jalachara',
  Simha: 'vanachara',
  Vrischika: 'keeta',
};

function scoreVashya(rashiA: RashiName, rashiB: RashiName): AshtakootaKootaResult {
  const ga = VASHYA_GROUP[rashiA];
  const gb = VASHYA_GROUP[rashiB];
  let score: number;
  if (ga === gb) score = 2;
  else if ((ga === 'manava' && gb === 'chatushpada') || (ga === 'chatushpada' && gb === 'manava')) score = 1;
  else score = 0;
  return {
    name: 'Vashya',
    score,
    maxScore: 2,
    explanation:
      'Mutual dominance/control temperament by Moon-sign animal group (quadruped/human/aquatic/' +
      'wild/insect). Full points for the same group; partial credit for the human↔quadruped pairing.',
  };
}

// ---- 3. Tara (max 3) -------------------------------------------------------
const FAVORABLE_TARA = new Set([2, 4, 6, 8, 9]);

function scoreTara(nakA: number, nakB: number): AshtakootaKootaResult {
  const aToB = taraIndex1to9(nakA, nakB);
  const bToA = taraIndex1to9(nakB, nakA);
  const half = 1.5;
  const score = (FAVORABLE_TARA.has(aToB) ? half : 0) + (FAVORABLE_TARA.has(bToA) ? half : 0);
  return {
    name: 'Tara',
    score,
    maxScore: 3,
    explanation:
      'Birth-star count (both directions) reduced to one of nine tārā categories; favorable ' +
      'categories (Sampat, Kshema, Sadhaka, Mitra, Parama Mitra) each contribute half the total.',
  };
}

// ---- 4. Yoni (max 4) --------------------------------------------------------
type YoniAnimal =
  | 'Horse' | 'Elephant' | 'Sheep' | 'Serpent' | 'Dog' | 'Cat' | 'Rat' | 'Cow'
  | 'Buffalo' | 'Tiger' | 'Deer' | 'Monkey' | 'Mongoose' | 'Lion';

const NAKSHATRA_YONI: Record<NakshatraName, YoniAnimal> = {
  Ashwini: 'Horse', Bharani: 'Elephant', Krittika: 'Sheep', Rohini: 'Serpent',
  Mrigashira: 'Serpent', Ardra: 'Dog', Punarvasu: 'Cat', Pushya: 'Sheep',
  Ashlesha: 'Cat', Magha: 'Rat', 'Purva Phalguni': 'Rat', 'Uttara Phalguni': 'Cow',
  Hasta: 'Buffalo', Chitra: 'Tiger', Swati: 'Buffalo', Vishakha: 'Tiger',
  Anuradha: 'Deer', Jyeshtha: 'Deer', Mula: 'Dog', 'Purva Ashadha': 'Monkey',
  'Uttara Ashadha': 'Mongoose', Shravana: 'Monkey', Dhanishta: 'Lion',
  Shatabhisha: 'Horse', 'Purva Bhadrapada': 'Lion', 'Uttara Bhadrapada': 'Cow', Revati: 'Elephant',
};

// Widely-cited natural-enmity yoni pairs ("yoni vipareeta"); all other distinct pairs are
// flattened to a single "neutral" score here rather than the full graded 14×14 matrix some
// texts use — a documented simplification, not the complete classical table.
const YONI_ENEMIES: [YoniAnimal, YoniAnimal][] = [
  ['Cow', 'Tiger'], ['Elephant', 'Lion'], ['Serpent', 'Mongoose'],
  ['Dog', 'Deer'], ['Monkey', 'Sheep'], ['Rat', 'Cat'], ['Horse', 'Buffalo'],
];

function isYoniEnemyPair(a: YoniAnimal, b: YoniAnimal): boolean {
  return YONI_ENEMIES.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

function scoreYoni(nakA: NakshatraName, nakB: NakshatraName): AshtakootaKootaResult {
  const ya = NAKSHATRA_YONI[nakA];
  const yb = NAKSHATRA_YONI[nakB];
  let score: number;
  if (ya === yb) score = 4;
  else if (isYoniEnemyPair(ya, yb)) score = 0;
  else score = 2;
  return {
    name: 'Yoni',
    score,
    maxScore: 4,
    explanation:
      'Symbolic-animal-nature compatibility by birth nakṣatra. Full points for the same yoni, ' +
      'zero for a documented natural-enmity pair, neutral credit otherwise (simplified from the ' +
      'full graded 14×14 yoni matrix some traditions use).',
  };
}

// ---- 5. Graha Maitri (max 5) -------------------------------------------------
type Graha = 'Sun' | 'Moon' | 'Mars' | 'Mercury' | 'Jupiter' | 'Venus' | 'Saturn';

const RASHI_LORD: Record<RashiName, Graha> = {
  Mesha: 'Mars', Vrishabha: 'Venus', Mithuna: 'Mercury', Karka: 'Moon', Simha: 'Sun',
  Kanya: 'Mercury', Tula: 'Venus', Vrischika: 'Mars', Dhanu: 'Jupiter', Makara: 'Saturn',
  Kumbha: 'Saturn', Meena: 'Jupiter',
};

const GRAHA_FRIENDS: Record<Graha, Graha[]> = {
  Sun: ['Moon', 'Mars', 'Jupiter'],
  Moon: ['Sun', 'Mercury'],
  Mars: ['Sun', 'Moon', 'Jupiter'],
  Mercury: ['Sun', 'Venus'],
  Jupiter: ['Sun', 'Moon', 'Mars'],
  Venus: ['Mercury', 'Saturn'],
  Saturn: ['Mercury', 'Venus'],
};
const GRAHA_ENEMIES: Record<Graha, Graha[]> = {
  Sun: ['Venus', 'Saturn'],
  Moon: [],
  Mars: ['Mercury'],
  Mercury: ['Moon'],
  Jupiter: ['Mercury', 'Venus'],
  Venus: ['Sun', 'Moon'],
  Saturn: ['Sun', 'Moon', 'Mars'],
};

function grahaRelation(from: Graha, to: Graha): 'friend' | 'enemy' | 'neutral' {
  if (GRAHA_FRIENDS[from].includes(to)) return 'friend';
  if (GRAHA_ENEMIES[from].includes(to)) return 'enemy';
  return 'neutral';
}

function scoreGrahaMaitri(rashiA: RashiName, rashiB: RashiName): AshtakootaKootaResult {
  const lordA = RASHI_LORD[rashiA];
  const lordB = RASHI_LORD[rashiB];
  let score: number;
  if (lordA === lordB) {
    score = 5;
  } else {
    const ab = grahaRelation(lordA, lordB);
    const ba = grahaRelation(lordB, lordA);
    if (ab === 'friend' && ba === 'friend') score = 5;
    else if (ab === 'enemy' && ba === 'enemy') score = 0;
    else if (ab === 'enemy' || ba === 'enemy') score = 1;
    else if (ab === 'friend' || ba === 'friend') score = 4;
    else score = 3; // mutual neutral
  }
  return {
    name: 'Graha Maitri',
    score,
    maxScore: 5,
    explanation:
      'Natural planetary friendship between the two Moon-sign lords, using the classical mutual ' +
      'friend/neutral/enemy relationship (same lord = full marks; mutual enmity = zero).',
  };
}

// ---- 6. Gana (max 6) ----------------------------------------------------------
type Gana = 'Deva' | 'Manushya' | 'Rakshasa';

const NAKSHATRA_GANA: Record<NakshatraName, Gana> = {
  Ashwini: 'Deva', Mrigashira: 'Deva', Punarvasu: 'Deva', Pushya: 'Deva', Hasta: 'Deva',
  Swati: 'Deva', Anuradha: 'Deva', Shravana: 'Deva', Revati: 'Deva',
  Bharani: 'Manushya', Rohini: 'Manushya', Ardra: 'Manushya', 'Purva Phalguni': 'Manushya',
  'Uttara Phalguni': 'Manushya', 'Purva Ashadha': 'Manushya', 'Uttara Ashadha': 'Manushya',
  'Purva Bhadrapada': 'Manushya', 'Uttara Bhadrapada': 'Manushya',
  Krittika: 'Rakshasa', Ashlesha: 'Rakshasa', Magha: 'Rakshasa', Chitra: 'Rakshasa',
  Vishakha: 'Rakshasa', Jyeshtha: 'Rakshasa', Mula: 'Rakshasa', Dhanishta: 'Rakshasa',
  Shatabhisha: 'Rakshasa',
};

function scoreGana(nakA: NakshatraName, nakB: NakshatraName): AshtakootaKootaResult {
  const ga = NAKSHATRA_GANA[nakA];
  const gb = NAKSHATRA_GANA[nakB];
  let score: number;
  if (ga === gb) score = 6;
  else if ((ga === 'Deva' && gb === 'Manushya') || (ga === 'Manushya' && gb === 'Deva')) score = 5;
  else if ((ga === 'Deva' && gb === 'Rakshasa') || (ga === 'Rakshasa' && gb === 'Deva')) score = 1;
  else score = 0; // Manushya / Rakshasa
  return {
    name: 'Gana',
    score,
    maxScore: 6,
    explanation:
      'Temperament group by birth nakṣatra (Deva/divine, Manushya/human, Rakshasa/demonic). ' +
      'Same group scores full; this table is symmetric (some texts score Deva↔Rakshasa and the ' +
      'reverse direction slightly differently).',
  };
}

// ---- 7. Bhakoot (max 7) --------------------------------------------------------
function scoreBhakoot(rashiAIdx: number, rashiBIdx: number): AshtakootaKootaResult {
  const countAB = ((rashiBIdx - rashiAIdx + 12) % 12) + 1;
  const countBA = ((rashiAIdx - rashiBIdx + 12) % 12) + 1;
  const dosha =
    [6, 8].includes(countAB) || [6, 8].includes(countBA) ||
    [5, 9].includes(countAB) || [5, 9].includes(countBA);
  return {
    name: 'Bhakoot',
    score: dosha ? 0 : 7,
    maxScore: 7,
    explanation:
      'Moon-sign distance compatibility. Zero when the signs are 6th/8th (Shadashtaka) or ' +
      '5th/9th (Navapancham) from each other in either direction — both are classical Bhakoot ' +
      'doṣa positions; full marks otherwise.',
  };
}

// ---- 8. Nadi (max 8) -------------------------------------------------------------
type Nadi = 'Aadi' | 'Madhya' | 'Antya';

const NAKSHATRA_NADI: Record<NakshatraName, Nadi> = {
  Ashwini: 'Aadi', Ardra: 'Aadi', Punarvasu: 'Aadi', 'Uttara Phalguni': 'Aadi', Hasta: 'Aadi',
  Jyeshtha: 'Aadi', Mula: 'Aadi', Shatabhisha: 'Aadi', 'Purva Bhadrapada': 'Aadi',
  Bharani: 'Madhya', Mrigashira: 'Madhya', Pushya: 'Madhya', 'Purva Phalguni': 'Madhya',
  Chitra: 'Madhya', Anuradha: 'Madhya', 'Purva Ashadha': 'Madhya', Dhanishta: 'Madhya',
  'Uttara Bhadrapada': 'Madhya',
  Krittika: 'Antya', Rohini: 'Antya', Ashlesha: 'Antya', Magha: 'Antya', Swati: 'Antya',
  Vishakha: 'Antya', 'Uttara Ashadha': 'Antya', Shravana: 'Antya', Revati: 'Antya',
};

function scoreNadi(nakA: NakshatraName, nakB: NakshatraName): AshtakootaKootaResult {
  const sameNadi = NAKSHATRA_NADI[nakA] === NAKSHATRA_NADI[nakB];
  return {
    name: 'Nadi',
    score: sameNadi ? 0 : 8,
    maxScore: 8,
    explanation:
      'Constitutional/health-lineage compatibility by birth nakṣatra (Aadi/Madhya/Antya). Same ' +
      'nadi is classical Nadi doṣa (most heavily weighted koota) and scores zero; otherwise full marks.',
  };
}

/**
 * Classical Aṣṭakūṭa (8-koota) guṇa matching, out of 36. Requires a resolvable canonical
 * nakṣatra name (one of the 27) and Moon-sign name (one of the 12 whole signs) for both
 * profiles — throws `MatchProfileError` if either cannot be resolved, rather than guessing.
 */
export function compareAshtakootaCompatibility(
  profileA: RawCompatibilityProfile,
  profileB: RawCompatibilityProfile,
): AshtakootaCompatibilityResult {
  const a = normalizeProfileStrict(profileA);
  const b = normalizeProfileStrict(profileB);

  const nakAIdx = nakshatraIndex(a.nakshatra);
  const nakBIdx = nakshatraIndex(b.nakshatra);
  const rashiAIdx = rashiIndex(a.moonSign);
  const rashiBIdx = rashiIndex(b.moonSign);

  if (nakAIdx < 0 || nakBIdx < 0) {
    throw new MatchProfileError(
      'Aṣṭakūṭa matching requires a canonical nakṣatra name (one of the 27) for both profiles.',
      'MATCH_ASHTAKOOTA_INVALID_NAKSHATRA',
    );
  }
  if (rashiAIdx < 0 || rashiBIdx < 0) {
    throw new MatchProfileError(
      'Aṣṭakūṭa matching requires a canonical Moon-sign name (one of the 12 whole signs) for both profiles.',
      'MATCH_ASHTAKOOTA_INVALID_RASHI',
    );
  }

  const rashiA = a.moonSign.trim() as RashiName;
  const rashiB = b.moonSign.trim() as RashiName;
  const nakA = a.nakshatra.trim() as NakshatraName;
  const nakB = b.nakshatra.trim() as NakshatraName;

  const kootas: AshtakootaKootaResult[] = [
    scoreVarna(rashiA, rashiB),
    scoreVashya(rashiA, rashiB),
    scoreTara(nakAIdx, nakBIdx),
    scoreYoni(nakA, nakB),
    scoreGrahaMaitri(rashiA, rashiB),
    scoreGana(nakA, nakB),
    scoreBhakoot(rashiAIdx, rashiBIdx),
    scoreNadi(nakA, nakB),
  ];

  const totalScore = Number(kootas.reduce((sum, k) => sum + k.score, 0).toFixed(2));
  const maxScore = 36 as const;
  const percentage = Number(((totalScore / maxScore) * 100).toFixed(1));

  const doshaNotes: string[] = [];
  const nadiKoota = kootas.find((k) => k.name === 'Nadi')!;
  if (nadiKoota.score === 0) {
    doshaNotes.push(
      'Nadi doṣa present (same nadi group) — classically considered a significant caution; many ' +
        'traditions look for remedial/exception rules before proceeding.',
    );
  }
  const bhakootKoota = kootas.find((k) => k.name === 'Bhakoot')!;
  if (bhakootKoota.score === 0) {
    doshaNotes.push(
      'Bhakoot doṣa present (Moon signs in a 6th/8th or 5th/9th relationship) — classically ' +
        'associated with relationship/financial strain caution.',
    );
  }

  return {
    method: 'ashtakoota',
    totalScore,
    maxScore,
    percentage,
    kootas,
    warnings: [
      'Regional and lineage variations of Aṣṭakūṭa rules exist; this is one documented, ' +
        'deterministic application, not the single authoritative standard.',
      'Vashya uses a whole-sign simplification (Dhanu/Makara are classically split by degree ' +
        'across two groups; this implementation assigns each fully to one group).',
      'Yoni uses a simplified same/enemy/neutral scoring rather than the full graded 14×14 ' +
        'matrix some traditions use for non-enemy, non-identical pairs.',
      'This score is not combined with `compareHeuristicCompatibility` — the two methods are ' +
        'independent and must not be averaged together unless explicitly requested.',
    ],
    doshaNotes,
    accuracy: {
      tier: 'classical-rule',
      degraded: false,
      notes: [
        'Each koota applies a documented classical Vedic rule deterministically from the ' +
          'supplied nakṣatra/Moon-sign names — this is not an astronomical measurement and not ' +
          'a product/heuristic score.',
      ],
    },
  };
}
