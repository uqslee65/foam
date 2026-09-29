import * as fs from 'node:fs';
import * as path from 'node:path';

export interface CalendarEvent {
  readonly id: string;
  readonly date: string;
  readonly title: string;
  readonly start_time?: string;
  readonly end_time?: string;
  readonly category?: string;
  readonly project?: string;
  readonly quadrant?: string;
  readonly status?: string;
  readonly location?: string;
}

export type CalendarFile =
  | { status: 'ok'; events: CalendarEvent[]; timezone: string }
  | { status: 'missing'; reason: string };

export interface CalendarGroupNode {
  readonly kind: 'date-group';
  readonly date: string;
  readonly label: string;
  readonly count: number;
}

export interface CalendarItemNode {
  readonly kind: 'event';
  readonly event: CalendarEvent;
  readonly label: string;
}

export type CalendarTreeElement = CalendarGroupNode | CalendarItemNode;

export interface CalendarTree {
  refresh(data: CalendarFile, today: string): void;
  getChildren(element?: CalendarTreeElement): readonly CalendarTreeElement[];
  onDidChange(listener: () => void): { dispose(): void };
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export function readCalendar(filePath: string): CalendarFile {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !Array.isArray((parsed as { events?: unknown }).events)
    ) {
      return { status: 'missing', reason: 'invalid calendar file: missing events array' };
    }
    const events = (parsed as { events: unknown[] }).events;
    if (
      !events.every(
        event =>
          typeof event === 'object' &&
          event !== null &&
          typeof (event as { id?: unknown }).id === 'string' &&
          typeof (event as { date?: unknown }).date === 'string' &&
          typeof (event as { title?: unknown }).title === 'string'
      )
    ) {
      return { status: 'missing', reason: 'invalid calendar file: malformed event' };
    }
    const timezone =
      typeof (parsed as { timezone?: unknown }).timezone === 'string'
        ? ((parsed as { timezone: string }).timezone)
        : 'UTC';
    return {
      status: 'ok',
      events: events as CalendarEvent[],
      timezone,
    };
  } catch (err) {
    return { status: 'missing', reason: String(err) };
  }
}

export function eventsForDay(events: CalendarEvent[], isoDate: string): CalendarEvent[] {
  return events
    .filter(event => event.date === isoDate)
    .sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? ''));
}

export function eventsForRange(
  events: CalendarEvent[],
  startDate: string,
  days: number
): CalendarEvent[] {
  const startDateTime = new Date(`${startDate}T00:00:00Z`);
  const endDate = new Date(
    Date.UTC(
      startDateTime.getUTCFullYear(),
      startDateTime.getUTCMonth(),
      startDateTime.getUTCDate() + days
    )
  );
  const end = endDate.toISOString().slice(0, 10);

  return events
    .filter(event => event.date >= startDate && event.date < end)
    .sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) {
        return dateCompare;
      }
      return (a.start_time ?? '').localeCompare(b.start_time ?? '');
    });
}

function formatGroupLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const weekday = WEEKDAY_LABELS[d.getUTCDay()];
  const day = d.getUTCDate();
  const month = MONTH_LABELS[d.getUTCMonth()];
  return `${weekday} ${day} ${month}`;
}

function formatEventLabel(event: CalendarEvent): string {
  if (event.start_time && event.end_time) {
    return `${event.start_time}–${event.end_time} ${event.title}`;
  }
  return event.title;
}

export function createCalendarTree(): CalendarTree {
  const groups = new Map<string, CalendarItemNode[]>();
  const listeners = new Set<() => void>();

  function refresh(data: CalendarFile, today: string): void {
    groups.clear();
    if (data.status === 'ok') {
      const upcoming = eventsForRange(data.events, today, 14);
      for (const event of upcoming) {
        const items = groups.get(event.date) ?? [];
        items.push({
          kind: 'event',
          event,
          label: formatEventLabel(event),
        });
        groups.set(event.date, items);
      }
    }
    for (const listener of listeners) {
      listener();
    }
  }

  function getChildren(element?: CalendarTreeElement): readonly CalendarTreeElement[] {
    if (element === undefined) {
      return [...groups.keys()].sort().map(date => ({
        kind: 'date-group' as const,
        date,
        label: formatGroupLabel(date),
        count: groups.get(date)!.length,
      }));
    }

    if (element.kind === 'date-group') {
      return groups.get(element.date) ?? [];
    }

    return [];
  }

  function onDidChange(listener: () => void): { dispose(): void } {
    listeners.add(listener);
    return { dispose: () => listeners.delete(listener) };
  }

  return { refresh, getChildren, onDidChange };
}

export function resolveCalendarFile(homeDir: string, envOverride?: string): string {
  if (envOverride) {
    return envOverride;
  }
  return path.join(
    homeDir,
    'projects',
    'export-setup',
    'personal-assistant-copy',
    'vault',
    'calendar',
    'events.json'
  );
}
