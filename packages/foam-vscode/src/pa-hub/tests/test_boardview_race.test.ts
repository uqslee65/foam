import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { activateBoardView } from '../tasks/board-view';
import type { TaskItemNode } from '../tasks/tree';
import { activateTasksTree } from '../tasks/tree-view';
import { createTaskWriter, type TaskWriter } from '../tasks/write';
import type { TaskSnapshot } from '../tasks/snapshot';

const vscodeMocks = vi.hoisted(() => ({
  createFileSystemWatcher: vi.fn(),
  createWebviewPanel: vi.fn(),
}));

vi.mock('vscode', async importOriginal => {
  const actual = await importOriginal<typeof import('vscode')>();
  return {
    ...actual,
    window: {
      ...actual.window,
      createWebviewPanel: vscodeMocks.createWebviewPanel,
    },
    workspace: {
      ...actual.workspace,
      createFileSystemWatcher: vscodeMocks.createFileSystemWatcher,
    },
  };
});

vi.mock('../tasks/write', () => ({
  createTaskWriter: vi.fn(),
}));

type WatcherCallback = (uri: vscode.Uri) => unknown;

function createWatcher(): {
  watcher: vscode.FileSystemWatcher;
  fireChange(): void;
  fireCreate(): void;
  fireDelete(): void;
} {
  let change: WatcherCallback | undefined;
  let create: WatcherCallback | undefined;
  let remove: WatcherCallback | undefined;
  const watcher = {
    onDidChange(listener: WatcherCallback) {
      change = listener;
      return { dispose: vi.fn() };
    },
    onDidCreate(listener: WatcherCallback) {
      create = listener;
      return { dispose: vi.fn() };
    },
    onDidDelete(listener: WatcherCallback) {
      remove = listener;
      return { dispose: vi.fn() };
    },
    dispose: vi.fn(),
  } as unknown as vscode.FileSystemWatcher;

  const uri = vscode.Uri.file('/tmp/pa-hub-test-task.md');
  return {
    watcher,
    fireChange: () => {
      change?.(uri);
    },
    fireCreate: () => {
      create?.(uri);
    },
    fireDelete: () => {
      remove?.(uri);
    },
  };
}

function createPanel(): {
  panel: vscode.WebviewPanel;
  sendMessage: (message: unknown) => unknown;
} {
  let receiveMessage: ((message: unknown) => unknown) | undefined;
  const panel = {
    webview: {
      cspSource: 'mock-csp',
      html: '',
      asWebviewUri: vi.fn((uri: vscode.Uri) => uri),
      postMessage: vi.fn(),
      onDidReceiveMessage: vi.fn((listener: (message: unknown) => unknown) => {
        receiveMessage = listener;
        return { dispose: vi.fn() };
      }),
    },
    reveal: vi.fn(),
    onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
    dispose: vi.fn(),
  } as unknown as vscode.WebviewPanel;

  return {
    panel,
    sendMessage: message => receiveMessage?.(message),
  };
}

describe('PA Hub task view mutation races', () => {
  let tasksDir: string;
  let taskFile: string;
  let contexts: vscode.ExtensionContext[];

  beforeEach(async () => {
    tasksDir = await fs.mkdtemp(join(tmpdir(), 'pa-hub-board-race-'));
    taskFile = join(tasksDir, '2026-09-29.md');
    await fs.writeFile(
      taskFile,
      '- [ ] Task <!-- id:task-1 quadrant:Q1 -->\n'
    );
    contexts = [];
    vi.mocked(createTaskWriter).mockReset();
    vscodeMocks.createFileSystemWatcher.mockReset();
    vscodeMocks.createWebviewPanel.mockReset();
  });

  afterEach(async () => {
    for (const context of contexts) {
      for (const subscription of context.subscriptions) {
        subscription.dispose();
      }
    }
    vi.restoreAllMocks();
    await fs.rm(tasksDir, { recursive: true, force: true });
  });

  function createContext(): vscode.ExtensionContext {
    const context = {
      subscriptions: [],
      extensionPath: '/mock/extension',
    } as unknown as vscode.ExtensionContext;
    contexts.push(context);
    return context;
  }

  it('serializes rapid board mutations and reloads each result in order', async () => {
    const watcher = createWatcher();
    vscodeMocks.createFileSystemWatcher.mockReturnValue(watcher.watcher);
    const { panel, sendMessage } = createPanel();
    vscodeMocks.createWebviewPanel.mockReturnValue(panel);

    const toggle = vi.fn(
      async (
        _dir: string,
        snapshot: TaskSnapshot,
        _identity: string,
        checked: boolean
      ) => {
        await fs.writeFile(
          taskFile,
          `- [${checked ? 'x' : ' '}] Task <!-- id:task-1 quadrant:Q1 -->\n`
        );
        return { ok: true, revision: 'updated' };
      }
    );
    vi.mocked(createTaskWriter).mockReturnValue({
      toggle,
      move: vi.fn(),
      setQuadrant: vi.fn(),
    } as unknown as TaskWriter);

    activateBoardView(createContext(), tasksDir);
    await vscode.commands.executeCommand('pa-hub.show-board');
    sendMessage({ type: 'toggle', identity: 'task-1', checked: true });
    sendMessage({ type: 'toggle', identity: 'task-1', checked: false });

    await vi.waitFor(() => {
      expect(toggle).toHaveBeenCalledTimes(2);
    });

    expect(toggle.mock.calls[0][1].tasks[0].checked).toBe(false);
    expect(toggle.mock.calls[1][1].tasks[0].checked).toBe(true);
    await expect(fs.readFile(taskFile, 'utf8')).resolves.toContain('- [ ]');
  });

  it('serializes rapid tree mutations using the snapshot produced by the prior mutation', async () => {
    const watcher = createWatcher();
    vscodeMocks.createFileSystemWatcher.mockReturnValue(watcher.watcher);

    let provider: { getChildren(element?: unknown): readonly unknown[] } | undefined;
    vi.spyOn(vscode.window, 'createTreeView').mockImplementation(
      (_viewId, options) => {
        provider = options.treeDataProvider as typeof provider;
        return {
          dispose: vi.fn(),
          onDidChangeCheckboxState: vi.fn(() => ({ dispose: vi.fn() })),
        } as never;
      }
    );

    const setQuadrant = vi.fn(
      async (
        _dir: string,
        snapshot: TaskSnapshot,
        _identity: string,
        quadrant: string
      ) => {
        await fs.writeFile(
          taskFile,
          `- [ ] Task <!-- id:task-1 quadrant:${quadrant} -->\n`
        );
        return { ok: true, revision: 'updated' };
      }
    );
    vi.mocked(createTaskWriter).mockReturnValue({
      toggle: vi.fn(),
      move: vi.fn(),
      setQuadrant,
    } as unknown as TaskWriter);

    activateTasksTree(createContext(), tasksDir);
    await vi.waitFor(() => {
      expect(provider).toBeDefined();
      expect(provider?.getChildren()).toHaveLength(1);
    });

    const group = provider!.getChildren()[0];
    const node = provider!.getChildren(group)[0] as TaskItemNode;
    vi.spyOn(vscode.window, 'showQuickPick')
      .mockResolvedValueOnce('Q2')
      .mockResolvedValueOnce('Q3');

    await Promise.all([
      vscode.commands.executeCommand('pa-hub.task-set-quadrant', node),
      vscode.commands.executeCommand('pa-hub.task-set-quadrant', node),
    ]);

    expect(setQuadrant.mock.calls[1][1].tasks[0].meta.quadrant).toBe('Q2');
    await expect(fs.readFile(taskFile, 'utf8')).resolves.toContain('quadrant:Q3');
  });

  it('catches watcher refresh failures without unhandled rejections', async () => {
    const watcher = createWatcher();
    vscodeMocks.createFileSystemWatcher.mockReturnValue(watcher.watcher);
    const { panel } = createPanel();
    vscodeMocks.createWebviewPanel.mockReturnValue(panel);
    vi.mocked(createTaskWriter).mockReturnValue({
      toggle: vi.fn(),
      move: vi.fn(),
      setQuadrant: vi.fn(),
    } as unknown as TaskWriter);

    activateBoardView(createContext(), tasksDir);
    await vscode.commands.executeCommand('pa-hub.show-board');
    expect(vscodeMocks.createFileSystemWatcher).toHaveBeenCalledTimes(1);
    expect(panel.webview.postMessage).toHaveBeenCalledTimes(1);
    const error = new Error('board refresh failed');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(panel.webview.postMessage).mockImplementation(() => {
      throw error;
    });
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);

    try {
      watcher.fireChange();
      watcher.fireCreate();
      watcher.fireDelete();
      await vi.waitFor(() => {
        expect(panel.webview.postMessage).toHaveBeenCalledTimes(4);
      });
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }

    expect(consoleError).toHaveBeenCalledWith(error);
    expect(unhandledRejections).toEqual([]);
  });
});
