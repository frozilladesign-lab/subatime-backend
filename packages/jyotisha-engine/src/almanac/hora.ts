import { getHoraFavorability } from '../calendar/hora-lagna';
import type { AccuracyMetadata } from '../types/chart';
import { jdToUtcDate } from './util';

export const CHALDEAN_LORDS = ['Sun', 'Venus', 'Mercury', 'Moon', 'Saturn', 'Jupiter', 'Mars'] as const;

/** First daytime horā lord (Chaldean sequence index 0…6) for JS weekday Sun=0 … Sat=6. */
const FIRST_DAY_HORA_LORD_IDX: readonly number[] = [0, 3, 6, 2, 5, 1, 4];

export type HoraSegment = {
  index1To12: number;
  lord: (typeof CHALDEAN_LORDS)[number];
  phase: 'day' | 'night';
  /** Heuristic benefic/malefic-by-lagna table — not an astronomical or classical-rule fact. */
  personalStatus: 'favorable' | 'tense' | 'neutral';
  startUtc: string;
  endUtc: string;
};

export type HoraTimelineResult = {
  dayHoras: HoraSegment[];
  nightHoras: HoraSegment[];
  accuracy: AccuracyMetadata;
};

/**
 * Twelve equal daytime horā (sunrise→sunset) and, when the next sunrise is known, twelve equal
 * night horā (sunset→next sunrise) — Chaldean lord sequence (Sun, Venus, Mercury, Moon, Saturn,
 * Jupiter, Mars) starting from the weekday's first lord, continuing unbroken into the night.
 */
export function computeHoraTimeline(params: {
  /** JS weekday convention: Sun=0 … Sat=6. */
  jsWeekday: number;
  sunriseJd: number;
  sunsetJd: number;
  nextSunriseJd: number | null;
  /** Optional whole-sign lagna (Sanskrit or English) for `personalStatus`. */
  lagna?: string;
}): HoraTimelineResult {
  const firstHoraIdx = FIRST_DAY_HORA_LORD_IDX[params.jsWeekday] ?? 0;
  const dayFrac = params.sunsetJd - params.sunriseJd;
  const horaFrac = dayFrac / 12;

  const dayHoras: HoraSegment[] = Array.from({ length: 12 }, (_, i) => {
    const lord = CHALDEAN_LORDS[(firstHoraIdx + i) % 7];
    const s = params.sunriseJd + i * horaFrac;
    const e = params.sunriseJd + (i + 1) * horaFrac;
    return {
      index1To12: i + 1,
      lord,
      phase: 'day' as const,
      personalStatus: getHoraFavorability(lord, params.lagna),
      startUtc: jdToUtcDate(s).toISOString(),
      endUtc: jdToUtcDate(e).toISOString(),
    };
  });

  let nightHoras: HoraSegment[] = [];
  if (params.nextSunriseJd != null) {
    const nightFrac = params.nextSunriseJd - params.sunsetJd;
    const firstNightIdx = (firstHoraIdx + 12) % 7;
    const nhFrac = nightFrac / 12;
    nightHoras = Array.from({ length: 12 }, (_, i) => {
      const lord = CHALDEAN_LORDS[(firstNightIdx + i) % 7];
      const s = params.sunsetJd + i * nhFrac;
      const e = params.sunsetJd + (i + 1) * nhFrac;
      return {
        index1To12: i + 1,
        lord,
        phase: 'night' as const,
        personalStatus: getHoraFavorability(lord, params.lagna),
        startUtc: jdToUtcDate(s).toISOString(),
        endUtc: jdToUtcDate(e).toISOString(),
      };
    });
  }

  return {
    dayHoras,
    nightHoras,
    accuracy: {
      tier: 'classical-rule',
      degraded: false,
      notes: [
        'Segment start/end instants are equal divisions of the real Swiss-Ephemeris sunrise/sunset/next-sunrise window.',
        'Horā lord sequencing (Chaldean order, weekday-indexed first lord) is a classical-rule lookup, not an independently-derived astronomical fact.',
        'personalStatus is a heuristic lagna benefic/malefic table — not an astronomical or classical-rule claim by itself.',
      ],
    },
  };
}
