import type {
  LocalizedStringNode,
  PlanDayCopyBuildInput,
  PlanDayCopyContract,
} from './prediction-payload.interface';

/** Maps engine time-block labels to stable i18n keys (client `windows.*`). */
export function windowLabelKey(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  return `windows.${slug || 'anytime'}`;
}

function windowNode(block?: {
  start: string;
  end: string;
  label: string;
}): LocalizedStringNode {
  if (!block) {
    return { key: 'windows.none', vars: {} };
  }
  return {
    key: windowLabelKey(block.label),
    vars: { start: block.start, end: block.end },
  };
}

function categoryNode(focus: PlanDayCopyBuildInput['focus']): LocalizedStringNode {
  return { key: `categories.${focus}`, vars: {} };
}

/**
 * Packs computed plan-day scores into a locale-agnostic copy contract for Flutter i18n.
 */
export function buildPlanDayCopy(input: PlanDayCopyBuildInput): PlanDayCopyContract {
  const { rating, focus, focusWeightPct, bestWindow, cautionWindow } = input;
  const best = windowNode(bestWindow);
  const caution = windowNode(cautionWindow);

  const doActions: LocalizedStringNode[] = [];
  const avoidActions: LocalizedStringNode[] = [];

  if (bestWindow) {
    doActions.push({
      key: 'guidance.action.do',
      vars: { window: best, focus: categoryNode(focus) },
    });
  }
  if (cautionWindow) {
    avoidActions.push({
      key: 'guidance.action.avoid',
      vars: { window: caution },
    });
  }

  return {
    headline: { key: `guidance.headline.${rating}`, vars: {} },
    summary: {
      key: `guidance.summary.${rating}`,
      vars: {
        focus: categoryNode(focus),
        best_window: best,
        caution_window: caution,
      },
    },
    bestWindowLine: {
      key: 'guidance.best_window.line',
      vars: { window: best },
    },
    cautionLine: {
      key: 'guidance.caution.line',
      vars: { window: caution },
    },
    actions: { do: doActions, avoid: avoidActions },
    reasoning: {
      summary: [
        {
          key: 'reasoning.context',
          vars: {
            focus: categoryNode(focus),
            weight_pct: Math.round(Math.min(100, Math.max(0, focusWeightPct))),
          },
        },
      ],
      focus: bestWindow
        ? [
            {
              key: 'reasoning.timing.best',
              vars: { window: best },
            },
          ]
        : [],
      avoid: cautionWindow
        ? [
            {
              key: 'reasoning.timing.caution',
              vars: { window: caution },
            },
          ]
        : [],
      timing: [{ key: 'reasoning.window_model', vars: {} }],
    },
  };
}
