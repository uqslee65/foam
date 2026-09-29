import { describe, expect, it } from 'vitest';
import {
  getFixedSnippets,
  getDayOfWeekSnippets,
  type DailyNoteSnippet,
} from '../../daily-note/daily-note-snippets';

describe('daily notes', () => {
  it('test_daily_notes_fixed_snippets_count', () => {
    const referenceDate = new Date(2024, 0, 17);
    const snippets = getFixedSnippets(referenceDate);

    expect(snippets).toHaveLength(4);
    const triggers = snippets.map(s => s.trigger);
    expect(triggers).toContain('/day');
    expect(triggers).toContain('/today');
    expect(triggers).toContain('/tomorrow');
    expect(triggers).toContain('/yesterday');
  });

  it('test_daily_notes_fixed_snippets_have_dates', () => {
    const referenceDate = new Date(2024, 0, 17);
    const snippets = getFixedSnippets(referenceDate);

    for (const snippet of snippets) {
      expect(snippet.date).toBeInstanceOf(Date);
      expect(isNaN(snippet.date.getTime())).toBe(false);
    }
  });

  it('test_daily_notes_day_of_week_snippets', () => {
    const referenceDate = new Date(2024, 0, 17);
    const snippets = getDayOfWeekSnippets(referenceDate);

    expect(snippets).toHaveLength(14);

    const futureSnippets = snippets.filter(s => !s.trigger.startsWith('/-'));
    const pastSnippets = snippets.filter(s => s.trigger.startsWith('/-'));

    expect(futureSnippets).toHaveLength(7);
    expect(pastSnippets).toHaveLength(7);
  });

  it('test_daily_notes_today_snippet_date', () => {
    const referenceDate = new Date(2024, 0, 17);
    const snippets = getFixedSnippets(referenceDate);

    const todaySnippet = snippets.find(s => s.trigger === '/today');
    expect(todaySnippet).toBeDefined();
    expect(todaySnippet!.date.getTime()).toBe(referenceDate.getTime());
  });

  it('test_daily_notes_tomorrow_is_next_day', () => {
    const referenceDate = new Date(2024, 0, 17);
    const snippets = getFixedSnippets(referenceDate);

    const tomorrowSnippet = snippets.find(s => s.trigger === '/tomorrow');
    expect(tomorrowSnippet).toBeDefined();

    const expectedDate = new Date(referenceDate);
    expectedDate.setDate(expectedDate.getDate() + 1);

    expect(tomorrowSnippet!.date.getTime()).toBe(expectedDate.getTime());
  });

  it('test_daily_notes_snippets_have_descriptions', () => {
    const referenceDate = new Date(2024, 0, 17);
    const fixedSnippets = getFixedSnippets(referenceDate);
    const dayOfWeekSnippets = getDayOfWeekSnippets(referenceDate);
    const allSnippets: DailyNoteSnippet[] = [...fixedSnippets, ...dayOfWeekSnippets];

    for (const snippet of allSnippets) {
      expect(typeof snippet.description).toBe('string');
      expect(snippet.description.trim().length).toBeGreaterThan(0);
    }
  });
});
