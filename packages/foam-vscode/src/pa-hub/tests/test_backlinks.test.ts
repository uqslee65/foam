import { describe, expect, it } from 'vitest';
import { createSourceTree, parseIndex } from '../sources';

describe('backlinks', () => {
  it('test_backlinks_entry_links_to_source', () => {
    const content = `## References\n- [[docs/architecture.md]]\n- [[guides/getting-started.md]]`;
    const topics = parseIndex(content);
    const tree = createSourceTree();
    tree.refresh(
      topics,
      () => true,
      () => true
    );

    const rootTopics = tree.getChildren();
    expect(rootTopics).toHaveLength(1);
    expect(rootTopics[0]).toEqual({
      kind: 'topic',
      label: 'References',
      count: 2,
    });

    const entries = tree.getChildren(rootTopics[0]);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      kind: 'entry',
      label: 'architecture.md',
      relativePath: 'docs/architecture.md',
      broken: false,
      topic: 'References',
    });
    expect(entries[1]).toEqual({
      kind: 'entry',
      label: 'getting-started.md',
      relativePath: 'guides/getting-started.md',
      broken: false,
      topic: 'References',
    });
  });

  it('test_backlinks_broken_link_detected', () => {
    const content = `## Sources\n- [[valid-source.md]]\n- [[missing-source.md]]`;
    const topics = parseIndex(content);
    const tree = createSourceTree();
    tree.refresh(
      topics,
      relativePath => relativePath === 'valid-source.md',
      () => true
    );

    const rootTopics = tree.getChildren();
    expect(rootTopics).toHaveLength(1);

    const entries = tree.getChildren(rootTopics[0]);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      kind: 'entry',
      label: 'valid-source.md',
      relativePath: 'valid-source.md',
      broken: false,
      topic: 'Sources',
    });
    expect(entries[1]).toEqual({
      kind: 'entry',
      label: 'missing-source.md',
      relativePath: 'missing-source.md',
      broken: true,
      topic: 'Sources',
    });
  });

  it('test_backlinks_permission_filters_entries', () => {
    const content = `## Mixed Topic\n- [[public/allowed.md]]\n- [[private/confidential.md]]`;
    const topics = parseIndex(content);
    const tree = createSourceTree();
    tree.refresh(
      topics,
      () => true,
      relativePath => !relativePath.startsWith('private/')
    );

    const rootTopics = tree.getChildren();
    expect(rootTopics).toHaveLength(1);
    expect(rootTopics[0]).toEqual({
      kind: 'topic',
      label: 'Mixed Topic',
      count: 1,
    });

    const entries = tree.getChildren(rootTopics[0]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      kind: 'entry',
      label: 'allowed.md',
      relativePath: 'public/allowed.md',
      broken: false,
      topic: 'Mixed Topic',
    });
  });

  it('test_backlinks_duplicate_topic_merges', () => {
    const content = `## Research\n- [[paper-a.md]]\n\n## Research\n- [[paper-b.md]]`;
    const topics = parseIndex(content);
    const tree = createSourceTree();
    tree.refresh(
      topics,
      () => true,
      () => true
    );

    const rootTopics = tree.getChildren();
    expect(rootTopics).toHaveLength(1);
    expect(rootTopics[0]).toEqual({
      kind: 'topic',
      label: 'Research',
      count: 2,
    });

    const entries = tree.getChildren(rootTopics[0]);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      kind: 'entry',
      label: 'paper-a.md',
      relativePath: 'paper-a.md',
      broken: false,
      topic: 'Research',
    });
    expect(entries[1]).toEqual({
      kind: 'entry',
      label: 'paper-b.md',
      relativePath: 'paper-b.md',
      broken: false,
      topic: 'Research',
    });
  });

  it('test_backlinks_refresh_clears_previous', () => {
    const tree = createSourceTree();

    const initialTopics = parseIndex(`## Initial\n- [[old-note.md]]`);
    tree.refresh(
      initialTopics,
      () => true,
      () => true
    );

    const initialRoot = tree.getChildren();
    expect(initialRoot).toHaveLength(1);
    expect(initialRoot[0]).toEqual({
      kind: 'topic',
      label: 'Initial',
      count: 1,
    });

    const updatedTopics = parseIndex(`## Updated\n- [[new-note.md]]`);
    tree.refresh(
      updatedTopics,
      () => true,
      () => true
    );

    const updatedRoot = tree.getChildren();
    expect(updatedRoot).toHaveLength(1);
    expect(updatedRoot[0]).toEqual({
      kind: 'topic',
      label: 'Updated',
      count: 1,
    });

    const updatedEntries = tree.getChildren(updatedRoot[0]);
    expect(updatedEntries).toHaveLength(1);
    expect(updatedEntries[0]).toEqual({
      kind: 'entry',
      label: 'new-note.md',
      relativePath: 'new-note.md',
      broken: false,
      topic: 'Updated',
    });
  });
});
