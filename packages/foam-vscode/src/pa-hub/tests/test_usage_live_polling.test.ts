import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { activatePaHub } from '../activate';
import { createPrivacyPolicy } from '../privacy';

const mocks = vi.hoisted(() => ({
  codexRefresh: vi.fn(),
  readdir: vi.fn(),
  readClaudeUsage: vi.fn(),
  resolveClaudeStateDir: vi.fn(),
  watchClaudeUsage: vi.fn(),
}));

vi.mock('../usage/codex', () => ({
  createCodexUsageProvider: vi.fn(() => ({
    refresh: mocks.codexRefresh,
    latest: vi.fn(() => null),
  })),
}));

vi.mock('../usage/claude', () => ({
  readClaudeUsage: mocks.readClaudeUsage,
  resolveClaudeStateDir: mocks.resolveClaudeStateDir,
  watchClaudeUsage: mocks.watchClaudeUsage,
}));

vi.mock('../tasks/tree-view', () => ({
  activateTasksTree: vi.fn(),
}));

vi.mock('../tasks/board-view', () => ({
  activateBoardView: vi.fn(),
}));

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  mocks.readdir.mockImplementation(
    (...args: Parameters<typeof actual.promises.readdir>) =>
      actual.promises.readdir(...args)
  );
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readdir: mocks.readdir,
    },
  };
});

vi.mock('node:os', async importOriginal => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: () => process.env.PA_HUB_STATE_DIR ?? actual.homedir(),
  };
});

vi.mock('vscode', () => {
  class EventEmitter<T> {
    readonly event = vi.fn(() => ({ dispose: vi.fn() }));
    readonly fire = vi.fn((_value?: T) => {});
    readonly dispose = vi.fn();
  }

  return {
    EventEmitter,
    TreeItem: class TreeItem {
      constructor(readonly label: string, readonly collapsibleState: number) {}
    },
    TreeItemCollapsibleState: {
      None: 0,
      Collapsed: 1,
    },
    RelativePattern: class RelativePattern {
      constructor(readonly base: any, readonly pattern: string) {}
    },
    Uri: {
      file: vi.fn((p: string) => ({ fsPath: p, scheme: 'file' })),
    },
    window: {
      createTreeView: vi.fn(() => ({ dispose: vi.fn() })),
      showInputBox: vi.fn(),
      showInformationMessage: vi.fn(),
      showErrorMessage: vi.fn(),
    },
    commands: {
      registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
    },
    workspace: {
      workspaceFolders: undefined,
      createFileSystemWatcher: vi.fn(() => ({
        onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
        onDidCreate: vi.fn(() => ({ dispose: vi.fn() })),
        onDidDelete: vi.fn(() => ({ dispose: vi.fn() })),
        dispose: vi.fn(),
      })),
    },
  };
});

let fixtureRoot: string;
let originalStateDir: string | undefined;
let contexts: vscode.ExtensionContext[];

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();

  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-hub-live-polling-'));
  fs.mkdirSync(path.join(fixtureRoot, 'logs', 'codex'), { recursive: true });
  originalStateDir = process.env.PA_HUB_STATE_DIR;
  process.env.PA_HUB_STATE_DIR = fixtureRoot;
  contexts = [];

  mocks.codexRefresh.mockResolvedValue({
    slots: [],
    fetchedAt: Date.now(),
    error: null,
  });
  mocks.readClaudeUsage.mockReturnValue({
    status: 'missing',
    reason: 'no-file',
  });
  mocks.resolveClaudeStateDir.mockImplementation(
    (env: { PA_HUB_STATE_DIR?: string }) =>
      env.PA_HUB_STATE_DIR ?? '/never-use-this-home'
  );
  mocks.watchClaudeUsage.mockReturnValue({ dispose: vi.fn() });
});

afterEach(() => {
  for (const context of contexts) {
    for (const subscription of context.subscriptions) {
      subscription.dispose();
    }
  }
  vi.restoreAllMocks();
  vi.useRealTimers();

  if (originalStateDir === undefined) {
    delete process.env.PA_HUB_STATE_DIR;
  } else {
    process.env.PA_HUB_STATE_DIR = originalStateDir;
  }
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

function activateForTest(): vscode.ExtensionContext {
  const context = {
    subscriptions: [],
    extensionPath: '/mock/extension',
  } as unknown as vscode.ExtensionContext;
  const policy = createPrivacyPolicy({
    roots: [fixtureRoot],
    excludeGlobs: [],
  });

  activatePaHub(context, path.join(fixtureRoot, 'tasks'), policy);
  contexts.push(context);
  return context;
}

describe('live Codex and Agy usage polling', () => {
  it('refreshes Codex and Agy usage after 30 seconds', async () => {
    activateForTest();
    await Promise.resolve();

    expect(mocks.codexRefresh).toHaveBeenCalledTimes(1);
    expect(mocks.readdir).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(29_999);
    expect(mocks.codexRefresh).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    await Promise.resolve();
    expect(mocks.codexRefresh).toHaveBeenCalledTimes(2);
    expect(mocks.readdir).toHaveBeenCalledTimes(1);
  });

  it('refreshes usage once for each 30-second interval', () => {
    activateForTest();

    vi.advanceTimersByTime(30_000);
    vi.advanceTimersByTime(30_000);
    vi.advanceTimersByTime(30_000);

    expect(mocks.codexRefresh).toHaveBeenCalledTimes(4);
  });

  it('stops refreshing after the activation context is disposed', () => {
    const context = activateForTest();
    const callCount = mocks.codexRefresh.mock.calls.length;

    for (const subscription of context.subscriptions) {
      subscription.dispose();
    }
    vi.advanceTimersByTime(60_000);

    expect(mocks.codexRefresh).toHaveBeenCalledTimes(callCount);
  });
});
