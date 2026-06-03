import {
  buildFeedDoCopy,
  buildFeedPredictionCopy,
  relativeDayLabelCopy,
} from './feed-copy-contract.builder';

describe('feed copy contract', () => {
  it('builds do row with window vars', () => {
    const copy = buildFeedDoCopy([
      { label: 'Morning Focus', start: '08:00', end: '10:00' },
    ]);
    expect(copy.title.key).toBe('feed.title.do');
    expect(copy.body.key).toBe('feed.do.line.timed');
  });

  it('builds prediction row with rating headline', () => {
    const copy = buildFeedPredictionCopy('A steady day ahead.', 0.8, 0.15);
    expect(copy.title.key).toBe('feed.prediction.headline.great');
  });

  it('relative day labels use feed.date keys', () => {
    const today = new Date('2026-05-19T12:00:00.000Z');
    const yesterday = new Date('2026-05-18T12:00:00.000Z');
    expect(relativeDayLabelCopy(today, today).key).toBe('feed.date.today');
    expect(relativeDayLabelCopy(yesterday, today).key).toBe('feed.date.yesterday');
  });
});
