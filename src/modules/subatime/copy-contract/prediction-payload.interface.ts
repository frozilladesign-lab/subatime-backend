/** Recursive localization node — resolved on the client (en / si). */
export interface LocalizedStringNode {
  key: string;
  vars?: Record<string, string | number | LocalizedStringNode>;
}

export interface PlanDayWindowSlot {
  labelKey: string;
  start: string;
  end: string;
}

export interface PlanDayCopyContract {
  headline: LocalizedStringNode;
  summary: LocalizedStringNode;
  bestWindowLine: LocalizedStringNode;
  cautionLine: LocalizedStringNode;
  actions: {
    do: LocalizedStringNode[];
    avoid: LocalizedStringNode[];
  };
  reasoning: {
    summary: LocalizedStringNode[];
    focus: LocalizedStringNode[];
    avoid: LocalizedStringNode[];
    timing: LocalizedStringNode[];
  };
}

export interface PlanDayCopyBuildInput {
  rating: 'great' | 'good' | 'mixed' | 'tense';
  focus: 'overall' | 'career' | 'love' | 'health';
  confidenceScore: number;
  focusWeightPct: number;
  bestWindow?: { start: string; end: string; label: string };
  cautionWindow?: { start: string; end: string; label: string };
  /**
   * Chart-derived life theme (career/money/relationship/health/education/travel/business/
   * spiritual/overall). Drives a theme-forward headline so different charts read differently
   * even on the same day; falls back to the rating headline for `overall`/unset.
   */
  dominantTheme?: string;
}
