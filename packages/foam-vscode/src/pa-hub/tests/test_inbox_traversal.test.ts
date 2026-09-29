import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateFilename, parseNote, validateCapture } from '../inbox';

describe('inbox traversal and input hardening', () => {
  it('rejects traversal and absolute destinations outside the workspace', () => {
    expect(validateCapture('Valid Title', '../../etc')).toBe('path_traversal');
    expect(validateCapture('Valid Title', path.resolve(process.cwd(), '../../etc'))).toBe(
      'path_traversal'
    );
    expect(validateCapture('Valid Title', '/etc')).toBe('path_traversal');
  });

  it('accepts relative and absolute destinations inside the workspace', () => {
    const workspaceBase = path.resolve(process.cwd());

    expect(validateCapture('Valid Title', 'inbox')).toBeNull();
    expect(validateCapture('Valid Title', 'notes/inbox')).toBeNull();
    expect(validateCapture('Valid Title', path.join(workspaceBase, 'inbox'))).toBeNull();
  });

  it('rejects large unclosed frontmatter promptly', () => {
    const content = `---\n${'title: still open\n'.repeat(100_000)}`;
    const start = performance.now();

    expect(parseNote(content)).toBeNull();
    expect(performance.now() - start).toBeLessThan(500);
  });

  it('uses at least eight random characters in generated filenames', () => {
    const first = generateFilename('Same Title', '2026-09-26T14:30:00Z');
    const second = generateFilename('Same Title', '2026-09-26T14:30:00Z');

    expect(first).toMatch(/-[a-z0-9]{8}\.md$/);
    expect(second).toMatch(/-[a-z0-9]{8}\.md$/);
    expect(first).not.toBe(second);
  });
});
