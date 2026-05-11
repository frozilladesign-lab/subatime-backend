import { stableStringify, translationCacheKey } from './translation-cache-key';

describe('translation-cache-key', () => {
  it('stableStringify sorts object keys', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });

  it('translationCacheKey is stable for same logical payload', () => {
    const body = { signal: { date: '2026-05-09', rating: 'good' }, content: { guidance: 'Hi' } };
    const k1 = translationCacheKey({
      operation: 'daily_sinhala_v1',
      geminiModel: 'gemini-flash-latest',
      englishPayload: body,
    });
    const k2 = translationCacheKey({
      operation: 'daily_sinhala_v1',
      geminiModel: 'gemini-flash-latest',
      englishPayload: {
        content: { guidance: 'Hi' },
        signal: { rating: 'good', date: '2026-05-09' },
      },
    });
    expect(k1).toBe(k2);
    expect(k1).toHaveLength(64);
    expect(k1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('sha256Hex differs when model changes', () => {
    const body = { x: 1 };
    const k1 = translationCacheKey({
      operation: 'daily_sinhala_v1',
      geminiModel: 'm-a',
      englishPayload: body,
    });
    const k2 = translationCacheKey({
      operation: 'daily_sinhala_v1',
      geminiModel: 'm-b',
      englishPayload: body,
    });
    expect(k1).not.toBe(k2);
  });

  it('feed row payload shares cache key when English content matches', () => {
    const row = {
      title: 't',
      preview: 'p',
      body: 'b',
      source: 's',
      dreamStateLabel: null,
      dreamInsight: null,
      dreamGrounding: null,
    };
    const model = 'gemini-flash-latest';
    const k = translationCacheKey({
      operation: 'feed_row_sinhala_v1',
      geminiModel: model,
      englishPayload: row,
    });
    const k2 = translationCacheKey({
      operation: 'feed_row_sinhala_v1',
      geminiModel: model,
      englishPayload: {
        dreamGrounding: null,
        dreamInsight: null,
        dreamStateLabel: null,
        body: 'b',
        preview: 'p',
        source: 's',
        title: 't',
      },
    });
    expect(k).toBe(k2);
  });
});
