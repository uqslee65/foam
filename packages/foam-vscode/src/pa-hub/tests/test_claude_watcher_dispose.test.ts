import { describe, expect, it, vi } from 'vitest';
import { type UsageFs, watchClaudeUsage } from '../usage/claude';

const USAGE_PAYLOAD = JSON.stringify({
  five_hour: null,
  seven_day: null,
  model: { id: 'claude-test', display_name: 'Claude Test' },
  written_at: new Date().toISOString(),
});

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

function createUsageFs(
  readFile: (file: string, encoding: BufferEncoding) => Promise<string>
): {
  fs: UsageFs;
  close: ReturnType<typeof vi.fn>;
  watch: ReturnType<typeof vi.fn>;
} {
  const close = vi.fn();
  const watcher = {
    close,
    on: vi.fn(),
  };
  const watch = vi.fn(() => watcher);
  const fs = {
    promises: {
      access: vi.fn().mockResolvedValue(undefined),
      readFile,
    },
    watch,
  } as unknown as UsageFs;

  return { fs, close, watch };
}

describe('Claude usage watcher lifecycle', () => {
  it('disposes the filesystem watcher when the monitor is disposed', async () => {
    const fake = createUsageFs(vi.fn(async () => USAGE_PAYLOAD));
    const monitor = watchClaudeUsage('/state', vi.fn(), {
      fs: fake.fs,
      pollMs: 60_000,
    });

    try {
      await flushMicrotasks();
      expect(fake.watch).toHaveBeenCalledTimes(1);

      monitor.dispose();

      expect(fake.close).toHaveBeenCalledTimes(1);
    } finally {
      monitor.dispose();
    }
  });

  it('skips interval ticks while a usage read is in flight', async () => {
    vi.useFakeTimers();
    let activeReads = 0;
    let maxActiveReads = 0;
    let readCount = 0;
    let releaseRead: (() => void) | undefined;
    const readFile = vi.fn(
      async (_file: string, _encoding: BufferEncoding): Promise<string> => {
        readCount += 1;
        activeReads += 1;
        maxActiveReads = Math.max(maxActiveReads, activeReads);
        if (readCount === 1) {
          activeReads -= 1;
          return USAGE_PAYLOAD;
        }

        await new Promise<void>(resolve => {
          releaseRead = resolve;
        });
        activeReads -= 1;
        return USAGE_PAYLOAD;
      }
    );
    const fake = createUsageFs(readFile);
    const monitor = watchClaudeUsage('/state', vi.fn(), {
      fs: fake.fs,
      pollMs: 100,
      staleAfterMs: 60_000,
    });

    try {
      await flushMicrotasks();
      expect(readFile).toHaveBeenCalledTimes(1);
      expect(activeReads).toBe(0);

      vi.advanceTimersByTime(200);
      await flushMicrotasks();

      expect(readFile).toHaveBeenCalledTimes(2);
      expect(activeReads).toBe(1);
      expect(maxActiveReads).toBe(1);
    } finally {
      releaseRead?.();
      await flushMicrotasks();
      monitor.dispose();
      vi.useRealTimers();
    }
  });
});
