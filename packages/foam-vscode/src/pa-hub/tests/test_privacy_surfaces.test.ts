import { describe, expect, it } from 'vitest';
import { createPrivacyPolicy } from '../privacy';
import { createSourceTree, parseIndex } from '../sources';
import { createCapture } from '../inbox';

describe('privacy surfaces enforcement', () => {
  it('test_privacy_surfaces_source_tree_filters_excluded', () => {
    const tree = createSourceTree();
    const content = `## Research Topics\n- [[docs/public-study.md]]\n- [[docs/classified-doc.md]]`;
    const topics = parseIndex(content);

    tree.refresh(
      topics,
      () => true,
      relativePath => !relativePath.includes('classified')
    );

    const rootTopics = tree.getChildren(undefined);
    expect(rootTopics).toHaveLength(1);
    expect(rootTopics[0]).toMatchObject({
      kind: 'topic',
      label: 'Research Topics',
      count: 1,
    });

    const entries = tree.getChildren(rootTopics[0]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: 'entry',
      label: 'public-study.md',
      relativePath: 'docs/public-study.md',
    });
  });

  it('test_privacy_surfaces_source_tree_permits_allowed', () => {
    const tree = createSourceTree();
    const content = `## Project Knowledge\n- [[notes/test-user-data.md]]\n- [[notes/public-roadmap.md]]`;
    const topics = parseIndex(content);

    tree.refresh(
      topics,
      () => true,
      relativePath => relativePath.startsWith('notes/')
    );

    const rootTopics = tree.getChildren(undefined);
    expect(rootTopics).toHaveLength(1);
    expect(rootTopics[0]).toMatchObject({
      kind: 'topic',
      label: 'Project Knowledge',
      count: 2,
    });

    const entries = tree.getChildren(rootTopics[0]);
    expect(entries).toHaveLength(2);
    expect(entries.map(entry => ('relativePath' in entry ? entry.relativePath : ''))).toEqual([
      'notes/test-user-data.md',
      'notes/public-roadmap.md',
    ]);
  });

  it('test_privacy_surfaces_inbox_rejects_traversal', () => {
    const result = createCapture(
      '../test-classified-doc',
      'SYNTHETIC-SECRET-TOKEN',
      null,
      '2026-09-26T14:30:00Z',
      '../inbox'
    );
    expect(result).toEqual({ ok: false, reason: 'path_traversal' });
  });

  it('test_privacy_surfaces_inbox_rejects_absolute_path', () => {
    const absoluteResult = createCapture(
      'test-user-data',
      'SYNTHETIC-SECRET-TOKEN',
      null,
      '2026-09-26T14:30:00Z',
      '/var/inbox'
    );
    expect(absoluteResult).toEqual({ ok: false, reason: 'path_traversal' });

    const tildeResult = createCapture(
      'test-user-data',
      'SYNTHETIC-SECRET-TOKEN',
      null,
      '2026-09-26T14:30:00Z',
      '~/inbox'
    );
    expect(tildeResult).toMatchObject({ ok: true });
  });

  it('test_privacy_surfaces_policy_excludes_glob', () => {
    const policy = createPrivacyPolicy({
      roots: ['/tmp'],
      excludeGlobs: ['**/classified-*'],
    });

    const targetPath = '/tmp/classified-doc.md';
    const decision = policy.decide(targetPath);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('configured_exclusion');
    expect(policy.isAllowed(targetPath)).toBe(false);
  });

  it('test_privacy_surfaces_policy_permits_non_excluded', () => {
    const policy = createPrivacyPolicy({
      roots: ['/tmp'],
      excludeGlobs: ['**/classified-*'],
    });

    const targetPath = '/tmp/public-notes.md';
    const decision = policy.decide(targetPath);
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('allowed');
    expect(policy.isAllowed(targetPath)).toBe(true);
  });

  it('test_privacy_surfaces_policy_multiple_globs', () => {
    const policy = createPrivacyPolicy({
      roots: ['/tmp'],
      excludeGlobs: [
        '**/classified-*',
        '**/*.secret',
        '**/test-user-data/**',
      ],
    });

    expect(policy.isAllowed('/tmp/classified-doc.md')).toBe(false);
    expect(policy.isAllowed('/tmp/nested/classified-archive.md')).toBe(false);
    expect(policy.isAllowed('/tmp/keys/token.secret')).toBe(false);
    expect(policy.isAllowed('/tmp/test-user-data/preferences.json')).toBe(false);
    expect(policy.isAllowed('/tmp/notes/public-readme.md')).toBe(true);
  });

  it('test_privacy_surfaces_policy_nested_exclusion', () => {
    const policy = createPrivacyPolicy({
      roots: ['/tmp'],
      excludeGlobs: ['**/classified-*'],
    });

    const deeplyNestedPath =
      '/tmp/archive/2026/confidential/depth3/depth4/classified-doc.md';
    const decision = policy.decide(deeplyNestedPath);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('configured_exclusion');
    expect(policy.isAllowed(deeplyNestedPath)).toBe(false);
  });

  it('test_privacy_surfaces_source_entries_no_sensitive_content', () => {
    const tree = createSourceTree();
    const content = `## Sensitive Topic\n- [[confidential/classified-doc.md]]`;
    const topics = parseIndex(content);

    tree.refresh(
      topics,
      () => true,
      () => true
    );

    const rootTopics = tree.getChildren(undefined);
    const entries = tree.getChildren(rootTopics[0]);
    expect(entries).toHaveLength(1);

    const entry = entries[0];
    expect(entry).toEqual({
      kind: 'entry',
      label: 'classified-doc.md',
      relativePath: 'confidential/classified-doc.md',
      broken: false,
      topic: 'Sensitive Topic',
    });

    const entryRecord = entry as unknown as Record<string, unknown>;
    expect(entryRecord).not.toHaveProperty('content');
    expect(entryRecord).not.toHaveProperty('body');
    expect(entryRecord).not.toHaveProperty('text');
    expect(JSON.stringify(entry)).not.toContain('SYNTHETIC-SECRET-TOKEN');
  });

  it('test_privacy_surfaces_inbox_empty_title_rejected', () => {
    const emptyResult = createCapture(
      '',
      'SYNTHETIC-SECRET-TOKEN',
      null,
      '2026-09-26T14:30:00Z',
      'inbox'
    );
    expect(emptyResult).toEqual({ ok: false, reason: 'empty_title' });

    const whitespaceResult = createCapture(
      '   ',
      'SYNTHETIC-SECRET-TOKEN',
      null,
      '2026-09-26T14:30:00Z',
      'inbox'
    );
    expect(whitespaceResult).toEqual({ ok: false, reason: 'empty_title' });
  });
});
