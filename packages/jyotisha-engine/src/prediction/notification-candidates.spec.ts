import type { DayTransitDto } from '../scoring/day-transits';
import {
  buildNotificationCandidates,
  type BuildNotificationCandidatesInput,
} from './notification-candidates';

const BLOCKS = [
  { start: '06:00', end: '08:00', label: 'Early Morning' },
  { start: '08:00', end: '10:00', label: 'Morning Focus' },
  { start: '10:00', end: '12:00', label: 'Late Morning' },
  { start: '12:00', end: '14:00', label: 'Noon Window' },
  { start: '14:00', end: '16:00', label: 'Afternoon Push' },
  { start: '16:00', end: '18:00', label: 'Evening Start' },
  { start: '18:00', end: '20:00', label: 'Evening Prime' },
  { start: '20:00', end: '22:00', label: 'Night Calm' },
];

const TRANSITS: DayTransitDto[] = [
  {
    id: 'moon_trine_jupiter',
    title: 'Moon trine Jupiter',
    titleSi: 'සඳු ගුරු ත්‍රිකෝණය',
    description: 'Optimistic momentum favors outreach and generous gestures.',
    descriptionSi: 'ශුභ ප්‍රවේගය ගෙනෙයි.',
    intensity: 4,
    type: 'opportunity',
  },
  {
    id: 'moon_square_saturn',
    title: 'Moon square Saturn',
    description: 'Emotional tone runs heavier; keep stakes low and expectations realistic.',
    intensity: 3,
    type: 'challenge',
  },
];

function baseInput(): BuildNotificationCandidatesInput {
  return {
    date: '2026-07-04',
    timezone: 'Asia/Colombo',
    blocks: BLOCKS,
    blockScores: BLOCKS.map((b, i) => ({ start: b.start, score: 0.4 + i * 0.05 })),
    goodTimes: [BLOCKS[6], BLOCKS[7]],
    badTimes: [BLOCKS[4], BLOCKS[5]],
    transits: TRANSITS,
    confidenceScore: 0.72,
    dominantContext: 'career',
    lagna: 'Vrishabha',
    dashaLord: 'Jupiter',
    favorableHoras: [
      {
        lord: 'Jupiter',
        startUtc: '2026-07-04T04:30:00.000Z',
        endUtc: '2026-07-04T05:30:00.000Z',
      },
    ],
  };
}

describe('buildNotificationCandidates', () => {
  it('is deterministic — same input produces deep-equal output', () => {
    const a = buildNotificationCandidates(baseInput());
    const b = buildNotificationCandidates(baseInput());
    expect(b).toEqual(a);
  });

  it('emits one candidate per engine block with types derived from good/bad times', () => {
    const out = buildNotificationCandidates(baseInput());
    expect(out.blocks).toHaveLength(8);

    const byStart = new Map(out.blocks.map((b) => [b.startTime, b]));
    expect(byStart.get('18:00')?.type).toBe('peak');
    expect(byStart.get('18:00')?.priority).toBe(1);
    expect(byStart.get('20:00')?.type).toBe('strong');
    expect(byStart.get('14:00')?.type).toBe('caution');
    expect(byStart.get('14:00')?.priority).toBe(3);
    expect(byStart.get('16:00')?.type).toBe('caution'); // secondary caution
    expect(byStart.get('16:00')?.priority).toBe(4);
    expect(byStart.get('06:00')?.type).toBe('neutral');
  });

  it('sources peak/caution copy from the actual transit cards', () => {
    const out = buildNotificationCandidates(baseInput());
    const peak = out.blocks.find((b) => b.type === 'peak')!;
    expect(peak.reasonCode).toBe('transit:moon_trine_jupiter');
    expect(peak.body).toContain('Optimistic momentum');
    expect(peak.bodySi).toContain('ශුභ ප්‍රවේගය');
    expect(peak.astroSource.transitLabel).toBe('Moon trine Jupiter');
    expect(peak.astroSource.dashaLord).toBe('Jupiter');

    const caution = out.blocks.find((b) => b.priority === 3)!;
    expect(caution.reasonCode).toBe('transit:moon_square_saturn');
    // Lead-in "Emotional tone" is stripped by the shared trimmer.
    expect(caution.body.startsWith('Runs heavier')).toBe(true);
  });

  it('falls back to topic copy when no transit of the needed type exists', () => {
    const input = { ...baseInput(), transits: [] as DayTransitDto[] };
    const out = buildNotificationCandidates(input);
    const peak = out.blocks.find((b) => b.type === 'peak')!;
    expect(peak.reasonCode).toBe('topic:career');
    expect(peak.body).toContain('decisive work');
    expect(peak.bodySi.length).toBeGreaterThan(0);
  });

  it('builds a best-window candidate 8 minutes before the peak block', () => {
    const out = buildNotificationCandidates(baseInput());
    expect(out.bestWindow).toBeDefined();
    expect(out.bestWindow!.blockId).toBe('block-1800');
    expect(out.bestWindow!.sendAt).toBe('17:52');
    expect(out.bestWindow!.body).toContain('Evening Prime');
  });

  it('builds power-hour candidates 15 minutes before each favorable horā', () => {
    const out = buildNotificationCandidates(baseInput());
    expect(out.powerHours).toHaveLength(1);
    const ph = out.powerHours[0];
    expect(ph.horaLord).toBe('Jupiter');
    expect(ph.sendAt).toBe('2026-07-04T04:15:00.000Z');
    expect(ph.body).toContain('Jupiter Horā');
    expect(ph.body).toContain('Vrishabha');
  });

  it('emits no power hours when horas are missing, and no crash on empty transits', () => {
    const out = buildNotificationCandidates({
      ...baseInput(),
      favorableHoras: undefined,
      transits: [],
    });
    expect(out.powerHours).toEqual([]);
    expect(out.blocks).toHaveLength(8);
    expect(out.blocks.every((b) => b.title.length > 0 && b.body.length > 0)).toBe(true);
    expect(out.blocks.every((b) => b.titleSi.length > 0 && b.bodySi.length > 0)).toBe(true);
  });
});
