import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createSourceTree, parseIndex } from '../sources';

describe('sources async refresh', () => {
  it('returns a Promise and waits for async file checks', async () => {
    const tree = createSourceTree();
    const topics = parseIndex('## Topic\n- [[note.md]]');
    let resolveFileCheck!: (exists: boolean) => void;
    const fileCheck = new Promise<boolean>(resolve => {
      resolveFileCheck = resolve;
    });

    const refresh = tree.refresh(topics, () => fileCheck, () => true);

    expect(refresh).toBeInstanceOf(Promise);
    expect(tree.getChildren()).toEqual([]);

    resolveFileCheck(false);
    await refresh;

    const [topic] = tree.getChildren();
    expect(topic).toMatchObject({ kind: 'topic', label: 'Topic', count: 1 });
    expect(tree.getChildren(topic)[0]).toMatchObject({
      relativePath: 'note.md',
      broken: true,
    });
  });

  it('does not use synchronous filesystem APIs', async () => {
    const source = await readFile(
      fileURLToPath(new URL('../sources.ts', import.meta.url)),
      'utf8'
    );

    expect(source).not.toMatch(/(?:readFile|readdir|stat|exists|access|mkdir|writeFile|unlink|rm|rename|copyFile)Sync/);
  });
});
