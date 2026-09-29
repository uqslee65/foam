// @ts-expect-error The graph-view package publishes its runtime protocol as ESM while this package type-checks as CommonJS.
import { isNodeId } from '@foam/graph-view/protocol';
import type { NodeId } from '@foam/graph-view/protocol' with { 'resolution-mode': 'import' };
import type { FocusRequest } from '@foam/graph-view/protocol' with { 'resolution-mode': 'import' };

export type FocusFilePayload =
  | { ok: true; request: FocusRequest }
  | { ok: false; reason: FocusParseError };

export type FocusParseError =
  | 'invalid_shape'
  | 'wrong_workspace'
  | 'invalid_node_id'
  | 'missing_request_id';

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function parseFocusFilePayload(
  input: unknown,
  expected: { workspaceId: string }
): FocusFilePayload {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, reason: 'invalid_shape' };
  }

  const payload = input as Record<string, unknown>;
  if (
    typeof payload.workspace !== 'string' ||
    typeof payload.requestId !== 'string' ||
    typeof payload.nodeId !== 'string'
  ) {
    return { ok: false, reason: 'invalid_shape' };
  }

  if (payload.workspace !== expected.workspaceId) {
    return { ok: false, reason: 'wrong_workspace' };
  }

  if (payload.requestId.length === 0) {
    return { ok: false, reason: 'missing_request_id' };
  }

  if (!isNodeId(payload.nodeId)) {
    return { ok: false, reason: 'invalid_node_id' };
  }

  if (hasOwn(payload, 'center') && typeof payload.center !== 'boolean') {
    return { ok: false, reason: 'invalid_shape' };
  }

  const request: FocusRequest = {
    requestId: payload.requestId,
    nodeId: payload.nodeId as NodeId,
  };
  if (hasOwn(payload, 'center')) {
    request.center = payload.center as boolean;
  }

  return { ok: true, request };
}

export class FocusQueue {
  private readonly maxSeen: number;
  private queue: FocusRequest[] = [];
  private ready = false;
  private seen: string[] = [];

  constructor(options?: { maxSeen?: number }) {
    const maxSeen = options?.maxSeen ?? 1000;
    this.maxSeen =
      typeof maxSeen === 'number' && Number.isFinite(maxSeen)
        ? Math.max(1, Math.floor(maxSeen))
        : 1000;
  }

  enqueue(request: FocusRequest): void {
    if (
      this.seen.includes(request.requestId) ||
      this.queue.some(item => item.requestId === request.requestId)
    ) {
      return;
    }

    if (this.ready) {
      this.queue.push(request);
    } else {
      this.queue = [request];
    }
  }

  markReady(): void {
    this.ready = true;
  }

  markNotReady(): void {
    if (this.queue.length === 0) {
      return;
    }

    this.ready = false;
    if (this.queue.length > 1) {
      this.queue = [this.queue[this.queue.length - 1]];
    }
  }

  drain(): FocusRequest[] {
    const drained = this.queue;
    this.queue = [];
    for (const request of drained) {
      this.markSeen(request.requestId);
    }
    return drained;
  }

  markSeen(requestId: string): void {
    if (this.seen.includes(requestId)) {
      return;
    }

    this.seen.push(requestId);
    if (this.seen.length > this.maxSeen) {
      this.seen = this.seen.slice(Math.floor(this.seen.length / 2));
    }
  }

  get pending(): number {
    return this.queue.length;
  }
}

export interface FocusFs {
  readFile(path: string): Promise<string | null>;
  watchDir(
    dir: string,
    onChange: () => void,
    onError: (err: unknown) => void
  ): { close(): void };
}

export interface WatchFocusFileOptions {
  dir: string;
  filename: string;
  fs: FocusFs;
  workspaceId: string;
  onRequest: (request: FocusRequest) => void;
}

const focusWatchReattachDelayMs = 1000;

export function watchFocusFile(
  options: WatchFocusFileOptions
): { dispose(): void } {
  const filePath = `${options.dir}/${options.filename}`;
  const seen = new Set<string>();
  let watcher: { close(): void } | undefined;
  let reattachTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let reading = false;

  async function readRequest(startup: boolean): Promise<void> {
    const content = await options.fs.readFile(filePath);
    if (content === null) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return;
    }

    const result = parseFocusFilePayload(parsed, {
      workspaceId: options.workspaceId,
    });
    if (!result.ok || disposed) {
      return;
    }

    const { request } = result;
    if (startup) {
      seen.add(request.requestId);
      return;
    }

    if (seen.has(request.requestId)) {
      return;
    }

    seen.add(request.requestId);
    options.onRequest(request);
  }

  function readOnChange(): void {
    if (disposed || reading) {
      return;
    }

    reading = true;
    void readRequest(false)
      .catch(() => undefined)
      .finally(() => {
        reading = false;
      });
  }

  function scheduleReattach(): void {
    if (disposed || reattachTimer !== undefined) {
      return;
    }

    const timer = setTimeout(() => {
      reattachTimer = undefined;
      attachWatcher();
    }, focusWatchReattachDelayMs);
    reattachTimer = timer;

    // Unref Node timers when available; the VS Code layer owns watcher disposal.
    const unref = (timer as unknown as { unref?: () => void }).unref;
    unref?.call(timer);
  }

  function handleWatcherError(_error: unknown): void {
    if (disposed) {
      return;
    }

    watcher?.close();
    watcher = undefined;
    scheduleReattach();
  }

  function attachWatcher(): void {
    if (disposed) {
      return;
    }

    try {
      watcher = options.fs.watchDir(
        options.dir,
        readOnChange,
        handleWatcherError
      );
    } catch (error) {
      handleWatcherError(error);
    }
  }

  attachWatcher();

  reading = true;
  void readRequest(true)
    .catch(() => undefined)
    .finally(() => {
      reading = false;
    });

  return {
    dispose(): void {
      disposed = true;
      watcher?.close();
      watcher = undefined;
      if (reattachTimer !== undefined) {
        clearTimeout(reattachTimer);
        reattachTimer = undefined;
      }
    },
  };
}
