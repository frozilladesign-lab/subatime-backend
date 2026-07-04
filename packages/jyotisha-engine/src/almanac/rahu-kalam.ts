import type { AccuracyMetadata } from '../types/chart';
import { jdToUtcDate } from './util';

/** 1-based Rāhu-kāla segment index (of 8) for JS weekday Sun=0 … Sat=6 (common Vedic table). */
const RAHU_SLOT_BY_JS_WEEKDAY = [8, 2, 7, 5, 4, 6, 3] as const;

/** Yamagaṇḍa — segment 1–8 within sunrise→sunset (Sun=0 … Sat=6). */
const YAMA_SLOT_BY_JS_WEEKDAY = [5, 4, 3, 2, 1, 7, 6] as const;

/** Gulika — segment 1–8 within sunrise→sunset (Sun=0 … Sat=6). */
const GULI_SLOT_BY_JS_WEEKDAY = [6, 5, 4, 3, 2, 1, 7] as const;

/** Maru direction (English key) by JS weekday Sun=0 … Sat=6 — Litha-style table. */
const MARU_DIRECTION_BY_JS_WEEKDAY = [
  'North',
  'NorthWest',
  'West',
  'SouthWest',
  'South',
  'SouthEast',
  'East',
] as const;

export type DaySegment = { slot1To8: number; startUtc: string; endUtc: string };

export type RahuKalamResult = {
  rahuKala: DaySegment;
  yamagandha: DaySegment;
  gulika: DaySegment;
  maruDirection: string;
  accuracy: AccuracyMetadata;
};

function segmentUtc(sunriseJd: number, dayFrac: number, slot1To8: number): DaySegment {
  const s = sunriseJd + ((slot1To8 - 1) / 8) * dayFrac;
  const e = sunriseJd + (slot1To8 / 8) * dayFrac;
  return {
    slot1To8,
    startUtc: jdToUtcDate(s).toISOString(),
    endUtc: jdToUtcDate(e).toISOString(),
  };
}

/**
 * Rāhu kāla, Yamagaṇḍa, and Gulika: each an eighth-part of the real sunrise→sunset solar day,
 * with the weekday-indexed slot chosen from the classical Vedic table. Maru diśā (inauspicious
 * direction) is a separate weekday-indexed classical lookup, also returned here since it shares
 * the same weekday input.
 */
export function computeRahuKalam(jsWeekday: number, sunriseJd: number, sunsetJd: number): RahuKalamResult {
  const dayFrac = sunsetJd - sunriseJd;
  const maruDirection = MARU_DIRECTION_BY_JS_WEEKDAY[jsWeekday] ?? 'North';

  return {
    rahuKala: segmentUtc(sunriseJd, dayFrac, RAHU_SLOT_BY_JS_WEEKDAY[jsWeekday] ?? 1),
    yamagandha: segmentUtc(sunriseJd, dayFrac, YAMA_SLOT_BY_JS_WEEKDAY[jsWeekday] ?? 1),
    gulika: segmentUtc(sunriseJd, dayFrac, GULI_SLOT_BY_JS_WEEKDAY[jsWeekday] ?? 1),
    maruDirection,
    accuracy: {
      tier: 'classical-rule',
      degraded: false,
      notes: [
        'Segment start/end instants are equal divisions of the real Swiss-Ephemeris sunrise/sunset window.',
        'Slot selection (which eighth is Rāhu kāla/Yamagaṇḍa/Gulika) and Maru diśā are classical-rule weekday lookups, not independently-derived astronomical facts.',
      ],
    },
  };
}
