import { describe, expect, it } from 'vitest';
import { parseIndex } from '../sources';

describe('wikilinks', () => {
  it('test_wikilinks_standard_link', () => {
    const content = `## Notes\n- [[note-name]]`;
    const topics = parseIndex(content);

    expect(topics).toHaveLength(1);
    expect(topics[0].label).toBe('Notes');
    expect(topics[0].entries).toHaveLength(1);
    expect(topics[0].entries[0]).toEqual({
      relativePath: 'note-name',
      label: 'note-name',
    });
  });

  it('test_wikilinks_nested_path', () => {
    const content = `## Projects\n- [[folder/subfolder/note]]`;
    const topics = parseIndex(content);

    expect(topics).toHaveLength(1);
    expect(topics[0].entries).toHaveLength(1);
    expect(topics[0].entries[0]).toEqual({
      relativePath: 'folder/subfolder/note',
      label: 'note',
    });
  });

  it('test_wikilinks_multiple_per_topic', () => {
    const content = `## Research\n- [[topic-a]]\n- [[topic-b]]\n- [[docs/topic-c]]`;
    const topics = parseIndex(content);

    expect(topics).toHaveLength(1);
    expect(topics[0].label).toBe('Research');
    expect(topics[0].entries).toHaveLength(3);
    expect(topics[0].entries[0]).toEqual({ relativePath: 'topic-a', label: 'topic-a' });
    expect(topics[0].entries[1]).toEqual({ relativePath: 'topic-b', label: 'topic-b' });
    expect(topics[0].entries[2]).toEqual({ relativePath: 'docs/topic-c', label: 'topic-c' });
  });

  it('test_wikilinks_across_topics', () => {
    const content = `## Category 1\n- [[cat1-note]]\n\n## Category 2\n- [[path/cat2-note]]`;
    const topics = parseIndex(content);

    expect(topics).toHaveLength(2);
    expect(topics[0].label).toBe('Category 1');
    expect(topics[0].entries).toEqual([
      { relativePath: 'cat1-note', label: 'cat1-note' },
    ]);
    expect(topics[1].label).toBe('Category 2');
    expect(topics[1].entries).toEqual([
      { relativePath: 'path/cat2-note', label: 'cat2-note' },
    ]);
  });

  it('test_wikilinks_ignores_non_wikilink_lines', () => {
    const content = `## Topic\nPlain text line here\n- A markdown list without link\nSome more commentary\n- [[actual-note]]\nFinal non-link text`;
    const topics = parseIndex(content);

    expect(topics).toHaveLength(1);
    expect(topics[0].entries).toHaveLength(1);
    expect(topics[0].entries[0]).toEqual({
      relativePath: 'actual-note',
      label: 'actual-note',
    });
  });

  it('test_wikilinks_empty_content', () => {
    const topics = parseIndex('');

    expect(topics).toEqual([]);
  });
});
