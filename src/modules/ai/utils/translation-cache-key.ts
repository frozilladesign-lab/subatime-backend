import { createHash } from 'crypto';

/** Nest-sort JSON serialization so identical logical payloads produce identical strings. */
export function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'string') return JSON.stringify(value);
  if (t === 'number' || t === 'boolean') return JSON.stringify(value);
  if (t !== 'object') return JSON.stringify(String(value));

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  return `{${parts.join(',')}}`;
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Builds cache key for a translation operation + Gemini model + canonical English body. */
export function translationCacheKey(parts: {
  operation: string;
  geminiModel: string;
  englishPayload: unknown;
}): string {
  const envelope = {
    operation: parts.operation,
    model: parts.geminiModel.trim(),
    body: parts.englishPayload,
  };
  return sha256Hex(stableStringify(envelope));
}
