import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readPdcaCycles } from '../history';

describe('readPdcaCycles async I/O', () => {
  it('returns a Promise', () => {
    expect(readPdcaCycles('/path/that/does/not/exist')).toBeInstanceOf(Promise);
  });

  it('does not use synchronous filesystem calls', async () => {
    const source = await readFile(
      fileURLToPath(new URL('../history.ts', import.meta.url)),
      'utf8'
    );

    expect(source).not.toMatch(/fs\.(readdirSync|readFileSync)/);
  });
});
