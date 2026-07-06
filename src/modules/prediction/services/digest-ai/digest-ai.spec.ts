import type { MonthlyDigest, WeeklyDigest } from '@subatime/jyotisha-engine';
import { GeminiService } from '../../../ai/services/gemini.service';
import { buildFocusHash } from './digest-ai.hash';
import { mergeMonthlyAiContent, mergeWeeklyAiContent } from './digest-ai.merge';
import { DigestAiService } from './digest-ai.service';
import type { MonthlyFactPack, WeeklyFactPack } from './digest-ai.types';
import {
  extractJsonObject,
  validateMonthlyAiContent,
  validateWeeklyAiContent,
} from './digest-ai.validation';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function weeklyBase(): WeeklyDigest {
  return {
    version: 1,
    weekStart: '2026-07-06',
    weekEnd: '2026-07-12',
    dominantTheme: 'education',
    bestDay: { date: '2026-07-08', reason: 'ENGINE best reason' },
    cautionDay: { date: '2026-07-10', reason: 'ENGINE caution reason' },
    focusHighlight: { theme: 'education', line: 'ENGINE focus', lineSi: 'ENGINE focus si' },
    action: 'ENGINE action',
    actionSi: 'ENGINE action si',
    title: 'ENGINE title',
    titleSi: 'ENGINE title si',
    body: 'ENGINE body',
    bodySi: 'ENGINE body si',
    audit: {
      themeTotals: { education: 1 },
      chartTheme: 'education',
      focusBoostApplied: false,
      reasons: ['Week transits activate education houses.'],
    },
  };
}

function monthlyBase(): MonthlyDigest {
  return {
    version: 1,
    monthStart: '2026-07-01',
    dominantTheme: 'education',
    standoutDates: [
      { date: '2026-07-08', reason: 'ENGINE standout' },
      { date: '2026-07-16', reason: 'ENGINE standout' },
    ],
    bestPeriod: { start: '2026-07-08', end: '2026-07-14' },
    cautionPeriod: { start: '2026-07-21', end: '2026-07-25' },
    mostActivatedArea: 'education',
    action: 'ENGINE action',
    actionSi: 'ENGINE action si',
    title: 'ENGINE title',
    titleSi: 'ENGINE title si',
    body: 'ENGINE body',
    bodySi: 'ENGINE body si',
    audit: { themeTotals: { education: 1 }, chartTheme: 'education', focusBoostApplied: false, reasons: [] },
  };
}

const WEEK_DATES = [
  '2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09',
  '2026-07-10', '2026-07-11', '2026-07-12',
];

function weeklyPack(lang: 'en' | 'si' = 'en'): WeeklyFactPack {
  const b = weeklyBase();
  return {
    lang,
    tones: ['practical'],
    focusAreas: ['education'],
    profile: { lagna: 'Dhanu' },
    dominantTheme: b.dominantTheme,
    weekStart: b.weekStart,
    weekEnd: b.weekEnd,
    bestDay: { date: b.bestDay.date, theme: b.dominantTheme },
    cautionDay: { date: b.cautionDay.date },
    reasons: b.audit.reasons,
    days: WEEK_DATES.map((date, i) => ({
      date,
      theme: 'education' as const,
      rating: i === 2 ? 'good' : i === 4 ? 'caution' : 'mixed',
    })),
  };
}

interface DayCopy {
  date: string;
  headline: string;
  summary: string;
  do: string;
  avoid: string;
  notification: string;
}

/** A valid 7-day array matching WEEK_DATES, for the days[] field of weekly AI output. */
function validDays(): DayCopy[] {
  return WEEK_DATES.map((date) => ({
    date,
    headline: 'A calm day for focused study',
    summary: 'Use the day for steady learning and planning. Keep major decisions light and unhurried.',
    do: 'Finish one meaningful study task.',
    avoid: 'Avoid rushing important choices today.',
    notification: 'Your best focus window is coming up soon.',
  }));
}

function monthlyPack(lang: 'en' | 'si' = 'en'): MonthlyFactPack {
  const b = monthlyBase();
  return {
    lang,
    tones: ['practical'],
    focusAreas: ['education'],
    profile: { lagna: 'Dhanu' },
    dominantTheme: b.dominantTheme,
    monthStart: b.monthStart,
    bestPeriod: b.bestPeriod,
    cautionPeriod: b.cautionPeriod,
    standoutDates: b.standoutDates.map((d) => d.date),
    reasons: b.audit.reasons,
  };
}

const VALID_WEEKLY_JSON = JSON.stringify({
  title: 'A week for focused study',
  body: 'This week supports learning and steady planning. Keep major decisions light and move at a calm pace.',
  action: 'Complete one important study task each day.',
  bestDayReason: 'Best support for focused, uninterrupted learning.',
  cautionDayReason: 'Keep it gentle and avoid rushing choices.',
  focusLine: 'Education is well supported this week.',
  days: validDays(),
});

const VALID_MONTHLY_JSON = JSON.stringify({
  title: 'Education and long-term planning',
  body: 'This month supports study, structure, and slow steady progress. Keep big choices light near the caution period.',
  action: 'Keep your month structured and plan in weekly blocks.',
  standoutReason: 'Strong, clear energy for focused progress.',
});

function fakeGemini(replies: Array<string | Error>): { svc: GeminiService; calls: () => number } {
  let i = 0;
  const generateContent = jest.fn((): Promise<string> => {
    const r = replies[Math.min(i, replies.length - 1)];
    i += 1;
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  });
  const svc = {
    isConfigured: () => replies.length > 0,
    generateContent,
  } as unknown as GeminiService;
  return { svc, calls: () => generateContent.mock.calls.length };
}

// ── Validation ─────────────────────────────────────────────────────────────

describe('digest-ai validation', () => {
  it('accepts well-formed weekly JSON', () => {
    const r = validateWeeklyAiContent(VALID_WEEKLY_JSON, WEEK_DATES);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.title).toBe('A week for focused study');
      expect(r.value.days).toHaveLength(7);
      expect(r.value.days[0].date).toBe('2026-07-06');
    }
  });

  it('extracts JSON out of a ```json fenced block', () => {
    const fenced = '```json\n' + VALID_WEEKLY_JSON + '\n```';
    expect(extractJsonObject(fenced)).not.toBeNull();
    expect(validateWeeklyAiContent(fenced, WEEK_DATES).ok).toBe(true);
  });

  it('rejects non-JSON', () => {
    const r = validateWeeklyAiContent('Sorry, I cannot do that.', WEEK_DATES);
    expect(r.ok).toBe(false);
  });

  it('rejects a missing required field', () => {
    const bad = JSON.stringify({ title: 'x', body: 'y', action: 'z', bestDayReason: 'a', days: validDays() }); // no cautionDayReason
    expect(validateWeeklyAiContent(bad, WEEK_DATES).ok).toBe(false);
  });

  it('rejects over-length body', () => {
    const longBody = Array.from({ length: 60 }, () => 'word').join(' ');
    const bad = JSON.stringify({
      title: 'ok', body: longBody, action: 'ok', bestDayReason: 'ok', cautionDayReason: 'ok', days: validDays(),
    });
    const r = validateWeeklyAiContent(bad, WEEK_DATES);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('body');
  });

  it('rejects unsafe wording (fear/guarantee)', () => {
    const bad = JSON.stringify({
      title: 'Warning', body: 'You will definitely lose money this week.', action: 'ok',
      bestDayReason: 'ok', cautionDayReason: 'ok', days: validDays(),
    });
    const r = validateWeeklyAiContent(bad, WEEK_DATES);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('unsafe');
  });

  it('rejects a days[] with the wrong length', () => {
    const bad = JSON.stringify({
      title: 'ok', body: 'ok', action: 'ok', bestDayReason: 'ok', cautionDayReason: 'ok',
      days: validDays().slice(0, 6),
    });
    const r = validateWeeklyAiContent(bad, WEEK_DATES);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('days length');
  });

  it('rejects a days[] entry whose date does not match the engine dates', () => {
    const shifted = validDays().map((d, i) =>
      i === 3 ? { ...d, date: '2099-01-01' } : d,
    );
    const bad = JSON.stringify({
      title: 'ok', body: 'ok', action: 'ok', bestDayReason: 'ok', cautionDayReason: 'ok', days: shifted,
    });
    const r = validateWeeklyAiContent(bad, WEEK_DATES);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('date');
  });

  it('rejects an over-length per-day notification', () => {
    const longNote = Array.from({ length: 30 }, () => 'ping').join(' ');
    const days = validDays().map((d) => ({ ...d, notification: longNote }));
    const bad = JSON.stringify({
      title: 'ok', body: 'ok', action: 'ok', bestDayReason: 'ok', cautionDayReason: 'ok', days,
    });
    const r = validateWeeklyAiContent(bad, WEEK_DATES);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('notification');
  });

  it('accepts Sinhala output (schema + length, not phrase-matched)', () => {
    const si = JSON.stringify({
      title: 'ඉගෙනීමට හොඳ සතියක්',
      body: 'මේ සතිය ඉගෙනීමට සහ සැලසුම් කිරීමට සහාය දෙයි. විශාල තීරණ සැහැල්ලුව තබන්න.',
      action: 'දිනකට එක් වැදගත් වැඩක් සම්පූර්ණ කරන්න.',
      bestDayReason: 'ඉගෙනීමට හොඳම දිනයයි.',
      cautionDayReason: 'ඉක්මන් තීරණ වළක්වන්න.',
      days: WEEK_DATES.map((date) => ({
        date,
        headline: 'අද ඉගෙනීමට හොඳයි',
        summary: 'අද දිනය ඉගෙනීමට සහ සැලසුම් කිරීමට යොදාගන්න.',
        do: 'එක් වැදගත් වැඩක් අවසන් කරන්න.',
        avoid: 'ඉක්මන් තීරණ වළක්වන්න.',
        notification: 'ඔබේ හොඳම වේලාව ළඟදීම.',
      })),
    });
    expect(validateWeeklyAiContent(si, WEEK_DATES).ok).toBe(true);
  });

  it('accepts well-formed monthly JSON', () => {
    expect(validateMonthlyAiContent(VALID_MONTHLY_JSON).ok).toBe(true);
  });
});

// ── Merge (facts preserved, wording overlaid) ────────────────────────────────

describe('digest-ai merge', () => {
  it('overlays English wording but keeps all engine facts', () => {
    const base = weeklyBase();
    const merged = mergeWeeklyAiContent(base, {
      title: 'AI title', body: 'AI body', action: 'AI action',
      bestDayReason: 'AI best', cautionDayReason: 'AI caution', focusLine: 'AI focus', days: [],
    }, 'en');

    // Wording replaced.
    expect(merged.title).toBe('AI title');
    expect(merged.body).toBe('AI body');
    expect(merged.bestDay.reason).toBe('AI best');
    expect(merged.focusHighlight!.line).toBe('AI focus');
    // Facts untouched.
    expect(merged.weekStart).toBe(base.weekStart);
    expect(merged.dominantTheme).toBe('education');
    expect(merged.bestDay.date).toBe('2026-07-08');
    expect(merged.audit).toEqual(base.audit);
    // Other-locale copy untouched.
    expect(merged.titleSi).toBe('ENGINE title si');
  });

  it('overlays Sinhala fields for si locale, leaving English deterministic', () => {
    const base = weeklyBase();
    const merged = mergeWeeklyAiContent(base, {
      title: 'සිංහල මාතෘකාව', body: 'සිංහල', action: 'ක්‍රියාව',
      bestDayReason: 'හොඳ', cautionDayReason: 'පරිස්සම්', focusLine: 'අවධානය', days: [],
    }, 'si');
    expect(merged.titleSi).toBe('සිංහල මාතෘකාව');
    expect(merged.title).toBe('ENGINE title'); // English untouched
    expect(merged.focusHighlight!.lineSi).toBe('අවධානය');
  });

  it('monthly overlay keeps periods + standout dates, replaces reasons', () => {
    const base = monthlyBase();
    const merged = mergeMonthlyAiContent(base, {
      title: 'AI', body: 'AI', action: 'AI', standoutReason: 'AI standout',
    }, 'en');
    expect(merged.title).toBe('AI');
    expect(merged.bestPeriod).toEqual(base.bestPeriod);
    expect(merged.standoutDates.map((d) => d.date)).toEqual(['2026-07-08', '2026-07-16']);
    expect(merged.standoutDates.every((d) => d.reason === 'AI standout')).toBe(true);
  });
});

// ── Service orchestration (AI-first + fallback) ──────────────────────────────

describe('DigestAiService', () => {
  it('missing Gemini key → template fallback, no call made', async () => {
    const { svc, calls } = fakeGemini([]); // isConfigured() → false
    const service = new DigestAiService(svc);
    const out = await service.enrichWeekly(weeklyBase(), weeklyPack(), 'en');
    expect(out.provider).toBe('template');
    expect(out.status).toBe('fallback');
    expect(out.digest.title).toBe('ENGINE title'); // unchanged
    expect(out.dailyContent).toEqual([]); // no per-day copy on fallback
    expect(calls()).toBe(0);
  });

  it('valid Gemini JSON → merged AI content + 7 daily entries, one call', async () => {
    const { svc, calls } = fakeGemini([VALID_WEEKLY_JSON]);
    const service = new DigestAiService(svc);
    const out = await service.enrichWeekly(weeklyBase(), weeklyPack(), 'en');
    expect(out.provider).toBe('gemini');
    expect(out.status).toBe('generated');
    expect(out.digest.title).toBe('A week for focused study');
    expect(out.digest.dominantTheme).toBe('education'); // fact preserved
    expect(out.dailyContent).toHaveLength(7);
    expect(out.dailyContent[0].date).toBe('2026-07-06');
    expect(out.dailyContent[0].headline.length).toBeGreaterThan(0);
    expect(out.dailyContent[0].notification.length).toBeGreaterThan(0);
    expect(calls()).toBe(1);
  });

  it('invalid JSON twice → template fallback after exactly one retry', async () => {
    const { svc, calls } = fakeGemini(['not json', 'still not json']);
    const service = new DigestAiService(svc);
    const out = await service.enrichWeekly(weeklyBase(), weeklyPack(), 'en');
    expect(out.provider).toBe('template');
    expect(out.status).toBe('failed');
    expect(out.digest.body).toBe('ENGINE body');
    expect(calls()).toBe(2); // retried once, no more
  });

  it('invalid then valid → generated on the retry', async () => {
    const { svc, calls } = fakeGemini(['garbage', VALID_WEEKLY_JSON]);
    const service = new DigestAiService(svc);
    const out = await service.enrichWeekly(weeklyBase(), weeklyPack(), 'en');
    expect(out.provider).toBe('gemini');
    expect(calls()).toBe(2);
  });

  it('Gemini throwing is caught → template fallback, never throws', async () => {
    const { svc } = fakeGemini([new Error('429 quota'), new Error('429 quota')]);
    const service = new DigestAiService(svc);
    const out = await service.enrichWeekly(weeklyBase(), weeklyPack(), 'en');
    expect(out.provider).toBe('template');
    expect(out.status).toBe('failed');
  });

  it('unsafe AI wording is rejected → template fallback', async () => {
    const unsafe = JSON.stringify({
      title: 'ok', body: 'You will definitely fail this week.', action: 'ok',
      bestDayReason: 'ok', cautionDayReason: 'ok',
    });
    const { svc } = fakeGemini([unsafe, unsafe]);
    const service = new DigestAiService(svc);
    const out = await service.enrichWeekly(weeklyBase(), weeklyPack(), 'en');
    expect(out.provider).toBe('template');
  });

  it('monthly enrich merges valid content', async () => {
    const { svc } = fakeGemini([VALID_MONTHLY_JSON]);
    const service = new DigestAiService(svc);
    const out = await service.enrichMonthly(monthlyBase(), monthlyPack(), 'en');
    expect(out.provider).toBe('gemini');
    expect(out.digest.title).toBe('Education and long-term planning');
    expect(out.digest.bestPeriod).toEqual(monthlyBase().bestPeriod);
  });
});

// ── Hashes (regeneration triggers) ───────────────────────────────────────────

describe('digest-ai focus hash', () => {
  it('is stable regardless of order', () => {
    const a = buildFocusHash({ focusAreas: ['career', 'money'], tones: ['practical'], locale: 'en' });
    const b = buildFocusHash({ focusAreas: ['money', 'career'], tones: ['practical'], locale: 'en' });
    expect(a).toBe(b);
  });

  it('changes when focus, tone, or language changes', () => {
    const base = buildFocusHash({ focusAreas: ['career'], tones: ['practical'], locale: 'en' });
    expect(buildFocusHash({ focusAreas: ['money'], tones: ['practical'], locale: 'en' })).not.toBe(base);
    expect(buildFocusHash({ focusAreas: ['career'], tones: ['spiritual'], locale: 'en' })).not.toBe(base);
    expect(buildFocusHash({ focusAreas: ['career'], tones: ['practical'], locale: 'si' })).not.toBe(base);
  });
});
