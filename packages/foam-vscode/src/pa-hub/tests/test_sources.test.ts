import { describe, expect, it } from 'vitest';
import { parseIndex, createSourceTree, type SourceTopic, type SourceEntry } from '../sources';

describe('sources', () => {
  it('test_sources_parse_single_topic', () => {
    const content = `## Work\n- [[docs/specs.md]]\n- [[notes.md]]`;
    const topics = parseIndex(content);

    expect(topics).toHaveLength(1);
    expect(topics[0].label).toBe('Work');
    expect(topics[0].entries).toHaveLength(2);
    expect(topics[0].entries[0]).toEqual({
      relativePath: 'docs/specs.md',
      label: 'specs.md',
    });
    expect(topics[0].entries[1]).toEqual({
      relativePath: 'notes.md',
      label: 'notes.md',
    });
  });

  it('test_sources_parse_multiple_topics', () => {
    const content = `## First Topic\n- [[file1.md]]\n\n## Second Topic\n- [[subdir/file2.md]]`;
    const topics = parseIndex(content);

    expect(topics).toHaveLength(2);
    expect(topics[0].label).toBe('First Topic');
    expect(topics[0].entries).toHaveLength(1);
    expect(topics[1].label).toBe('Second Topic');
    expect(topics[1].entries).toHaveLength(1);
  });

  it('test_sources_parse_ignores_non_wikilink_lines', () => {
    const content = `## Topic\nSome description line\n- plain list item\n- [[valid.md]]\nAnother random text line`;
    const topics = parseIndex(content);

    expect(topics).toHaveLength(1);
    expect(topics[0].entries).toHaveLength(1);
    expect(topics[0].entries[0].relativePath).toBe('valid.md');
  });

  it('test_sources_parse_ignores_content_before_first_heading', () => {
    const content = `# Title\nSome content before\n- [[ignored.md]]\n\n## First Heading\n- [[included.md]]`;
    const topics = parseIndex(content);

    expect(topics).toHaveLength(1);
    expect(topics[0].label).toBe('First Heading');
    expect(topics[0].entries).toHaveLength(1);
    expect(topics[0].entries[0].relativePath).toBe('included.md');
  });

  it('test_sources_parse_empty_heading', () => {
    const content = `## Empty Heading\n\n## Populated Heading\n- [[file.md]]`;
    const topics = parseIndex(content);

    expect(topics).toHaveLength(2);
    expect(topics[0].label).toBe('Empty Heading');
    expect(topics[0].entries).toEqual([]);
    expect(topics[1].label).toBe('Populated Heading');
    expect(topics[1].entries).toHaveLength(1);
  });

  it('test_sources_parse_entry_label_is_filename', () => {
    const content = `## Topic\n- [[deeply/nested/path/to/my-file.md]]`;
    const topics = parseIndex(content);

    expect(topics[0].entries[0].label).toBe('my-file.md');
  });

  it('test_sources_parse_entry_path_preserved', () => {
    const content = `## Topic\n- [[deeply/nested/path/to/my-file.md]]`;
    const topics = parseIndex(content);

    expect(topics[0].entries[0].relativePath).toBe('deeply/nested/path/to/my-file.md');
  });

  it('test_sources_tree_groups_by_topic', () => {
    const tree = createSourceTree();
    const topics = parseIndex(`## Topic A\n- [[a.md]]\n## Topic B\n- [[b.md]]`);
    tree.refresh(topics, () => true, () => true);

    const rootTopics = tree.getChildren(undefined) as SourceTopic[];
    expect(rootTopics).toHaveLength(2);
    expect(rootTopics[0]).toEqual({ kind: 'topic', label: 'Topic A', count: 1 });
    expect(rootTopics[1]).toEqual({ kind: 'topic', label: 'Topic B', count: 1 });
  });

  it('test_sources_tree_entries_for_topic', () => {
    const tree = createSourceTree();
    const topics = parseIndex(`## Topic A\n- [[docs/a.md]]`);
    tree.refresh(topics, () => true, () => true);

    const rootTopics = tree.getChildren(undefined) as SourceTopic[];
    const entries = tree.getChildren(rootTopics[0]) as SourceEntry[];

    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      kind: 'entry',
      label: 'a.md',
      relativePath: 'docs/a.md',
      broken: false,
      topic: 'Topic A',
    });
  });

  it('test_sources_tree_broken_entry', () => {
    const tree = createSourceTree();
    const topics = parseIndex(`## Topic\n- [[missing.md]]\n- [[exists.md]]`);
    tree.refresh(
      topics,
      relativePath => relativePath === 'exists.md',
      () => true
    );

    const rootTopics = tree.getChildren(undefined) as SourceTopic[];
    const entries = tree.getChildren(rootTopics[0]) as SourceEntry[];

    expect(entries[0].broken).toBe(true);
    expect(entries[1].broken).toBe(false);
  });

  it('test_sources_tree_permitted_filter', () => {
    const tree = createSourceTree();
    const topics = parseIndex(`## Topic\n- [[secret.md]]\n- [[public.md]]`);
    tree.refresh(
      topics,
      () => true,
      relativePath => relativePath !== 'secret.md'
    );

    const rootTopics = tree.getChildren(undefined) as SourceTopic[];
    const entries = tree.getChildren(rootTopics[0]) as SourceEntry[];

    expect(entries).toHaveLength(1);
    expect(entries[0].relativePath).toBe('public.md');
    expect(rootTopics[0].count).toBe(1);
  });

  it('test_sources_tree_empty_topics_excluded', () => {
    const tree = createSourceTree();
    const topics = parseIndex(`## Denied Topic\n- [[denied.md]]\n## Allowed Topic\n- [[allowed.md]]`);
    tree.refresh(
      topics,
      () => true,
      relativePath => relativePath === 'allowed.md'
    );

    const rootTopics = tree.getChildren(undefined) as SourceTopic[];
    expect(rootTopics).toHaveLength(1);
    expect(rootTopics[0].label).toBe('Allowed Topic');
  });

  it('test_sources_tree_refresh_fires_listener', () => {
    const tree = createSourceTree();
    let calls = 0;
    tree.onDidChange(() => {
      calls += 1;
    });

    const topics = parseIndex(`## Topic\n- [[file.md]]`);
    tree.refresh(topics, () => true, () => true);

    expect(calls).toBe(1);
  });

  it('test_sources_tree_dispose_removes_listener', () => {
    const tree = createSourceTree();
    let calls = 0;
    const subscription = tree.onDidChange(() => {
      calls += 1;
    });
    subscription.dispose();

    const topics = parseIndex(`## Topic\n- [[file.md]]`);
    tree.refresh(topics, () => true, () => true);

    expect(calls).toBe(0);
  });

  it('test_sources_tree_entry_has_no_children', () => {
    const tree = createSourceTree();
    const topics = parseIndex(`## Topic\n- [[file.md]]`);
    tree.refresh(topics, () => true, () => true);

    const rootTopics = tree.getChildren(undefined) as SourceTopic[];
    const entries = tree.getChildren(rootTopics[0]) as SourceEntry[];
    expect(tree.getChildren(entries[0])).toEqual([]);
  });
});
