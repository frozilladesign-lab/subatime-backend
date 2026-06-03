import type { LocalizedStringNode } from './prediction-payload.interface';
import type { FeedRowCopyContract } from './feed-copy-contract.interface';
import { windowLabelKey } from './copy-contract.builder';

type TimeBlock = { label: string; start: string; end: string };

function windowNode(block?: TimeBlock): LocalizedStringNode {
  if (!block) return { key: 'windows.none', vars: {} };
  return {
    key: windowLabelKey(block.label),
    vars: { start: block.start, end: block.end },
  };
}

function confidenceBand(score: number): 'high' | 'medium' | 'low' {
  const c = Number.isFinite(score) ? score : 0.65;
  if (c >= 0.72) return 'high';
  if (c >= 0.56) return 'medium';
  return 'low';
}

function deriveFeedRating(confidenceScore: number, scoreSpread: number): 'great' | 'good' | 'mixed' | 'tense' {
  const c = Number.isFinite(confidenceScore) ? confidenceScore : 0.65;
  const spread = Number.isFinite(scoreSpread) ? scoreSpread : 0.1;
  if (c >= 0.78 && spread >= 0.12) return 'great';
  if (c >= 0.62) return 'good';
  if (c >= 0.48) return 'mixed';
  return 'tense';
}

export function relativeDayLabelCopy(date: Date, today: Date): LocalizedStringNode {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const t = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const diff = Math.round((t.getTime() - d.getTime()) / 86_400_000);
  if (diff === 0) return { key: 'feed.date.today', vars: {} };
  if (diff === 1) return { key: 'feed.date.yesterday', vars: {} };
  return { key: 'feed.date.days_ago', vars: { days: diff } };
}

function doLineCopy(block: TimeBlock): LocalizedStringNode {
  if (block.start && block.end) {
    return {
      key: 'feed.do.line.timed',
      vars: { window: windowNode(block) },
    };
  }
  return {
    key: 'feed.do.line.general',
    vars: { window: windowNode(block) },
  };
}

function avoidLineCopy(block: TimeBlock): LocalizedStringNode {
  if (block.start && block.end) {
    return {
      key: 'feed.avoid.line.timed',
      vars: { window: windowNode(block) },
    };
  }
  return {
    key: 'feed.avoid.line.general',
    vars: { window: windowNode(block) },
  };
}

function multiLineBodyCopy(
  bodyKey: string,
  lines: LocalizedStringNode[],
): LocalizedStringNode {
  const vars: Record<string, string | number | LocalizedStringNode> = {};
  lines.slice(0, 2).forEach((line, i) => {
    vars[`line${i + 1}`] = line;
  });
  if (lines.length === 0) {
    return { key: 'feed.empty', vars: {} };
  }
  if (lines.length === 1) {
    return lines[0];
  }
  return { key: bodyKey, vars };
}

export function buildFeedDoCopy(blocks: TimeBlock[]): FeedRowCopyContract {
  const lines = blocks.slice(0, 2).map(doLineCopy);
  const body = multiLineBodyCopy('feed.do.body', lines);
  const preview = lines[0] ?? { key: 'feed.empty', vars: {} };
  return {
    title: { key: 'feed.title.do', vars: {} },
    preview,
    body,
    source: { key: 'feed.source.do', vars: {} },
  };
}

export function buildFeedAvoidCopy(blocks: TimeBlock[]): FeedRowCopyContract {
  const lines = blocks.slice(0, 2).map(avoidLineCopy);
  const body = multiLineBodyCopy('feed.avoid.body', lines);
  const preview = lines[0] ?? { key: 'feed.empty', vars: {} };
  return {
    title: { key: 'feed.title.avoid', vars: {} },
    preview,
    body,
    source: { key: 'feed.source.avoid', vars: {} },
  };
}

export function buildFeedSignalCopy(
  summary: string,
  transits: unknown[],
): FeedRowCopyContract | null {
  for (const x of transits) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    const title = typeof o.title === 'string' ? o.title.trim() : '';
    const description = typeof o.description === 'string' ? o.description.trim() : '';
    if (title.length > 0 || description.length > 0) {
      return {
        title: { key: 'feed.title.signal', vars: {} },
        preview: {
          key: 'feed.signal.transit',
          vars: { transit_title: title || 'Transit', transit_description: description },
        },
        body: {
          key: 'feed.signal.transit',
          vars: { transit_title: title || 'Transit', transit_description: description },
        },
        source: { key: 'feed.source.signal', vars: {} },
      };
    }
  }
  const s = summary.trim();
  if (s.length > 48) {
    const cut = s.indexOf('.', 40);
    const excerpt = (cut > 20 ? s.slice(0, cut + 1) : s.slice(0, 200)).trim();
    return {
      title: { key: 'feed.title.signal', vars: {} },
      preview: { key: 'feed.signal.excerpt', vars: { excerpt } },
      body: { key: 'feed.signal.excerpt', vars: { excerpt } },
      source: { key: 'feed.source.signal', vars: {} },
    };
  }
  return {
    title: { key: 'feed.title.signal', vars: {} },
    preview: { key: 'feed.signal.fallback', vars: {} },
    body: { key: 'feed.signal.fallback', vars: {} },
    source: { key: 'feed.source.signal', vars: {} },
  };
}

export function buildFeedGroundingCopy(confidenceScore: number): FeedRowCopyContract {
  const band = confidenceBand(confidenceScore);
  return {
    title: { key: 'feed.title.grounding', vars: {} },
    preview: { key: `feed.grounding.${band}`, vars: {} },
    body: { key: `feed.grounding.${band}`, vars: {} },
    source: { key: 'feed.source.grounding', vars: {} },
  };
}

export function buildFeedHowToReadCopy(
  confidenceScore: number,
  transitCount: number,
): FeedRowCopyContract {
  const band = confidenceBand(confidenceScore);
  const alignmentKey =
    band === 'high' ? 'feed.alignment.strong' : band === 'medium' ? 'feed.alignment.mixed' : 'feed.alignment.heavy';
  return {
    title: { key: 'feed.title.how_to_read', vars: {} },
    preview: {
      key: 'feed.how_to_read.body',
      vars: {
        transit_count: Math.max(0, transitCount),
        alignment: { key: alignmentKey, vars: {} },
      },
    },
    body: {
      key: 'feed.how_to_read.body',
      vars: {
        transit_count: Math.max(0, transitCount),
        alignment: { key: alignmentKey, vars: {} },
      },
    },
    source: { key: 'feed.source.how_to_read', vars: {} },
  };
}

export function buildFeedRhythmCopy(
  summary: string,
  good: TimeBlock[],
  bad: TimeBlock[],
): FeedRowCopyContract | null {
  const s = summary.trim();
  const g0 = good[0];
  const b0 = bad[0];
  const vars: Record<string, string | number | LocalizedStringNode> = {};
  if (g0?.start && g0?.end) {
    vars.morning = {
      key: 'feed.rhythm.morning.window',
      vars: { window: windowNode(g0) },
    };
  } else if (s.length) {
    vars.morning = { key: 'feed.rhythm.morning.summary', vars: { excerpt: s.slice(0, 100) } };
  }
  if (b0?.start && b0?.end) {
    vars.evening = {
      key: 'feed.rhythm.evening.window',
      vars: { window: windowNode(b0) },
    };
  } else if (s.length) {
    vars.evening = { key: 'feed.rhythm.evening.summary', vars: { excerpt: s.slice(0, 80) } };
  }
  if (s.length) {
    vars.night = { key: 'feed.rhythm.night', vars: { excerpt: s.slice(0, 90) } };
  }
  if (Object.keys(vars).length === 0) return null;
  return {
    title: { key: 'feed.title.rhythm', vars: {} },
    preview: { key: 'feed.rhythm.body', vars: { ...vars } },
    body: { key: 'feed.rhythm.body', vars: { ...vars } },
    source: { key: 'feed.source.rhythm', vars: {} },
  };
}

export function buildFeedPredictionCopy(
  summary: string,
  confidenceScore: number,
  scoreSpread: number,
): FeedRowCopyContract {
  const rating = deriveFeedRating(confidenceScore, scoreSpread);
  const excerpt = summary.trim();
  return {
    title: {
      key: `feed.prediction.headline.${rating}`,
      vars: excerpt.length ? { excerpt: excerpt.slice(0, 220) } : {},
    },
    preview: {
      key: 'feed.prediction.excerpt',
      vars: { excerpt: excerpt.slice(0, 160) || ' ' },
    },
    body: {
      key: 'feed.prediction.excerpt',
      vars: { excerpt: excerpt || ' ' },
    },
    source: { key: 'feed.source.prediction', vars: {} },
  };
}

function colorNameNode(colorName: string): LocalizedStringNode {
  const slug = colorName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return { key: `feed.colors.${slug || 'named'}`, vars: { color_name: colorName } };
}

export function buildFeedCharmCopy(
  luckyNumber: number,
  luckyColor: string,
): FeedRowCopyContract {
  const color = colorNameNode(luckyColor);
  return {
    title: {
      key: 'feed.charm.title',
      vars: { lucky_number: luckyNumber },
    },
    preview: {
      key: 'feed.charm.preview',
      vars: { color },
    },
    body: {
      key: 'feed.charm.body',
      vars: {
        lucky_number: luckyNumber,
        color,
      },
    },
    source: { key: 'feed.source.charm', vars: {} },
  };
}

export function buildFeedDreamCopy(args: {
  title: string;
  body: string;
  band: 'stable' | 'mild' | 'elevated' | 'overload' | null;
  insight: string;
  grounding: string;
  themes: string[];
}): FeedRowCopyContract {
  const themesJoin = args.themes.slice(0, 5).join(' · ');
  const previewKey = args.insight.trim().length
    ? 'feed.dream.preview.insight'
    : themesJoin.length
      ? 'feed.dream.preview.themes'
      : 'feed.dream.preview.body';
  const previewVars: Record<string, string | number | LocalizedStringNode> = args.insight.trim().length
    ? { insight: args.insight.trim().slice(0, 160) }
    : themesJoin.length
      ? { themes: themesJoin.slice(0, 160) }
      : { excerpt: args.body.slice(0, 120) };

  const copy: FeedRowCopyContract = {
    title: { key: 'feed.dream.title', vars: { dream_title: args.title.slice(0, 80) || 'Dream' } },
    preview: { key: previewKey, vars: previewVars },
    body: { key: 'feed.dream.body', vars: { excerpt: args.body } },
    source: { key: 'feed.source.dream', vars: {} },
  };
  if (args.band) {
    copy.dreamStateLabel = { key: `feed.dream.band.${args.band}`, vars: {} };
  }
  if (args.insight.trim()) {
    copy.dreamInsight = { key: 'feed.dream.insight', vars: { insight: args.insight.trim() } };
  }
  if (args.grounding.trim()) {
    copy.dreamGrounding = { key: 'feed.dream.grounding', vars: { tip: args.grounding.trim() } };
  }
  return copy;
}
