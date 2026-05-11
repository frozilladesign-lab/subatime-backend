/** Deterministic dream signal math — no LLM. Gemini supplies tags only. */

export type DreamExtractionPayload = {
  emotion: string;
  intensity: number;
  negativity: number;
  clarity: number;
  symbols: string[];
  themes: string[];
  pattern_hints: string[];
  summary_line: string;
  grounding_tip: string;
};

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Dream Stress Score (0–1): higher = more internal load suggested by dream signals.
 * DS = (0.4·E_neg) + (0.3·I_intensity) + (0.2·R_repeat) − (0.3·C_clarity)
 */
export function computeDreamStress(opts: {
  negativity: number;
  intensity: number;
  repetitionIndex: number;
  clarity: number;
}): number {
  const E = clamp01(opts.negativity);
  const I = clamp01(opts.intensity);
  const R = clamp01(opts.repetitionIndex);
  const C = clamp01(opts.clarity);
  return clamp01(0.4 * E + 0.3 * I + 0.2 * R - 0.3 * C);
}

export type DreamStressBand = 'stable' | 'mild' | 'elevated' | 'overload';

export function dreamStressBand(ds: number): DreamStressBand {
  if (ds < 0.25) return 'stable';
  if (ds < 0.5) return 'mild';
  if (ds < 0.75) return 'elevated';
  return 'overload';
}

export function dreamStressBandLabel(band: DreamStressBand, lang?: 'en' | 'si'): string {
  if (lang === 'si') {
    switch (band) {
      case 'stable':
        return 'සංතුලයි — මානසිකව පැහැදිලි';
      case 'mild':
        return 'මෘදු අසමතුලිතතාවක් — හැසිරවිය හැක';
      case 'elevated':
        return 'අභ්‍යන්තර ක්‍රියාකාරිත්වය වැඩියි — මෘදුව ගන්න';
      default:
        return 'බර පැටවුමක් — විවේකය සහ බිම හොල්ලීම ප්‍රමුඛ කරන්න';
    }
  }
  switch (band) {
    case 'stable':
      return 'Stable / clear inner tone';
    case 'mild':
      return 'Mild imbalance — manageable';
    case 'elevated':
      return 'High inner activity — take it gently';
    default:
      return 'Heavy load — prioritize rest and grounding';
  }
}

export function computeSymbolRepetition(
  symbols: string[],
  priorRows: Array<{ analysis?: unknown }>,
): number {
  const norm = (s: string) =>
    String(s)
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '');
  const cur = new Set(symbols.map((s) => norm(s)).filter(Boolean));
  if (!cur.size) return 0.25;

  let maxJ = 0;
  for (const row of priorRows) {
    const a = row.analysis as Record<string, unknown> | null | undefined;
    if (!a || typeof a !== 'object') continue;
    const ext = a.extraction as Record<string, unknown> | undefined;
    const syms = ext?.symbols;
    if (!Array.isArray(syms)) continue;
    const other = new Set(syms.map((x) => norm(String(x))).filter(Boolean));
    if (!other.size) continue;
    let inter = 0;
    for (const x of cur) {
      if (other.has(x)) inter++;
    }
    const uni = cur.size + other.size - inter;
    const j = uni <= 0 ? 0 : inter / uni;
    if (j > maxJ) maxJ = j;
  }
  return clamp01(maxJ);
}

export function heuristicDreamExtraction(text: string, lang: 'en' | 'si' = 'en'): DreamExtractionPayload {
  const lower = text.toLowerCase();
  const symbols: string[] = [];
  let negativity = 0.35;
  let intensity = 0.45;
  let clarity = 0.55;

  const pushSym = (s: string) => {
    if (!symbols.includes(s)) symbols.push(s);
  };

  if (/chase|chasing|attacked|afraid|fear|scared|terror/.test(lower)) {
    negativity += 0.22;
    intensity += 0.12;
    pushSym('threat');
  }
  if (/falling|fall from/.test(lower)) {
    negativity += 0.12;
    pushSym('loss_of_control');
  }
  if (/exam|test\b|deadline/.test(lower)) {
    negativity += 0.15;
    pushSym('performance_pressure');
  }
  if (/water|ocean|river|flood|rain|swimming/.test(lower)) pushSym('water');
  if (/fly|flying|sky/.test(lower)) pushSym('perspective_shift');
  if (/lost|search|cannot find|can't find|no exit|trapped/.test(lower)) {
    negativity += 0.12;
    pushSym('constraint');
  }
  if (/dark|shadow/.test(lower)) {
    negativity += 0.08;
    pushSym('shadow');
  }
  if (/dead|funeral|cemetery/.test(lower)) pushSym('memory_processing');

  const themes: string[] = [];
  if (symbols.includes('water')) {
    themes.push(lang === 'si' ? 'හැගීම් ප්‍රවාහය' : 'Emotional flow');
  }
  if (symbols.includes('perspective_shift')) {
    themes.push(lang === 'si' ? 'දෘෂ්ටිකෝණයේ සැලෙවීමක්' : 'Perspective shift');
  }
  if (symbols.includes('constraint')) {
    themes.push(lang === 'si' ? 'හිර වී සෙවීම වගේ හැඟීම්' : 'Feeling stuck or searching');
  }
  if (symbols.includes('threat')) {
    themes.push(lang === 'si' ? 'උත්තේජනය / අනතුරු ඇඟවීම' : 'Activation / vigilance');
  }
  if (!themes.length) {
    themes.push(lang === 'si' ? 'උප සිහියේ සැකසීම' : 'Subconscious processing');
  }

  return {
    emotion: negativity > 0.55 ? (lang === 'si' ? 'දැඩි ආතතිය' : 'distressed') : lang === 'si' ? 'මිශ්‍ර' : 'mixed',
    intensity: clamp01(intensity),
    negativity: clamp01(negativity),
    clarity: clamp01(clarity),
    symbols,
    themes,
    pattern_hints: symbols.slice(0, 8),
    summary_line:
      lang === 'si'
        ? 'මෙම සටහන සංකේතාත්මක දේ ගෙන එයි — නිශ්චිත අර්ථ නොව, පරාවර්තනයට මගපෙන්වීම් ලෙස භාවිතා කරන්න.'
        : 'Your entry surfaces symbolic material—use themes as prompts for reflection, not fixed meanings.',
    grounding_tip:
      lang === 'si'
        ? 'අද දැඩි සංවාද වලට පෙර මන්දගාමී හුස්ම පහක් ගෙන ඔබට පාලනය කළ හැකි කුඩා පියවරක් නම් කරන්න.'
        : 'Before any intense conversations today, try five slow breaths and name one small step you control.',
  };
}

export function astroCodesForDream(
  ext: DreamExtractionPayload,
  lang?: 'en' | 'si',
): Array<{ symbol: string; meaning: string }> {
  const codes: Array<{ symbol: string; meaning: string }> = [];
  const blob = [...ext.symbols, ...ext.pattern_hints].join(' ');
  if (/water|flood|ocean|rain|river/i.test(blob)) {
    codes.push({
      symbol: '☾',
      meaning:
        lang === 'si'
          ? 'සඳේ චලන හැගීම් සහ සංකේත සිහින සමඟ බොහෝ විට ගැලපෙයි.'
          : 'Lunar rhythms often track with vivid emotional-symbolic dreaming.',
    });
  }
  if (/threat|chase|anxiety|fear|attack/i.test(blob)) {
    codes.push({
      symbol: '♂',
      meaning:
        lang === 'si'
          ? 'උත්තේජක පින්තූර බොහෝ විට ආතතිය මැන බැලීමකි — අනාගත කියමනක් නොවේ.'
          : 'High-arousal imagery usually tracks stress load—not a forecast.',
    });
  }
  if (/memory|dead|shadow|grave|funeral/i.test(blob)) {
    codes.push({
      symbol: '♄',
      meaning:
        lang === 'si'
          ? 'බර පින්තූර මතක සැකසීමේදී මනස පැරණි දේ වර්ග කරන විට පෙනී සිටිය හැක.'
          : 'Heavy imagery can appear while the mind sorts older material.',
    });
  }
  const defaults =
    lang === 'si'
      ? [
          { symbol: '☾', meaning: 'සඳ ගමන් සංකේත සිහින පුනරාවර්තනය වැඩි කරයි.' },
          { symbol: '♆', meaning: 'නෙප්ටියුන් ලකුණු මතක් කිරීමේ හැගීම් ගැඹුරු කරයි.' },
          { symbol: '♅', meaning: 'හදිසි සිහින මාරු මානසික හැරවුම් පෙන්විය හැක — නිවේදන නොවේ.' },
        ]
      : [
          { symbol: '☾', meaning: 'Moon transits amplify symbolic dream content.' },
          { symbol: '♆', meaning: 'Neptune signatures deepen emotional resonance in recall.' },
          { symbol: '♅', meaning: 'Sudden dream shifts can mirror mental pivots—not predictions.' },
        ];
  for (const d of defaults) {
    if (codes.length >= 3) break;
    if (!codes.some((c) => c.symbol === d.symbol)) codes.push(d);
  }
  return codes.slice(0, 3);
}
