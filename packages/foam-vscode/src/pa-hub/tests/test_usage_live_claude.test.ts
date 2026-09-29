import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  RATE_LIMITS_FILE,
  resolveClaudeStateDir,
  type ClaudeUsageState,
  watchClaudeUsage,
} from '../usage/claude';

let fixtureRoot: string;
let originalStateDir: string | undefined;
let activeWatchers: Array<{ dispose(): void }> = [];

beforeEach(() => {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-hub-live-claude-'));
  originalStateDir = process.env.PA_HUB_STATE_DIR;
  process.env.PA_HUB_STATE_DIR = fixtureRoot;
  activeWatchers = [];
});

afterEach(() => {
  for (const watcher of activeWatchers) {
    watcher.dispose();
  }
  if (originalStateDir === undefined) {
    delete process.env.PA_HUB_STATE_DIR;
  } else {
    process.env.PA_HUB_STATE_DIR = originalStateDir;
  }
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

function stateDir(): string {
  return resolveClaudeStateDir(
    {
      PA_HUB_STATE_DIR: process.env.PA_HUB_STATE_DIR,
      HOME: '/never-use-this-home',
    },
    () => '/never-use-this-home'
  );
}

function writeRateLimits(modelId: string): void {
  const target = path.join(stateDir(), RATE_LIMITS_FILE);
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(
    temporary,
    JSON.stringify({
      five_hour: { used_percentage: 42 },
      model: { id: modelId, display_name: 'Claude' },
      written_at: new Date().toISOString(),
    })
  );
  fs.renameSync(temporary, target);
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 3000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise<void>(resolve => setTimeout(resolve, 20));
  }
  if (!predicate()) {
    throw new Error(`timed out after ${timeoutMs} ms`);
  }
}

function hasModel(onState: ReturnType<typeof vi.fn>, modelId: string): boolean {
  return onState.mock.calls.some(([state]) => {
    const usageState = state as ClaudeUsageState;
    return (
      'observation' in usageState &&
      usageState.observation.model.id === modelId
    );
  });
}

describe('live Claude usage watcher', () => {
  it('test_usage_live_claude_fires_on_rate_limits_change', async () => {
    writeRateLimits('claude-before');
    const onState = vi.fn((_: ClaudeUsageState) => {});
    const watcher = watchClaudeUsage(stateDir(), onState, {
      pollMs: 10_000,
      debounceMs: 20,
      staleAfterMs: 60_000,
    });
    activeWatchers.push(watcher);

    await waitFor(() => onState.mock.calls.length === 1);
    expect(onState).toHaveBeenCalledTimes(1);
    writeRateLimits('claude-after');

    await waitFor(() => hasModel(onState, 'claude-after'));
    expect(onState).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'fresh',
        observation: expect.objectContaining({
          model: expect.objectContaining({ id: 'claude-after' }),
        }),
      })
    );
  });

  it('test_usage_live_claude_dispose_stops_updates', async () => {
    writeRateLimits('claude-before');
    const onState = vi.fn((_: ClaudeUsageState) => {});
    const watcher = watchClaudeUsage(stateDir(), onState, {
      pollMs: 10,
      debounceMs: 10,
    });
    activeWatchers.push(watcher);

    await waitFor(() => onState.mock.calls.length === 1);
    watcher.dispose();
    const callCount = onState.mock.calls.length;
    writeRateLimits('claude-after');
    await new Promise<void>(resolve => setTimeout(resolve, 120));

    expect(onState).toHaveBeenCalledTimes(callCount);
  });
});
