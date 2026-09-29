import { describe, expect, it, vi } from 'vitest';
import { createSnapshot } from '../tasks/snapshot';
import { createTaskWriter, type TaskWriteFs } from '../tasks/write';

const dir = 'daily';
const filename = '2026-09-29.md';
const targetPath = `${dir}/${filename}`;
const content =
  '- [ ] First task <!-- id:t-first -->\n- [ ] Other task <!-- id:t-other -->';

function createFs() {
  let temporaryContent: string | undefined;
  let fileContent = content;
  const readFile = vi.fn(async (path: string): Promise<string | null> => {
    expect(path).toBe(targetPath);
    return fileContent;
  });

  const fs: TaskWriteFs = {
    listDir: vi.fn(async () => [filename]),
    readFile,
    stat: vi.fn(async () => ({ revision: 'rev-1', mode: 0o640 })),
    writeFile: vi.fn(async (_path, nextContent) => {
      temporaryContent = nextContent;
    }),
    rename: vi.fn(async () => {
      fileContent = temporaryContent ?? fileContent;
    }),
  };

  return { fs, readFile };
}

function createTestSnapshot() {
  return createSnapshot(filename, 'rev-1', content);
}

describe('task writer redundant I/O', () => {
  it('reads the source once for doMutate operations', async () => {
    const { fs, readFile } = createFs();
    const snapshot = createTestSnapshot();

    const result = await createTaskWriter(fs).move(
      dir,
      snapshot,
      't-first',
      'down'
    );

    expect(result.ok).toBe(true);
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it('reads the source once for toggle operations', async () => {
    const { fs, readFile } = createFs();
    const snapshot = createTestSnapshot();

    const result = await createTaskWriter(fs).toggle(
      dir,
      snapshot,
      't-first',
      true
    );

    expect(result.ok).toBe(true);
    expect(readFile).toHaveBeenCalledTimes(1);
  });
});
