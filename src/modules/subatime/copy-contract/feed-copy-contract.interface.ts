import type { LocalizedStringNode } from './prediction-payload.interface';

export interface FeedRowCopyContract {
  title: LocalizedStringNode;
  preview: LocalizedStringNode;
  body: LocalizedStringNode;
  source?: LocalizedStringNode;
  dateLabel?: LocalizedStringNode;
  dreamStateLabel?: LocalizedStringNode;
  dreamInsight?: LocalizedStringNode;
  dreamGrounding?: LocalizedStringNode;
}
