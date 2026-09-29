import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { activateBoardView } from '../tasks/board-view';
import { activateTasksTree } from '../tasks/tree-view';
import { createTaskWriter, type TaskWriter } from '../tasks/write';

const fsMocks = vi.hoisted(() => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
}));

const vscodeMocks = vi.hoisted(() => ({
  createWebviewPanel: vi.fn(),
}));

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readdir: fsMocks.readdir,
      readFile: fsMocks.readFile,
      stat: fsMocks.stat,
    },
  };
});

vi.mock('vscode', async importOriginal => {
  const actual = await importOriginal<typeof import('vscode')>();
  return {
    ...actual,
    TreeItemCheckboxState: {
      Unchecked: 0,
      Checked: 1,
      Indeterminate: 2,
    },
    window: {
      ...actual.window,
      createWebviewPanel: vscodeMocks.createWebviewPanel,
    },
  };
});

vi.mock('../tasks/write', () => ({
  createTaskWriter: vi.fn(),
}));

function createContext(): vscode.ExtensionContext {
  return {
    subscriptions: [],
    extensionPath: '/mock/extension',
  } as unknown as vscode.ExtensionContext;
}

function createWatcher(): vscode.FileSystemWatcher {
  return {
    onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
    onDidCreate: vi.fn(() => ({ dispose: vi.fn() })),
    onDidDelete: vi.fn(() => ({ dispose: vi.fn() })),
    dispose: vi.fn(),
  } as unknown as vscode.FileSystemWatcher;
}

function createPanel(): vscode.WebviewPanel {
  return {
    webview: {
      cspSource: 'mock-csp',
      html: '',
      asWebviewUri: vi.fn((uri: vscode.Uri) => uri),
      postMessage: vi.fn(),
      onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
    },
    reveal: vi.fn(),
    onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
    dispose: vi.fn(),
  } as unknown as vscode.WebviewPanel;
}

describe('PA Hub board-view I/O', () => {
  let tasksDir: string;
  let contexts: vscode.ExtensionContext[];

  beforeEach(async () => {
    tasksDir = '/tmp/pa-hub-board-io';
    contexts = [];

    fsMocks.readdir.mockReset();
    fsMocks.readFile.mockReset();
    fsMocks.stat.mockReset();
    fsMocks.readdir.mockResolvedValue(['2026-09-29.md']);
    fsMocks.readFile.mockResolvedValue(
      '- [ ] First task <!-- id:task-1 -->\n' +
        '- [ ] Second task <!-- id:task-2 -->\n'
    );
    fsMocks.stat.mockResolvedValue({ mtimeMs: 1, mode: 0o644 });
    vscodeMocks.createWebviewPanel.mockReset();
    vi.mocked(createTaskWriter).mockReset();
  });

  afterEach(async () => {
    for (const context of contexts) {
      for (const subscription of context.subscriptions) {
        subscription.dispose();
      }
    }
    vi.restoreAllMocks();
    vscodeMocks.createWebviewPanel.mockReset();
    vi.mocked(createTaskWriter).mockReset();
  });

  it('reloads once after all checkbox mutations in a batch', async () => {
    const ioEvents: string[] = [];
    fsMocks.readdir.mockImplementation(async (_dir: string) => {
      ioEvents.push('loadSnapshot');
      return ['2026-09-29.md'];
    });

    const toggle = vi.fn(
      async (
        _dir: string,
        _snapshot: unknown,
        identity: string,
        _checked: boolean
      ) => {
        ioEvents.push(`toggle:${identity}`);
        return { ok: true, revision: `revision-${identity}` } as const;
      }
    );
    vi.mocked(createTaskWriter).mockReturnValue({
      toggle,
      move: vi.fn(),
      setQuadrant: vi.fn(),
    } as unknown as TaskWriter);

    let checkboxListener: ((event: unknown) => unknown) | undefined;
    vi.spyOn(vscode.window, 'createTreeView').mockImplementation(
      (_viewId, _options) =>
        ({
          dispose: vi.fn(),
          onDidChangeCheckboxState: vi.fn(
            (listener: (event: unknown) => unknown) => {
              checkboxListener = listener;
              return { dispose: vi.fn() };
            }
          ),
        } as never)
    );
    vi.spyOn(vscode.workspace, 'createFileSystemWatcher').mockReturnValue(
      createWatcher()
    );

    const context = createContext();
    contexts.push(context);
    activateTasksTree(context, tasksDir);

    await vi.waitFor(() => {
      expect(checkboxListener).toBeDefined();
      expect(fsMocks.stat).toHaveBeenCalledTimes(1);
    });
    ioEvents.length = 0;
    fsMocks.readdir.mockClear();

    checkboxListener!({
      items: [
        [
          { kind: 'item', identity: 'task-1' },
          vscode.TreeItemCheckboxState.Checked,
        ],
        [
          { kind: 'item', identity: 'task-2' },
          vscode.TreeItemCheckboxState.Checked,
        ],
      ],
    });

    await vi.waitFor(() => {
      expect(toggle).toHaveBeenCalledTimes(2);
      expect(fsMocks.readdir).toHaveBeenCalledTimes(1);
    });

    expect(ioEvents).toEqual([
      'toggle:task-1',
      'toggle:task-2',
      'loadSnapshot',
    ]);
  });

  it('logs permission errors while loading the board snapshot', async () => {
    const permissionError = Object.assign(new Error('permission denied'), {
      code: 'EACCES',
    });
    fsMocks.readdir.mockRejectedValue(permissionError);
    vi.mocked(createTaskWriter).mockReturnValue({
      toggle: vi.fn(),
      move: vi.fn(),
      setQuadrant: vi.fn(),
    } as unknown as TaskWriter);

    const panel = createPanel();
    vscodeMocks.createWebviewPanel.mockReturnValue(panel);
    vi.spyOn(vscode.workspace, 'createFileSystemWatcher').mockReturnValue(
      createWatcher()
    );
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const context = createContext();
    contexts.push(context);
    activateBoardView(context, tasksDir);

    await expect(
      vscode.commands.executeCommand('pa-hub.show-board')
    ).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledWith(permissionError);
  });
});
