import { describe, expect, it } from 'vitest';
import { createCalendarTree, eventsForRange } from '../calendar';

describe('calendar UTC boundaries and group order', () => {
  it('keeps an event near midnight UTC in the correct day range', () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';

    try {
      const event = {
        id: 'near-midnight-utc',
        date: new Date('2026-01-01T23:59:00Z').toISOString().slice(0, 10),
        title: 'Near midnight UTC',
      };

      expect(eventsForRange([event], '2026-01-01', 1)).toEqual([event]);
    } finally {
      if (originalTimezone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTimezone;
      }
    }
  });

  it('returns date groups in chronological order', () => {
    const tree = createCalendarTree();
    tree.refresh(
      {
        status: 'ok',
        timezone: 'UTC',
        events: [
          { id: 'later', date: '2026-01-03', title: 'Later' },
          { id: 'earlier', date: '2026-01-01', title: 'Earlier' },
          { id: 'middle', date: '2026-01-02', title: 'Middle' },
        ],
      },
      '2026-01-01'
    );

    expect(
      tree
        .getChildren()
        .map(group => (group.kind === 'date-group' ? group.date : undefined))
    ).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
  });
});
