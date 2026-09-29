import { describe, expect, it, vi } from 'vitest';
import type { NodeId } from '@foam/graph-view/protocol' with { 'resolution-mode': 'import' };
import {
  FocusQueue,
  parseFocusFilePayload,
  watchFocusFile,
} from '../focus';
import type { FocusFs } from '../focus';

const nodeId = 'vault:test-node' as NodeId;

function request(requestId: string) {
  return { requestId, nodeId };
}

function mockFs(
  content: string | null
): FocusFs & {
  setContent: (nextContent: string | null) => void;
  triggerChange: () => void;
  triggerError: (err: unknown) => void;
  close: ReturnType<typeof vi.fn>;
} {
  let currentContent = content;
  let onChange: (() => void) | undefined;
  let onError: ((err: unknown) => void) | undefined;
  const close = vi.fn();
  return {
    readFile: async () => currentContent,
    watchDir: (_dir, onC, onE) => {
      onChange = onC;
      onError = onE;
      return { close };
    },
    setContent: nextContent => {
      currentContent = nextContent;
    },
    triggerChange: () => onChange?.(),
    triggerError: err => onError?.(err),
    close,
  };
}

async function flushFocusReads(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('focus', () => {
  it('test_focus_parse_valid', () => {
    expect(
      parseFocusFilePayload(
        { workspace: 'workspace-a', requestId: 'request-1', nodeId },
        { workspaceId: 'workspace-a' }
      )
    ).toEqual({
      ok: true,
      request: { requestId: 'request-1', nodeId },
    });
  });

  it('test_focus_parse_valid_center', () => {
    expect(
      parseFocusFilePayload(
        {
          workspace: 'workspace-a',
          requestId: 'request-1',
          nodeId,
          center: true,
        },
        { workspaceId: 'workspace-a' }
      )
    ).toEqual({
      ok: true,
      request: { requestId: 'request-1', nodeId, center: true },
    });
  });

  it('test_focus_parse_invalid_shape', () => {
    for (const input of [
      null,
      42,
      {},
      { workspace: 'workspace-a', requestId: 'request-1' },
      { workspace: 'workspace-a', requestId: 'request-1', nodeId: 42 },
    ]) {
      expect(
        parseFocusFilePayload(input, { workspaceId: 'workspace-a' })
      ).toEqual({ ok: false, reason: 'invalid_shape' });
    }
  });

  it('test_focus_parse_wrong_workspace', () => {
    expect(
      parseFocusFilePayload(
        { workspace: 'workspace-b', requestId: 'request-1', nodeId },
        { workspaceId: 'workspace-a' }
      )
    ).toEqual({ ok: false, reason: 'wrong_workspace' });
  });

  it('test_focus_parse_missing_request_id', () => {
    expect(
      parseFocusFilePayload(
        { workspace: 'workspace-a', requestId: '', nodeId },
        { workspaceId: 'workspace-a' }
      )
    ).toEqual({ ok: false, reason: 'missing_request_id' });
  });

  it('test_focus_parse_invalid_node_id', () => {
    expect(
      parseFocusFilePayload(
        { workspace: 'workspace-a', requestId: 'request-1', nodeId: 'bad' },
        { workspaceId: 'workspace-a' }
      )
    ).toEqual({ ok: false, reason: 'invalid_node_id' });
  });

  it('test_focus_queue_replay_suppression', () => {
    const queue = new FocusQueue();
    queue.enqueue(request('request-1'));
    queue.enqueue({ requestId: 'request-1', nodeId: 'vault:other-node' as NodeId });

    expect(queue.drain()).toEqual([request('request-1')]);
  });

  it('test_focus_queue_keep_latest_not_ready', () => {
    const queue = new FocusQueue();
    queue.enqueue(request('request-1'));
    queue.enqueue(request('request-2'));

    expect(queue.pending).toBe(1);
    expect(queue.drain()).toEqual([request('request-2')]);
  });

  it('test_focus_queue_accumulate_ready', () => {
    const queue = new FocusQueue();
    queue.markReady();
    queue.enqueue(request('request-1'));
    queue.enqueue(request('request-2'));

    expect(queue.pending).toBe(2);
    expect(queue.drain()).toEqual([request('request-1'), request('request-2')]);
  });

  it('test_focus_queue_mark_not_ready_keeps_latest', () => {
    const queue = new FocusQueue();
    queue.markReady();
    queue.enqueue(request('request-1'));
    queue.enqueue(request('request-2'));
    queue.markNotReady();

    expect(queue.drain()).toEqual([request('request-2')]);
  });

  it('test_focus_queue_mark_seen_suppresses', () => {
    const queue = new FocusQueue();
    queue.markSeen('request-1');
    queue.enqueue(request('request-1'));

    expect(queue.drain()).toEqual([]);
  });

  it('test_focus_queue_drain_adds_to_seen', () => {
    const queue = new FocusQueue();
    queue.enqueue(request('request-1'));
    expect(queue.drain()).toEqual([request('request-1')]);

    queue.enqueue(request('request-1'));
    expect(queue.drain()).toEqual([]);
  });

  it('test_focus_watch_startup_suppress', async () => {
    const fs = mockFs(
      JSON.stringify({
        workspace: 'workspace-a',
        requestId: 'request-1',
        nodeId,
      })
    );
    const onRequest = vi.fn();
    const watcher = watchFocusFile({
      dir: '/workspace',
      filename: 'focus.json',
      fs,
      workspaceId: 'workspace-a',
      onRequest,
    });

    await flushFocusReads();

    expect(onRequest).not.toHaveBeenCalled();
    watcher.dispose();
  });

  it('test_focus_watch_new_request', async () => {
    const fs = mockFs(null);
    const onRequest = vi.fn();
    const watcher = watchFocusFile({
      dir: '/workspace',
      filename: 'focus.json',
      fs,
      workspaceId: 'workspace-a',
      onRequest,
    });
    await flushFocusReads();

    fs.setContent(
      JSON.stringify({
        workspace: 'workspace-a',
        requestId: 'request-2',
        nodeId,
      })
    );
    fs.triggerChange();
    await flushFocusReads();

    expect(onRequest).toHaveBeenCalledOnce();
    expect(onRequest).toHaveBeenCalledWith(request('request-2'));
    watcher.dispose();
  });

  it('test_focus_watch_duplicate_suppress', async () => {
    const fs = mockFs(null);
    const onRequest = vi.fn();
    const watcher = watchFocusFile({
      dir: '/workspace',
      filename: 'focus.json',
      fs,
      workspaceId: 'workspace-a',
      onRequest,
    });
    await flushFocusReads();
    fs.setContent(
      JSON.stringify({
        workspace: 'workspace-a',
        requestId: 'request-3',
        nodeId,
      })
    );

    fs.triggerChange();
    await flushFocusReads();
    fs.triggerChange();
    await flushFocusReads();

    expect(onRequest).toHaveBeenCalledOnce();
    watcher.dispose();
  });

  it('test_focus_watch_dispose', () => {
    const fs = mockFs(null);
    const watcher = watchFocusFile({
      dir: '/workspace',
      filename: 'focus.json',
      fs,
      workspaceId: 'workspace-a',
      onRequest: vi.fn(),
    });

    watcher.dispose();

    expect(fs.close).toHaveBeenCalledOnce();
  });
});
