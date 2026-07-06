import type {
  MonthlyAiContent,
  MonthlyValidationResult,
  WeeklyAiContent,
  WeeklyDayAiContent,
  WeeklyValidationResult,
} from './digest-ai.types';

/**
 * Phrases that make an astrology prediction unsafe (over-certain, fear-based, or an implied
 * medical/legal/financial guarantee). Checked case-insensitively against English output. Sinhala
 * output is guarded structurally (schema + length) plus the model's system-prompt rules; we do
 * not attempt Sinhala phrase matching here.
 */
const FORBIDDEN_PATTERNS: RegExp[] = [
  /\byou will definitely\b/i,
  /\bbad luck\b/i,
  /\byou will fail\b/i,
  /\byou will get rich\b/i,
  /\bguarantee(d|s)?\b/i,
  /\byou must not travel\b/i,
  /\b(certain|sure) to (fail|die|lose)\b/i,
  /\bwill (die|fail|lose everything)\b/i,
];

const MAX_WORDS = {
  title: 12,
  body: 35,
  action: 20,
  bestDayReason: 20,
  cautionDayReason: 20,
  focusLine: 20,
  standoutReason: 20,
  headline: 12,
  summary: 35,
  do: 20,
  avoid: 20,
  notification: 18,
} as const;

function wordCount(s: string): number {
  const t = s.trim();
  return t.length === 0 ? 0 : t.split(/\s+/).length;
}

function firstUnsafe(s: string): string | null {
  for (const re of FORBIDDEN_PATTERNS) {
    if (re.test(s)) return re.source;
  }
  return null;
}

/**
 * Pull a JSON object out of a raw model response. Tolerates ```json fences and leading/trailing
 * prose, but requires a single well-formed object. Returns null on failure (caller falls back).
 */
export function extractJsonObject(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  let text = raw.trim();
  // Strip a fenced block if present.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  // Narrow to the outermost braces if there is surrounding prose.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const candidate = text.slice(start, end + 1);
  try {
    const parsed = JSON.parse(candidate) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function requireString(
  o: Record<string, unknown>,
  key: string,
  maxWords: number,
  { optional = false }: { optional?: boolean } = {},
): { ok: true; value: string } | { ok: false; reason: string } {
  const raw = o[key];
  if (raw === undefined || raw === null) {
    if (optional) return { ok: true, value: '' };
    return { ok: false, reason: `missing field: ${key}` };
  }
  if (typeof raw !== 'string') return { ok: false, reason: `field not a string: ${key}` };
  const value = raw.replace(/\s+/g, ' ').trim();
  if (value.length === 0 && !optional) return { ok: false, reason: `empty field: ${key}` };
  if (wordCount(value) > maxWords) return { ok: false, reason: `field too long: ${key}` };
  const unsafe = firstUnsafe(value);
  if (unsafe) return { ok: false, reason: `unsafe wording in ${key}: ${unsafe}` };
  return { ok: true, value };
}

/**
 * Validate the `days[]` array. The AI must return exactly one entry per expected date, in the
 * same order, with the date copied verbatim — this is what guarantees the AI never invents a
 * day or shifts copy onto the wrong date.
 */
function validateDays(
  raw: unknown,
  expectedDates: string[],
): { ok: true; value: WeeklyDayAiContent[] } | { ok: false; reason: string } {
  if (!Array.isArray(raw)) return { ok: false, reason: 'days is not an array' };
  if (raw.length !== expectedDates.length) {
    return { ok: false, reason: `days length ${raw.length} !== expected ${expectedDates.length}` };
  }
  const out: WeeklyDayAiContent[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry: unknown = raw[i];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, reason: `day[${i}] not an object` };
    }
    const o = entry as Record<string, unknown>;
    if (o.date !== expectedDates[i]) {
      return { ok: false, reason: `day[${i}] date ${String(o.date)} !== ${expectedDates[i]}` };
    }
    const headline = requireString(o, 'headline', MAX_WORDS.headline);
    if (!headline.ok) return { ok: false, reason: `day[${i}] ${headline.reason}` };
    const summary = requireString(o, 'summary', MAX_WORDS.summary);
    if (!summary.ok) return { ok: false, reason: `day[${i}] ${summary.reason}` };
    const doField = requireString(o, 'do', MAX_WORDS.do);
    if (!doField.ok) return { ok: false, reason: `day[${i}] ${doField.reason}` };
    const avoid = requireString(o, 'avoid', MAX_WORDS.avoid);
    if (!avoid.ok) return { ok: false, reason: `day[${i}] ${avoid.reason}` };
    const notification = requireString(o, 'notification', MAX_WORDS.notification);
    if (!notification.ok) return { ok: false, reason: `day[${i}] ${notification.reason}` };
    out.push({
      date: expectedDates[i],
      headline: headline.value,
      summary: summary.value,
      do: doField.value,
      avoid: avoid.value,
      notification: notification.value,
    });
  }
  return { ok: true, value: out };
}

/**
 * Validate a raw weekly Gemini response into strict `WeeklyAiContent`.
 * `expectedDates` are the engine-provided day dates the `days[]` array must match exactly.
 */
export function validateWeeklyAiContent(
  raw: string,
  expectedDates: string[],
): WeeklyValidationResult {
  const o = extractJsonObject(raw);
  if (!o) return { ok: false, reason: 'not valid JSON' };

  const title = requireString(o, 'title', MAX_WORDS.title);
  if (!title.ok) return title;
  const body = requireString(o, 'body', MAX_WORDS.body);
  if (!body.ok) return body;
  const action = requireString(o, 'action', MAX_WORDS.action);
  if (!action.ok) return action;
  const bestDayReason = requireString(o, 'bestDayReason', MAX_WORDS.bestDayReason);
  if (!bestDayReason.ok) return bestDayReason;
  const cautionDayReason = requireString(o, 'cautionDayReason', MAX_WORDS.cautionDayReason);
  if (!cautionDayReason.ok) return cautionDayReason;
  const focusLine = requireString(o, 'focusLine', MAX_WORDS.focusLine, { optional: true });
  if (!focusLine.ok) return focusLine;
  const days = validateDays(o.days, expectedDates);
  if (!days.ok) return days;

  const value: WeeklyAiContent = {
    title: title.value,
    body: body.value,
    action: action.value,
    bestDayReason: bestDayReason.value,
    cautionDayReason: cautionDayReason.value,
    ...(focusLine.value ? { focusLine: focusLine.value } : {}),
    days: days.value,
  };
  return { ok: true, value };
}

/** Validate a raw monthly Gemini response into strict `MonthlyAiContent`. */
export function validateMonthlyAiContent(raw: string): MonthlyValidationResult {
  const o = extractJsonObject(raw);
  if (!o) return { ok: false, reason: 'not valid JSON' };

  const title = requireString(o, 'title', MAX_WORDS.title);
  if (!title.ok) return title;
  const body = requireString(o, 'body', MAX_WORDS.body);
  if (!body.ok) return body;
  const action = requireString(o, 'action', MAX_WORDS.action);
  if (!action.ok) return action;
  const standoutReason = requireString(o, 'standoutReason', MAX_WORDS.standoutReason);
  if (!standoutReason.ok) return standoutReason;

  const value: MonthlyAiContent = {
    title: title.value,
    body: body.value,
    action: action.value,
    standoutReason: standoutReason.value,
  };
  return { ok: true, value };
}
