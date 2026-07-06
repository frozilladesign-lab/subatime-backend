import type { MonthlyFactPack, WeeklyFactPack } from './digest-ai.types';

/** A system + user message pair for a single Gemini call. */
export interface DigestPrompt {
  system: string;
  user: string;
}

const LANGUAGE_NAME: Record<string, string> = { en: 'English', si: 'Sinhala (සිංහල)' };

/**
 * Shared guardrails for every digest generation. Kept short to save tokens — the compact fact
 * pack, not prose, carries the astrology.
 */
function baseRules(lang: string): string[] {
  const languageName = LANGUAGE_NAME[lang] ?? 'English';
  return [
    'You write short, warm, practical astrology guidance for a personal almanac app.',
    'The JSON facts you are given are AUTHORITATIVE. Never invent signs, dates, houses, or planets.',
    `Write ALL output in ${languageName}. Do not mix languages.`,
    'Return ONLY a single strict JSON object. No markdown, no code fences, no commentary.',
    'Safety: never predict certainty of failure, wealth, illness, death, or disaster.',
    'Never say "you will definitely", "bad luck", "you will fail", or give medical/legal/financial guarantees.',
    'Prefer supportive framing: "supports steady progress", "keep major decisions light", "good for planning".',
  ];
}

/** Weekly prompt: Gemini rewrites the wording for the engine-selected week facts. */
export function buildWeeklyDigestPrompt(pack: WeeklyFactPack): DigestPrompt {
  const system = [
    ...baseRules(pack.lang),
    'Weekly output schema (all string values, no extra keys):',
    '{"title": string, "body": string, "action": string, "bestDayReason": string, "cautionDayReason": string, "focusLine": string,',
    ' "days": [{"date": string, "headline": string, "summary": string, "do": string, "avoid": string, "notification": string}]}',
    'Return EXACTLY one "days" entry per day in the facts, using the SAME dates in the SAME order.',
    'Do not add, drop, reorder, or invent dates — copy each "date" verbatim from the facts.',
    'Shape each day\'s copy around that day\'s theme and rating (good = encouraging, caution = gentle, mixed = balanced).',
    'Length limits (strict): title <= 12 words, body <= 35 words, action <= 20 words,',
    'bestDayReason <= 20 words, cautionDayReason <= 20 words, focusLine <= 20 words.',
    'Per day: headline <= 12 words, summary <= 35 words, do <= 20 words, avoid <= 20 words, notification <= 18 words.',
    'focusLine may be an empty string if there is no focus area.',
  ].join('\n');

  const user = [
    'Write this week\'s guidance from these facts. Keep the dominant theme, best day, caution day, and every day\'s date exactly as given.',
    JSON.stringify(pack),
  ].join('\n');

  return { system, user };
}

/** Monthly prompt: a small overview, not 30 daily entries. */
export function buildMonthlyDigestPrompt(pack: MonthlyFactPack): DigestPrompt {
  const system = [
    ...baseRules(pack.lang),
    'Monthly output schema (all string values, no extra keys):',
    '{"title": string, "body": string, "action": string, "standoutReason": string}',
    'Length limits (strict): title <= 12 words, body <= 35 words, action <= 20 words, standoutReason <= 20 words.',
    'Give one overview for the whole month — do NOT list every day.',
  ].join('\n');

  const user = [
    'Write this month\'s overview from these facts. Keep the dominant theme, periods and standout dates exactly as given.',
    JSON.stringify(pack),
  ].join('\n');

  return { system, user };
}
