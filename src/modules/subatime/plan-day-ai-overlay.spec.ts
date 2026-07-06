import { SubatimeService } from './subatime.service';

/**
 * Daily activation overlay adapter (`applyDailyAiOverlay`): proves today's Guide payload takes
 * AI copy from the stored weekly pack when present, preserves ALL engine facts, keeps
 * notification TIMING engine-controlled (only copy is overlaid), and honors the locale guard.
 * The pack selection + fallback rules themselves are covered in digest.service.spec.
 */

// The overlay method is private; access it through the prototype without the heavy DI constructor.
type OverlayTestService = {
  digestService: { getWeeklyDailyOverlay: jest.Mock };
  applyDailyAiOverlay: (b: object, u: string, d: string, l: string) => Promise<void>;
};

function makeService(overlay: unknown): OverlayTestService {
  const svc = Object.create(SubatimeService.prototype) as OverlayTestService;
  svc.digestService = { getWeeklyDailyOverlay: jest.fn(() => Promise.resolve(overlay)) };
  return svc;
}

interface AiCopy {
  headline: string;
  summary: string;
  do: string;
  avoid: string;
  notification: string;
  locale: string;
}
interface AiOverlayAudit {
  dailyCopySource: string;
  reason: string | null;
  periodKey: string | null;
  aiProvider: string | null;
  contentStatus: string | null;
  promptVersion: string | null;
  chartHash: string | null;
  focusHash: string | null;
  locale: string | null;
}
type OverlaidPayload = ReturnType<typeof basePayload> & {
  aiCopy?: AiCopy;
  aiOverlayAudit?: AiOverlayAudit;
};

/** A plan-day payload with the engine facts that must survive the overlay untouched. */
function basePayload() {
  return {
    guidance: 'ENGINE deterministic guidance prose.',
    rating: 'good',
    userLagna: 'Dhanu',
    confidence: 0.81,
    bestWindowSlot: { labelKey: 'windows.morning', start: '10:30', end: '11:45' },
    cautionWindowSlot: { labelKey: 'windows.afternoon', start: '13:20', end: '14:50' },
    notificationCandidates: [{ id: 'block-1030', start: '10:30', copy: { en: 'engine copy' } }],
    copy: { headline: { key: 'guidance.headline.theme.education', vars: {} } },
  };
}

const weeklyOverlay = (locale: 'en' | 'si') => ({
  source: 'weekly_pack' as const,
  content: {
    date: '2026-07-08',
    headline: 'A calm day for focused study',
    summary: 'Use the day for steady learning and planning.',
    do: 'Finish one meaningful task.',
    avoid: 'Avoid rushing choices.',
    notification: 'Your best focus window is soon.',
  },
  provenance: {
    provider: 'gemini', status: 'generated', promptVersion: 'digest-ai-v1',
    locale, focusHash: 'aaa', chartHash: 'bbb', periodKey: '2026-W28',
  },
});

describe('SubatimeService.applyDailyAiOverlay', () => {
  it('overlays AI copy and preserves every engine fact', async () => {
    const svc = makeService(weeklyOverlay('en'));
    const base = basePayload();
    await svc.applyDailyAiOverlay(base, 'user-1', '2026-07-08', 'en');
    const b = base as OverlaidPayload;

    // AI copy added as an additive literal block.
    expect(b.aiCopy).toMatchObject({
      headline: 'A calm day for focused study',
      do: 'Finish one meaningful task.',
      avoid: 'Avoid rushing choices.',
      locale: 'en',
    });
    // Server prose guidance overlaid.
    expect(b.guidance).toBe('Use the day for steady learning and planning.');
    // Engine facts untouched.
    expect(b.rating).toBe('good');
    expect(b.userLagna).toBe('Dhanu');
    expect(b.confidence).toBe(0.81);
    expect(b.bestWindowSlot).toEqual({ labelKey: 'windows.morning', start: '10:30', end: '11:45' });
    expect(b.cautionWindowSlot).toEqual({ labelKey: 'windows.afternoon', start: '13:20', end: '14:50' });
  });

  it('uses AI notification COPY but leaves engine notification TIMING untouched', async () => {
    const svc = makeService(weeklyOverlay('en'));
    const base = basePayload();
    await svc.applyDailyAiOverlay(base, 'user-1', '2026-07-08', 'en');
    const b = base as OverlaidPayload;
    // Copy comes from AI.
    expect(b.aiCopy?.notification).toBe('Your best focus window is soon.');
    // Timing source (engine candidates) is unchanged — scheduler still owns send time/windows.
    expect(b.notificationCandidates).toEqual([{ id: 'block-1030', start: '10:30', copy: { en: 'engine copy' } }]);
  });

  it('does NOT overlay when the pack locale differs from the request language', async () => {
    const svc = makeService(weeklyOverlay('si')); // pack is Sinhala…
    const base = basePayload();
    await svc.applyDailyAiOverlay(base, 'user-1', '2026-07-08', 'en'); // …but request is English
    const b = base as OverlaidPayload;

    expect(b.aiCopy).toBeUndefined();
    expect(b.guidance).toBe('ENGINE deterministic guidance prose.'); // deterministic kept
    expect(b.aiOverlayAudit?.dailyCopySource).toBe('deterministic');
    expect(b.aiOverlayAudit?.reason).toBe('lang_mismatch');
  });

  it('applies a Sinhala pack for a Sinhala request', async () => {
    const si = weeklyOverlay('si');
    const svc = makeService({ ...si, content: { ...si.content, headline: 'අද ඉගෙනීමට හොඳයි' } });
    const base = basePayload();
    await svc.applyDailyAiOverlay(base, 'user-1', '2026-07-08', 'si');
    const b = base as OverlaidPayload;
    expect(b.aiCopy?.headline).toBe('අද ඉගෙනීමට හොඳයි');
    expect(b.aiCopy?.locale).toBe('si');
  });

  it('exposes dev audit fields when a pack is applied', async () => {
    const svc = makeService(weeklyOverlay('en'));
    const base = basePayload();
    await svc.applyDailyAiOverlay(base, 'user-1', '2026-07-08', 'en');
    expect((base as OverlaidPayload).aiOverlayAudit).toMatchObject({
      dailyCopySource: 'weekly_pack',
      periodKey: '2026-W28',
      aiProvider: 'gemini',
      contentStatus: 'generated',
      promptVersion: 'digest-ai-v1',
      chartHash: 'bbb',
      focusHash: 'aaa',
      locale: 'en',
    });
  });

  it('falls back silently and records the reason when no pack covers today', async () => {
    const svc = makeService({ source: 'deterministic', reason: 'no_weekly_pack' });
    const base = basePayload();
    await svc.applyDailyAiOverlay(base, 'user-1', '2026-07-08', 'en');
    const b = base as OverlaidPayload;
    expect(b.aiCopy).toBeUndefined();
    expect(b.guidance).toBe('ENGINE deterministic guidance prose.');
    expect(b.aiOverlayAudit?.dailyCopySource).toBe('deterministic');
    expect(b.aiOverlayAudit?.reason).toBe('no_weekly_pack');
  });

  it('never throws if the overlay lookup fails', async () => {
    const svc = makeService(null);
    svc.digestService.getWeeklyDailyOverlay.mockRejectedValueOnce(new Error('db down'));
    const base = basePayload();
    await expect(svc.applyDailyAiOverlay(base, 'user-1', '2026-07-08', 'en')).resolves.toBeUndefined();
    expect((base as OverlaidPayload).aiCopy).toBeUndefined();
  });
});
