import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  readCalendar,
  eventsForDay,
  eventsForRange,
  createCalendarTree,
  resolveCalendarFile,
} from './calendar';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cal-test-'));
}

describe('readCalendar', () => {
  it('returns status missing for a nonexistent path', () => {
    const result = readCalendar('/nonexistent/path/events.json');
    expect(result.status).toBe('missing');
  });

  it('returns status ok for a valid events.json', () => {
    const tmpDir = makeTmpDir();
    try {
      const filePath = path.join(tmpDir, 'events.json');
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          version: '1.0',
          timezone: 'Australia/Brisbane',
          events: [
            {
              id: 'ev-1',
              date: '2026-08-26',
              start_time: '08:00',
              end_time: '09:30',
              title: 'Teaching Printing',
            },
          ],
        })
      );
      const result = readCalendar(filePath);
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.timezone).toBe('Australia/Brisbane');
        expect(result.events).toHaveLength(1);
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

describe('eventsForDay', () => {
  it('filters events matching the target date', () => {
    const tmpDir = makeTmpDir();
    try {
      const events = [
        { id: 'a', date: '2026-08-26', title: 'Event A', start_time: '09:00' },
        { id: 'b', date: '2026-08-26', title: 'Event B', start_time: '08:00' },
        { id: 'c', date: '2026-08-27', title: 'Event C', start_time: '10:00' },
      ];
      const result = eventsForDay(events, '2026-08-26');
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('b');
      expect(result[1].id).toBe('a');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

describe('eventsForRange', () => {
  it('returns sorted upcoming events within range', () => {
    const tmpDir = makeTmpDir();
    try {
      const events = [
        { id: 'a', date: '2026-08-30', title: 'Later', start_time: '09:00' },
        { id: 'b', date: '2026-08-26', title: 'First', start_time: '08:00' },
        { id: 'c', date: '2026-09-15', title: 'Out of range', start_time: '10:00' },
      ];
      const result = eventsForRange(events, '2026-08-26', 14);
      expect(result.map(e => e.id)).toEqual(['b', 'a']);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

describe('createCalendarTree', () => {
  it('groups events by date when refreshed with ok data', () => {
    const tmpDir = makeTmpDir();
    try {
      const tree = createCalendarTree();
      const data = {
        status: 'ok' as const,
        timezone: 'Australia/Brisbane',
        events: [
          { id: 'a', date: '2026-08-26', title: 'In range', start_time: '08:00' },
          { id: 'b', date: '2026-09-20', title: 'Out of range', start_time: '09:00' },
        ],
      };
      tree.refresh(data, '2026-08-26');
      const roots = tree.getChildren();
      expect(roots).toHaveLength(1);
      const group = roots[0];
      expect(group.kind).toBe('date-group');
      if (group.kind === 'date-group') {
        expect(group.date).toBe('2026-08-26');
        expect(group.count).toBe(1);
        expect(group.label).toMatch(/^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}$/);
        const children = tree.getChildren(group);
        expect(children).toHaveLength(1);
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('returns empty children when refreshed with missing data', () => {
    const tree = createCalendarTree();
    tree.refresh({ status: 'missing', reason: 'no file' }, '2026-08-26');
    expect(tree.getChildren()).toEqual([]);
  });
});

describe('resolveCalendarFile', () => {
  it('uses envOverride when provided', () => {
    const result = resolveCalendarFile('/fake/home', '/custom/path/events.json');
    expect(result).toBe('/custom/path/events.json');
  });

  it('uses default path when envOverride is not provided', () => {
    const result = resolveCalendarFile('/fake/home');
    expect(result).toBe(
      path.join(
        '/fake/home',
        'projects',
        'export-setup',
        'personal-assistant-copy',
        'vault',
        'calendar',
        'events.json'
      )
    );
  });
});
