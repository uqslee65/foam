import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { activateTasksTree } from '../tasks/tree-view';
import {
  createTaskWriter,
  type TaskWriter,
} from '../tasks/write';

vi.mock('../tasks/write', () => ({
  createTaskWriter: vi.fn(),
}));

describe('task command argument validation', () => {
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
    move: ReturnType<typeof vi.fn>;
    setQuadrant: ReturnType<typeof vi.fn>;
    showInformationMessage: ReturnType<typeof vi.fn>;
    showQuickPick: ReturnType<typeof vi.fn>;
  }> {
    tasksDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pa-hub-task-args-'));
    await fs.writeFile(
      path.join(tasksDir, '2026-09-29.md'),
      '- [ ] Task <!-- id:task-1 quadrant:Q1 pdca:cycle-1 -->\n'
    );

    const move = vi.fn().mockResolvedValue({ ok: true, revision: 'rev-1' });
    const setQuadrant = vi
      .fn()
      .mockResolvedValue({ ok: true, revision: 'rev-1' });
    const writer: TaskWriter = {
      toggle: vi.fn(),
      move,
      setQuadrant,
    };
    vi.mocked(createTaskWriter).mockReturnValue(writer);

    let provider: { getChildren(element?: unknown): unknown[] } | undefined;
    vi.spyOn(vscode.window, 'createTreeView').mockImplementation(
      (_viewId, options) => {
        provider = options.treeDataProvider as typeof provider;
        return {
          dispose: vi.fn(),
          onDidChangeCheckboxState: vi.fn(() => ({ dispose: vi.fn() })),
        } as never;
      }
    );
    const showQuickPick = vi
      .spyOn(vscode.window, 'showQuickPick')
      .mockResolvedValue('Q2');
    const showInformationMessage = vi
      .spyOn(vscode.window, 'showInformationMessage')
      .mockResolvedValue(undefined);

    context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
    activateTasksTree(context, tasksDir);

    await vi.waitFor(() => {
      expect(provider).toBeDefined();
      expect(provider?.getChildren()).toHaveLength(1);
    });

    return {
      move,
      setQuadrant,
      showInformationMessage,
      showQuickPick,
    };
  }

  async function expectMissingArgumentToReturn(command: string): Promise<void> {
    await expect(
      vscode.commands.executeCommand<void>(command, undefined)
    ).resolves.toBeUndefined();
    await expect(
      vscode.commands.executeCommand<void>(command, null)
    ).resolves.toBeUndefined();
  }

  it('test_task_move_up_returns_early_for_missing_argument', async () => {
    const { move } = await activateFixture();

    await expectMissingArgumentToReturn('pa-hub.task-move-up');

    expect(move).not.toHaveBeenCalled();
  });

  it('test_task_move_down_returns_early_for_missing_argument', async () => {
    const { move } = await activateFixture();

    await expectMissingArgumentToReturn('pa-hub.task-move-down');

    expect(move).not.toHaveBeenCalled();
  });

  it('test_task_set_quadrant_returns_early_for_missing_argument', async () => {
    const { setQuadrant, showQuickPick } = await activateFixture();

    await expectMissingArgumentToReturn('pa-hub.task-set-quadrant');

    expect(showQuickPick).not.toHaveBeenCalled();
    expect(setQuadrant).not.toHaveBeenCalled();
  });

  it('test_task_dispatch_returns_early_for_missing_argument', async () => {
    const { showInformationMessage } = await activateFixture();

    await expectMissingArgumentToReturn('pa-hub.task-dispatch');

    expect(showInformationMessage).not.toHaveBeenCalled();
  });
});
