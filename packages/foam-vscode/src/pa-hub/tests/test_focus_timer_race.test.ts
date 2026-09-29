import { describe, expect, it, vi } from 'vitest';
import { watchFocusFile } from '../focus';
import type { FocusFs } from '../focus';

describe('focus watcher timer disposal', () => {
  it('does not reattach after disposal races the reattach timer', () => {
    const pendingTimers: Array<() => void> = [];
    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(callback => {
        pendingTimers.push(() => callback());
        return { unref: vi.fn() } as unknown as ReturnType<typeof setTimeout>;
      });
    const clearTimeoutSpy = vi
      .spyOn(globalThis, 'clearTimeout')
      .mockImplementation(() => undefined);

    try {
      let onError: ((error: unknown) => void) | undefined;
      const close = vi.fn();
      const watchDir = vi.fn(
        (
          _dir: string,
          _onChange: () => void,
          onWatcherError: (error: unknown) => void
        ) => {
          onError = onWatcherError;
          return { close };
        }
      );
      const fs: FocusFs = {
        readFile: async () => null,
        watchDir,
      };

      const watcher = watchFocusFile({
        dir: '/workspace',
        filename: 'focus.json',
        fs,
        workspaceId: 'workspace-a',
        onRequest: vi.fn(),
      });

      onError?.(new Error('watch failed'));
      expect(pendingTimers).toHaveLength(1);

      watcher.dispose();
      pendingTimers[0]();

      expect(watchDir).toHaveBeenCalledOnce();
      expect(close).toHaveBeenCalledOnce();
      expect(clearTimeoutSpy).toHaveBeenCalledOnce();
    } finally {
      setTimeoutSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
    }
  });
});
