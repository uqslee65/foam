import { describe, expect, it } from 'vitest';
import { parseIndex } from '../sources';

describe('sources link parsing', () => {
  it('parses valid wiki and Markdown links', () => {
    const topics = parseIndex(
      '## References\n- [[docs/spec.md]]\n- [Guide](guides/guide.md)'
    );

    expect(topics).toEqual([
      {
        label: 'References',
        entries: [
          { relativePath: 'docs/spec.md', label: 'spec.md' },
          { relativePath: 'guides/guide.md', label: 'Guide' },
        ],
      },
    ]);
  });

  it('rejects a long repeating opener without pathological backtracking', () => {
    const content = `## References\n${'['.repeat(50_000)}x`;
    const start = performance.now();
    const topics = parseIndex(content);
    const elapsed = performance.now() - start;

    expect(topics).toEqual([{ label: 'References', entries: [] }]);
    expect(elapsed).toBeLessThan(100);
  });
});
