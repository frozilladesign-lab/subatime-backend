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
}
