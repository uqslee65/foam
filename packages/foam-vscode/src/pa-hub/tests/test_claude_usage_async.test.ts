import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readClaudeUsage } from '../usage/claude';

describe('Claude usage async I/O', () => {
  it('test_claude_usage_async_returns_promise', async () => {
    const result = readClaudeUsage('/path/that/does/not/exist');

    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.toEqual({
      status: 'missing',
      reason: 'no-dir',
    });
  });

  it('test_claude_usage_async_has_no_sync_filesystem_calls', async () => {
    const source = await readFile(
      fileURLToPath(new URL('../usage/claude.ts', import.meta.url)),
      'utf8'
    );

    expect(source).not.toMatch(/existsSync|readFileSync/);
  });
});
