/** Short-lived in-process cache for finalized `/plan/day` JSON (esp. Sinhala merge). */
const TTL_MS = 5 * 60 * 1000;

const store = new Map<string, { expiresAt: number; payload: Record<string, unknown> }>();

function key(userId: string, dateIso: string, lang: string): string {
  return `${userId}|${dateIso}|${lang.toLowerCase()}`;
}

export function getCachedPlanDayPayload(
  userId: string,
  dateIso: string,
  lang: string,
): Record<string, unknown> | null {
  const hit = store.get(key(userId, dateIso, lang));
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    store.delete(key(userId, dateIso, lang));
    return null;
  }
  return hit.payload;
}

export function setCachedPlanDayPayload(
  userId: string,
  dateIso: string,
  lang: string,
  payload: Record<string, unknown>,
): void {
  store.set(key(userId, dateIso, lang), {
    expiresAt: Date.now() + TTL_MS,
    payload,
  });
}

export function invalidatePlanDayPayloadCache(userId: string, dateIso?: string): void {
  const prefix = dateIso ? `${userId}|${dateIso}|` : `${userId}|`;
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) store.delete(k);
  }
}
