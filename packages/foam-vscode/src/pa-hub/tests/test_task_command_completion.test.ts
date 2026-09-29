import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { activateTasksTree } from '../tasks/tree-view';
import {
  createTaskWriter,
  type TaskWriter,
  type WriteResult,
} from '../tasks/write';
import type { TaskItemNode } from '../tasks/tree';

vi.mock('../tasks/write', () => ({
  createTaskWriter: vi.fn(),
}));

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(nextResolve => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function createWriter(pending: Promise<WriteResult>): {
  writer: TaskWriter;
  move: ReturnType<typeof vi.fn>;
  setQuadrant: ReturnType<typeof vi.fn>;
} {
  const move = vi.fn(() => pending);
  const setQuadrant = vi.fn(() => pending);
  return {
    writer: { toggle: vi.fn(), move, setQuadrant },
    move,
    setQuadrant,
  };
}

describe('task command completion', () => {
  let tasksDir: string | undefined;
  let context: vscode.ExtensionContext | undefined;

  afterEach(async () => {
    for (const subscription of context?.subscriptions ?? []) {
      subscription.dispose();
    }
    vi.restoreAllMocks();
    vi.mocked(createTaskWriter).mockReset();
    if (tasksDir !== undefined) {
      await fs.rm(tasksDir, { force: true, recursive: true });
    }
  });

  async function activateFixture(): Promise<{
    node: TaskItemNode;
    pending: ReturnType<typeof deferred<WriteResult>>;
    writer: ReturnType<typeof createWriter>;
  }> {
    tasksDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pa-hub-task-command-'));
    await fs.writeFile(
      path.join(tasksDir, '2026-09-29.md'),
      '- [ ] Task <!-- id:task-1 quadrant:Q1 -->\n'
    );

    const pending = deferred<WriteResult>();
    const writer = createWriter(pending.promise);
    vi.mocked(createTaskWriter).mockReturnValue(writer.writer);

    const treeView = {
      dispose: vi.fn(),
      onDidChangeCheckboxState: vi.fn(() => ({ dispose: vi.fn() })),
    };
    let provider: { getChildren(element?: unknown): unknown[] } | undefined;
    vi.spyOn(vscode.window, 'createTreeView').mockImplementation(
      (_viewId, options) => {
        provider = options.treeDataProvider as typeof provider;
        return treeView as never;
      }
    );

    context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
    activateTasksTree(context, tasksDir);

    await vi.waitFor(() => {
      expect(provider).toBeDefined();
      expect(provider?.getChildren()).toHaveLength(1);
    });

    const group = provider!.getChildren()[0];
    const node = provider!.getChildren(group)[0] as TaskItemNode;
    return { node, pending, writer };
  }

  async function expectCommandWaitsForMutation(
    command: string,
    pick?: string
  ): Promise<void> {
    if (pick !== undefined) {
      vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue(pick);
    }

    const { node, pending, writer } = await activateFixture();
    let settled = false;
    const commandPromise = vscode.commands
      .executeCommand<void>(command, node)
      .then(() => {
        settled = true;
      });

    await vi.waitFor(() => {
      expect(
        pick === undefined ? writer.move : writer.setQuadrant
      ).toHaveBeenCalledTimes(1);
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    pending.resolve({ ok: true, revision: 'rev-1' });
    await expect(commandPromise).resolves.toBeUndefined();
  }

  it('test_task_move_up_command_waits_for_mutation', async () => {
    await expectCommandWaitsForMutation('pa-hub.task-move-up');
  });

  it('test_task_move_down_command_waits_for_mutation', async () => {
    await expectCommandWaitsForMutation('pa-hub.task-move-down');
  });

  it('test_task_set_quadrant_command_waits_for_mutation', async () => {
    await expectCommandWaitsForMutation('pa-hub.task-set-quadrant', 'Q2');
  });
});
