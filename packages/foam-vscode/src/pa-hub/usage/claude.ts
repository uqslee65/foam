import * as fs from 'node:fs';
import * as path from 'node:path';

export const RATE_LIMITS_FILE = 'rate_limits.json';
export const CLAUDE_USAGE_STALE_AFTER_MS = 10 * 60_000;
export const MAX_MODEL_STRING_LENGTH = 128;
export const CLAUDE_USAGE_POLL_MS = 5_000;
export const CLAUDE_USAGE_DEBOUNCE_MS = 50;

type UsageFsPromises = Pick<typeof fs.promises, 'access' | 'readFile'>;

export type UsageFs = Pick<typeof import('node:fs'), 'watch'> & {
  promises?: UsageFsPromises;
};

export function resolveClaudeStateDir(
  env: { PA_HUB_STATE_DIR?: string; HOME?: string },
  homedir: () => string
): string {
  if (env.PA_HUB_STATE_DIR) {
    return env.PA_HUB_STATE_DIR;
  }

  return path.join(env.HOME || homedir(), '.claude', 'state');
}

export interface RateWindow {
  usedPercentage: number | null;
  resetsAt: number | null;
  resetsInMs: number | null;
}

export interface ClaudeUsageObservation {
  fiveHour: RateWindow | null;
  sevenDay: RateWindow | null;
  model: { id: string; displayName: string };
  writtenAt: number;
  ageMs: number;
}

export type ClaudeUsageState =
  | { status: 'missing'; reason: 'no-dir' | 'no-file' }
  | { status: 'invalid'; reason: 'parse' | 'schema' | 'io'; detail: string }
  | { status: 'stale' | 'fresh'; observation: ClaudeUsageObservation };

type ParseResult =
  | { ok: true; observation: ClaudeUsageObservation }
  | { ok: false; reason: 'schema'; detail: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function schemaError(key: string): ParseResult {
  return { ok: false, reason: 'schema', detail: `invalid ${key}` };
}

function parseWindow(
  payload: Record<string, unknown>,
  key: 'five_hour' | 'seven_day',
  now: number
): RateWindow | null | ParseResult {
  const value = payload[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (!isPlainObject(value)) {
    return schemaError(key);
  }

  const usedPercentage =
    typeof value.used_percentage === 'number' &&
    Number.isFinite(value.used_percentage)
      ? Math.min(100, Math.max(0, value.used_percentage))
      : null;
  const rawResetsAt =
    typeof value.resets_at === 'number' && Number.isFinite(value.resets_at)
      ? value.resets_at
      : null;
  const resetsAt =
    rawResetsAt === null || !Number.isFinite(rawResetsAt * 1000)
      ? null
      : rawResetsAt * 1000;

  return {
    usedPercentage,
    resetsAt,
    resetsInMs: resetsAt === null ? null : Math.max(0, resetsAt - now),
  };
}

export function parseSidecarPayload(raw: unknown, now: number): ParseResult {
  if (!isPlainObject(raw)) {
    return schemaError('payload');
  }

  const writtenAtValue = raw.written_at;
  if (
    typeof writtenAtValue !== 'string' ||
    !Number.isFinite(Date.parse(writtenAtValue))
  ) {
    return schemaError('written_at');
  }

  const fiveHour = parseWindow(raw, 'five_hour', now);
  if (!isRateWindowOrNull(fiveHour)) {
    return fiveHour;
  }
  const sevenDay = parseWindow(raw, 'seven_day', now);
  if (!isRateWindowOrNull(sevenDay)) {
    return sevenDay;
  }

  const model = isPlainObject(raw.model) ? raw.model : {};
  const id = typeof model.id === 'string' ? model.id : '';
  const displayName =
    typeof model.display_name === 'string' ? model.display_name : '';
  const writtenAt = Date.parse(writtenAtValue);

  return {
    ok: true,
    observation: {
      fiveHour,
      sevenDay,
      model: {
        id: id.slice(0, MAX_MODEL_STRING_LENGTH),
        displayName: displayName.slice(0, MAX_MODEL_STRING_LENGTH),
      },
      writtenAt,
      ageMs: Math.max(0, now - writtenAt),
    },
  };
}

function isRateWindowOrNull(
  value: RateWindow | null | ParseResult
): value is RateWindow | null {
  return !isParseError(value);
}

function isParseError(
  value: RateWindow | null | ParseResult
): value is { ok: false; reason: 'schema'; detail: string } {
  return value !== null && 'ok' in value && value.ok === false;
}

function errorDetail(error: unknown): string {
  if (isPlainObject(error) && typeof error.code === 'string') {
    return error.code;
  }
  if (isPlainObject(error) && typeof error.message === 'string') {
    return error.message;
  }
  return String(error);
}

export async function readClaudeUsage(
  stateDir: string,
  opts: {
    now?: number;
    staleAfterMs?: number;
    fs?: UsageFs;
  } = {}
): Promise<ClaudeUsageState> {
  const file = path.join(stateDir, RATE_LIMITS_FILE);
  const fileSystem = opts.fs ?? fs;
  const filePromises = fileSystem.promises ?? fs.promises;
  try {
    await filePromises.access(stateDir);
  } catch (error) {
    return { status: 'missing', reason: 'no-dir' };
  }

  let raw: string;
  try {
    raw = await filePromises.readFile(file, 'utf8');
  } catch (error) {
    if (isPlainObject(error) && error.code === 'ENOENT') {
      return { status: 'missing', reason: 'no-file' };
    }
    return { status: 'invalid', reason: 'io', detail: errorDetail(error) };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    return { status: 'invalid', reason: 'parse', detail: errorDetail(error) };
  }

  const parsed = parseSidecarPayload(payload, opts.now ?? Date.now());
  if (parsed.ok === false) {
    return { status: 'invalid', reason: 'schema', detail: parsed.detail };
  }

  const staleAfterMs = opts.staleAfterMs ?? CLAUDE_USAGE_STALE_AFTER_MS;
  return {
    status:
      parsed.observation.ageMs > staleAfterMs ? 'stale' : 'fresh',
    observation: parsed.observation,
  };
}

type UsageWatcher = ReturnType<UsageFs['watch']>;
type Timer = ReturnType<typeof setTimeout>;

function unrefTimer(timer: Timer | ReturnType<typeof setInterval>): void {
  const candidate = timer as unknown as { unref?: () => void };
  candidate.unref?.();
}

function stateKey(state: ClaudeUsageState): string {
  const observation =
    'observation' in state ? state.observation : undefined;
  return JSON.stringify({
    status: state.status,
    reason: 'reason' in state ? state.reason : undefined,
    detail: 'detail' in state ? state.detail : undefined,
    observation:
      observation === undefined
        ? undefined
        : {
            fiveHour: observation.fiveHour
              ? {
                  usedPercentage: observation.fiveHour.usedPercentage,
                  resetsAt: observation.fiveHour.resetsAt,
                }
              : null,
            sevenDay: observation.sevenDay
              ? {
                  usedPercentage: observation.sevenDay.usedPercentage,
                  resetsAt: observation.sevenDay.resetsAt,
                }
              : null,
            model: observation.model,
            writtenAt: observation.writtenAt,
          },
  });
}

export function watchClaudeUsage(
  stateDir: string,
  onState: (state: ClaudeUsageState) => void,
  opts: {
    now?: () => number;
    staleAfterMs?: number;
    pollMs?: number;
    debounceMs?: number;
    fs?: UsageFs;
  } = {}
): { dispose(): void } {
  const fileSystem = opts.fs ?? fs;
  const now = opts.now ?? (() => Date.now());
  const staleAfterMs = opts.staleAfterMs ?? CLAUDE_USAGE_STALE_AFTER_MS;
  const pollMs = opts.pollMs ?? CLAUDE_USAGE_POLL_MS;
  const debounceMs = opts.debounceMs ?? CLAUDE_USAGE_DEBOUNCE_MS;
  let disposed = false;
  let watcher: UsageWatcher | null = null;
  let debounceTimer: Timer | null = null;
  let staleTimer: Timer | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let watcherAttachInFlight = false;

  let lastKey: string | null = null;

  function clearDebounceTimer(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }

  function clearStaleTimer(): void {
    if (staleTimer !== null) {
      clearTimeout(staleTimer);
      staleTimer = null;
    }
  }

  function armStaleTimer(state: ClaudeUsageState): void {
    clearStaleTimer();
    if (state.status !== 'fresh' || disposed) {
      return;
    }

    const delay =
      staleAfterMs - state.observation.ageMs + 1;
    staleTimer = setTimeout(() => {
      staleTimer = null;
      if (!disposed) {
        void refresh();
      }
    }, delay);
    unrefTimer(staleTimer);
  }

  async function refresh(): Promise<void> {
    if (disposed) {
      return;
    }

    const state = await readClaudeUsage(stateDir, {
      now: now(),
      staleAfterMs,
      fs: fileSystem,
    });
    if (disposed) {
      return;
    }
    const nextKey = stateKey(state);
    if (lastKey === null || nextKey !== lastKey) {
      lastKey = nextKey;
      onState(state);
    }
    armStaleTimer(state);
  }

  function scheduleRefresh(): void {
    if (disposed) {
      return;
    }
    clearDebounceTimer();
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (!disposed) {
        void refresh();
      }
    }, debounceMs);
    unrefTimer(debounceTimer);
  }

  function handleWatcherError(target: UsageWatcher): void {
    if (disposed) {
      return;
    }
    try {
      target.close();
    } catch {
      // The watcher is already unusable; polling remains the safety net.
    }
    if (watcher === target) {
      watcher = null;
      scheduleRefresh();
    }
  }

  async function attachWatcher(): Promise<void> {
    if (disposed || watcher !== null || watcherAttachInFlight) {
      return;
    }

    watcherAttachInFlight = true;
    try {
      const filePromises = fileSystem.promises ?? fs.promises;
      await filePromises.access(stateDir);
      if (disposed || watcher !== null) {
        return;
      }
      const nextWatcher = fileSystem.watch(
        stateDir,
        { persistent: false },
        () => scheduleRefresh()
      );
      watcher = nextWatcher;
      nextWatcher.on('error', () => handleWatcherError(nextWatcher));
    } catch {
      if (watcher !== null) {
        try {
          watcher.close();
        } catch {
          // Polling remains the safety net.
        }
        watcher = null;
      }
    } finally {
      watcherAttachInFlight = false;
    }
  }

  function dispose(): void {
    if (disposed) {
      return;
    }
    disposed = true;
    if (watcher !== null) {
      try {
        watcher.close();
      } catch {
        // Disposal is best effort for a watcher that has already failed.
      }
      watcher = null;
    }
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    clearDebounceTimer();
    clearStaleTimer();
  }

  void refresh();
  void attachWatcher();
  pollTimer = setInterval(() => {
    if (disposed) {
      return;
    }
    void refresh();
    if (watcher === null) {
      void attachWatcher();
    }
  }, pollMs);
  unrefTimer(pollTimer);

  return { dispose };
}
