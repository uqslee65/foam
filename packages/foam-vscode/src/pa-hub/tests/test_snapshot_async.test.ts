import { describe, expect, it } from 'vitest';
import { snapshotFromFiles } from '../tasks/snapshot';

describe('async task snapshots', () => {
  it('returns a Promise', () => {
    const result = snapshotFromFiles(
      ['2026-09-29.md'],
      async () => '- [ ] Async task',
      () => 'rev-1'
    );

    expect(result).toBeInstanceOf(Promise);
  });

  it('processes content from an async callback', async () => {
    const result = await snapshotFromFiles(
      ['2026-09-28.md', '2026-09-29.md'],
      async filename => {
        await Promise.resolve();
        return filename === '2026-09-29.md'
          ? '- [ ] Async task <!-- id:t-async -->'
          : null;
      },
      filename => `revision:${filename}`
    );

    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        filename: '2026-09-29.md',
        revision: 'revision:2026-09-29.md',
        tasks: [
          expect.objectContaining({
            text: 'Async task',
            id: 't-async',
          }),
        ],
      },
    });
  });

  it('handles a null result from the async callback', async () => {
    const result = await snapshotFromFiles(
      ['2026-09-29.md'],
      async () => null,
      () => 'rev-1'
    );

    expect(result).toEqual({ ok: false, reason: 'no_valid_file' });
  });
});
