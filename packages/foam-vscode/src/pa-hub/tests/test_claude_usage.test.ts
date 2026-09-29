import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  RATE_LIMITS_FILE,
  type ClaudeUsageObservation,
  type ClaudeUsageState,
  type UsageFs,
  parseSidecarPayload,
  readClaudeUsage,
  resolveClaudeStateDir,
  watchClaudeUsage,
} from '../usage/claude';

const SENTINEL = 'PA_HUB_SENTINEL_9f3a';

let fixtureRoot: string;
let activeWatchers: Array<{ dispose(): void }> = [];

beforeEach(() => {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-hub-usage-'));
  activeWatchers = [];
});

afterEach(() => {
  for (const watcher of activeWatchers) {
    watcher.dispose();
  }
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

function validPayload(
  now: number,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    five_hour: {
      used_percentage: 42.5,
      resets_at: 1_700_000_000,
    },
    seven_day: {
      used_percentage: 7,
      resets_at: 1_700_100_000,
    },
    model: {
      id: 'claude-x',
      display_name: 'Claude X',
    },
    written_at: new Date(now - 1000).toISOString(),
    ...extra,
  };
}

function writeAtomic(dir: string, payload: unknown): void {
  const target = path.join(dir, RATE_LIMITS_FILE);
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(payload));
  fs.renameSync(temporary, target);
}

function observationOf(
  result: ReturnType<typeof parseSidecarPayload>
): ClaudeUsageObservation {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error('expected a valid observation');
  }
  return result.observation;
}

function startWatcher(
  stateDir: string,
  states: ClaudeUsageState[],
  opts: Parameters<typeof watchClaudeUsage>[2] = {}
): { dispose(): void } {
  const watcher = watchClaudeUsage(stateDir, state => states.push(state), opts);
  activeWatchers.push(watcher);
  return watcher;
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

describe('Claude usage sidecar', () => {
  it('test_claude_usage_parse_valid_payload', () => {
    const now = 1_700_000_005_000;
    const observation = observationOf(
      parseSidecarPayload(validPayload(now), now)
    );

    expect(observation).toEqual({
      fiveHour: {
        usedPercentage: 42.5,
        resetsAt: 1_700_000_000_000,
        resetsInMs: 0,
      },
      sevenDay: {
        usedPercentage: 7,
        resetsAt: 1_700_100_000_000,
        resetsInMs: 99_995_000,
      },
      model: { id: 'claude-x', displayName: 'Claude X' },
      writtenAt: now - 1000,
      ageMs: 1000,
    });
  });

  it('test_claude_usage_parse_rejects_non_object', () => {
    for (const raw of [[], 'str', null, 42]) {
      const result = parseSidecarPayload(raw, Date.now());
      expect(result.ok).toBe(false);
      expect(result).toMatchObject({ ok: false, reason: 'schema' });
    }
  });

  it('test_claude_usage_parse_rejects_bad_written_at', () => {
    const missing = validPayload(Date.now());
    delete missing.written_at;
    for (const raw of [
      missing,
      validPayload(Date.now(), { written_at: 'not-a-date' }),
      validPayload(Date.now(), { written_at: 123 }),
    ]) {
      const result = parseSidecarPayload(raw, Date.now());
      expect(result).toMatchObject({ ok: false, reason: 'schema' });
    }
  });

  it('test_claude_usage_parse_coerces_windows', () => {
    const now = Date.now();
    const missingSeven = validPayload(now);
    missingSeven.five_hour = null;
    delete missingSeven.seven_day;
    const observation = observationOf(
      parseSidecarPayload(missingSeven, now)
    );
    expect(observation.fiveHour).toBeNull();
    expect(observation.sevenDay).toBeNull();

    expect(
      observationOf(
        parseSidecarPayload(
          validPayload(now, {
            five_hour: { used_percentage: 250 },
          }),
          now
        )
      ).fiveHour?.usedPercentage
    ).toBe(100);
    expect(
      observationOf(
        parseSidecarPayload(
          validPayload(now, {
            five_hour: { used_percentage: -3 },
          }),
          now
        )
      ).fiveHour?.usedPercentage
    ).toBe(0);
    expect(
      observationOf(
        parseSidecarPayload(
          validPayload(now, {
            five_hour: { used_percentage: '12' },
          }),
          now
        )
      ).fiveHour?.usedPercentage
    ).toBeNull();

    const invalidReset = observationOf(
      parseSidecarPayload(
        validPayload(now, {
          five_hour: { resets_at: 'x' },
        }),
        now
      )
    );
    expect(invalidReset.fiveHour).toMatchObject({
      resetsAt: null,
      resetsInMs: null,
    });

    for (const value of ['str', []]) {
      expect(
        parseSidecarPayload(validPayload(now, { five_hour: value }), now)
      ).toMatchObject({ ok: false, reason: 'schema' });
    }
  });

  it('test_claude_usage_parse_caps_model_strings', () => {
    const now = Date.now();
    const longId = 'x'.repeat(100_000);
    const capped = observationOf(
      parseSidecarPayload(
        validPayload(now, {
          model: { id: longId, display_name: 7 },
        }),
        now
      )
    );
    expect(capped.model.id).toBe(longId.slice(0, 128));
    expect(capped.model.id).toHaveLength(128);
    expect(capped.model.displayName).toBe('');

    expect(
      observationOf(parseSidecarPayload(validPayload(now, { model: undefined }), now))
        .model
    ).toEqual({ id: '', displayName: '' });
    expect(
      observationOf(parseSidecarPayload(validPayload(now, { model: 'str' }), now))
        .model
    ).toEqual({ id: '', displayName: '' });
  });

  it('test_claude_usage_parse_reset_seconds_to_ms', () => {
    const resetAt = 1_700_000_000_000;
    const before = observationOf(
      parseSidecarPayload(
        validPayload(resetAt - 5000, {
          five_hour: { resets_at: 1_700_000_000 },
        }),
        resetAt - 5000
      )
    );
    expect(before.fiveHour).toMatchObject({
      resetsAt: resetAt,
      resetsInMs: 5000,
    });

    const after = observationOf(
      parseSidecarPayload(
        validPayload(resetAt + 1, {
          five_hour: { resets_at: 1_700_000_000 },
        }),
        resetAt + 1
      )
    );
    expect(after.fiveHour?.resetsInMs).toBe(0);

    const noReset = observationOf(
      parseSidecarPayload(
        validPayload(resetAt, { five_hour: { resets_at: null } }),
        resetAt
      )
    );
    expect(noReset.fiveHour).toMatchObject({
      resetsAt: null,
      resetsInMs: null,
    });
  });

  it('test_claude_usage_read_missing_dir', () => {
    expect(readClaudeUsage(path.join(fixtureRoot, 'nope'))).toEqual({
      status: 'missing',
      reason: 'no-dir',
    });
  });

  it('test_claude_usage_read_missing_file', () => {
    const dir = path.join(fixtureRoot, 'empty');
    fs.mkdirSync(dir);
    expect(readClaudeUsage(dir)).toEqual({
      status: 'missing',
      reason: 'no-file',
    });
  });

  it('test_claude_usage_read_invalid_json', () => {
    fs.writeFileSync(path.join(fixtureRoot, RATE_LIMITS_FILE), '{nope');
    const state = readClaudeUsage(fixtureRoot);
    expect(state).toMatchObject({ status: 'invalid', reason: 'parse' });
    if (state.status !== 'invalid') {
      throw new Error('expected invalid Claude usage state');
    }
    expect(state.detail).toBeTruthy();
  });

  it('test_claude_usage_read_schema_error', () => {
    fs.writeFileSync(path.join(fixtureRoot, RATE_LIMITS_FILE), '[]');
    expect(readClaudeUsage(fixtureRoot)).toMatchObject({
      status: 'invalid',
      reason: 'schema',
    });
  });

  it('test_claude_usage_read_fresh_vs_stale', () => {
    const now = 1_700_000_000_000;
    const file = path.join(fixtureRoot, RATE_LIMITS_FILE);

    fs.writeFileSync(file, JSON.stringify(validPayload(now, {})));
    const fresh = readClaudeUsage(fixtureRoot, {
      now,
      staleAfterMs: 10_000,
    });
    expect(fresh.status).toBe('fresh');
    if (fresh.status !== 'fresh') {
      throw new Error('expected fresh Claude usage state');
    }
    expect(fresh.observation.ageMs).toBe(1000);

    fs.writeFileSync(
      file,
      JSON.stringify(validPayload(now - 19_000, {}))
    );
    const stale = readClaudeUsage(fixtureRoot, {
      now,
      staleAfterMs: 10_000,
    });
    expect(stale.status).toBe('stale');
    if (stale.status !== 'stale') {
      throw new Error('expected stale Claude usage state');
    }
    expect(stale.observation.ageMs).toBe(20_000);

    fs.writeFileSync(
      file,
      JSON.stringify(validPayload(now + 61_000, {}))
    );
    const clockSkew = readClaudeUsage(fixtureRoot, {
      now,
      staleAfterMs: 10_000,
    });
    expect(clockSkew.status).toBe('fresh');
    if (clockSkew.status !== 'fresh') {
      throw new Error('expected fresh Claude usage state');
    }
    expect(clockSkew.observation.ageMs).toBe(0);
  });

  it('test_claude_usage_read_only_touches_rate_limits_file', () => {
    for (const name of [
      'credentials.json',
      'stats-cache.json',
      'mcp-discover-verdicts.json',
    ]) {
      fs.writeFileSync(path.join(fixtureRoot, name), SENTINEL);
    }
    fs.writeFileSync(
      path.join(fixtureRoot, RATE_LIMITS_FILE),
      JSON.stringify(validPayload(Date.now()))
    );
    const recorded: string[] = [];
    const recordingFs = {
      existsSync: (target: fs.PathLike) => fs.existsSync(target),
      readFileSync: (target: fs.PathLike, encoding: BufferEncoding) => {
        recorded.push(path.basename(String(target)));
        return fs.readFileSync(target, encoding);
      },
      watch: fs.watch.bind(fs),
    } as unknown as UsageFs;

    const state = readClaudeUsage(fixtureRoot, { fs: recordingFs });
    expect(state.status).toBe('fresh');
    expect(recorded).toEqual([RATE_LIMITS_FILE]);
    expect(JSON.stringify(state)).not.toContain(SENTINEL);
  });

  it('test_claude_usage_watch_detects_atomic_replace', async () => {
    const now = Date.now();
    writeAtomic(fixtureRoot, validPayload(now));
    const states: ClaudeUsageState[] = [];
    startWatcher(fixtureRoot, states, {
      pollMs: 10_000,
      debounceMs: 20,
      staleAfterMs: 60_000,
    });
    expect(states).toHaveLength(1);
    expect(states[0]?.status).toBe('fresh');

    writeAtomic(
      fixtureRoot,
      validPayload(Date.now(), {
        model: { id: 'claude-second', display_name: 'Claude X' },
      })
    );
    await waitFor(
      () =>
        states.some(
          state =>
            'observation' in state &&
            state.observation.model.id === 'claude-second'
        )
    );
  });

  it('test_claude_usage_watch_survives_missing_dir', async () => {
    const stateDir = path.join(fixtureRoot, 'missing');
    const states: ClaudeUsageState[] = [];
    startWatcher(stateDir, states, { pollMs: 20 });
    expect(states[0]).toEqual({ status: 'missing', reason: 'no-dir' });

    fs.mkdirSync(stateDir);
    writeAtomic(stateDir, validPayload(Date.now()));
    await waitFor(
      () => states.some(state => state.status === 'fresh')
    );
  });

  it('test_claude_usage_watch_dispose_stops', async () => {
    writeAtomic(fixtureRoot, validPayload(Date.now()));
    const states: ClaudeUsageState[] = [];
    const watcher = startWatcher(fixtureRoot, states, {
      pollMs: 20,
      debounceMs: 20,
    });
    watcher.dispose();
    const count = states.length;
    writeAtomic(
      fixtureRoot,
      validPayload(Date.now(), {
        model: { id: 'claude-after-dispose', display_name: 'Claude X' },
      })
    );
    await new Promise<void>(resolve => setTimeout(resolve, 150));
    expect(states).toHaveLength(count);
  });

  it('test_claude_usage_watch_emits_stale_transition', async () => {
    const now = Date.now();
    writeAtomic(fixtureRoot, validPayload(now + 900));
    const states: ClaudeUsageState[] = [];
    startWatcher(fixtureRoot, states, {
      pollMs: 10_000,
      staleAfterMs: 200,
    });
    expect(states[0]?.status).toBe('fresh');
    await waitFor(
      () =>
        states.some(
          state =>
            state.status === 'stale' && state.observation.ageMs >= 200
        )
    );
  });

  it('test_claude_usage_watch_error_falls_back_to_polling', async () => {
    writeAtomic(fixtureRoot, validPayload(Date.now()));
    const fakeWatcher = new EventEmitter() as EventEmitter & {
      close(): void;
    };
    fakeWatcher.close = () => {};
    const injectedFs = {
      existsSync: (target: fs.PathLike) => fs.existsSync(target),
      readFileSync: fs.readFileSync,
      watch: (() => fakeWatcher) as unknown as UsageFs['watch'],
    } as unknown as UsageFs;
    const states: ClaudeUsageState[] = [];
    startWatcher(fixtureRoot, states, {
      fs: injectedFs,
      pollMs: 20,
      debounceMs: 20,
    });

    expect(() => fakeWatcher.emit('error', new Error('watcher'))).not.toThrow();
    writeAtomic(
      fixtureRoot,
      validPayload(Date.now(), {
        model: { id: 'claude-polled', display_name: 'Claude X' },
      })
    );
    await waitFor(
      () =>
        states.some(
          state =>
            'observation' in state &&
            state.observation.model.id === 'claude-polled'
        )
    );
  });

  it('test_claude_usage_resolve_state_dir_env_precedence', () => {
    expect(
      resolveClaudeStateDir({ PA_HUB_STATE_DIR: '/x/state' }, () => '/h')
    ).toBe('/x/state');
    expect(
      resolveClaudeStateDir({ HOME: '/home/u' }, () => '/h')
    ).toBe(path.join('/home/u', '.claude', 'state'));
    expect(resolveClaudeStateDir({}, () => '/h')).toBe(
      path.join('/h', '.claude', 'state')
    );
    expect(
      resolveClaudeStateDir({ PA_HUB_STATE_DIR: '', HOME: '/home/u' }, () => '/h')
    ).toBe(path.join('/home/u', '.claude', 'state'));
  });
});
