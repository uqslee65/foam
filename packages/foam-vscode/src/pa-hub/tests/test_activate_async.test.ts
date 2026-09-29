import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as vscode from 'vscode';
import { Logger } from '@foam/core';
import { activatePaHub } from '../activate';
import { createPrivacyPolicy } from '../privacy';

const mocks = vi.hoisted(() => ({
  codexRefresh: vi.fn(),
  readClaudeUsage: vi.fn(),
  resolveClaudeStateDir: vi.fn(),
  watchClaudeUsage: vi.fn(),
  readPdcaCycles: vi.fn(),
}));

vi.mock('../tasks/tree-view', () => ({
  activateTasksTree: vi.fn(),
}));

vi.mock('../tasks/board-view', () => ({
  activateBoardView: vi.fn(),
}));

vi.mock('../usage/codex', () => ({
  createCodexUsageProvider: vi.fn(() => ({
    refresh: mocks.codexRefresh,
  })),
}));

vi.mock('../usage/claude', () => ({
  readClaudeUsage: mocks.readClaudeUsage,
  resolveClaudeStateDir: mocks.resolveClaudeStateDir,
  watchClaudeUsage: mocks.watchClaudeUsage,
}));

vi.mock('../history', () => ({
  createHistoryTree: vi.fn(() => ({
    refresh: vi.fn(),
    getChildren: vi.fn(() => []),
    onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
  })),
  readPdcaCycles: mocks.readPdcaCycles,
}));

vi.mock('../calendar', () => ({
  createCalendarTree: vi.fn(() => ({
    refresh: vi.fn(),
    getChildren: vi.fn(() => []),
    onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
  })),
  readCalendar: vi.fn(() => ({ status: 'missing', reason: 'test' })),
  resolveCalendarFile: vi.fn(() => '/tmp/pa-hub-test-events.json'),
}));

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
      constructor(readonly base: unknown, readonly pattern: string) {}
    },
    Uri: {
      file: vi.fn((filePath: string) => ({ fsPath: filePath, scheme: 'file' })),
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

let context: vscode.ExtensionContext;

beforeEach(() => {
  vi.clearAllMocks();
  context = {
    subscriptions: [],
    extensionPath: '/mock/extension',
  } as unknown as vscode.ExtensionContext;
  mocks.codexRefresh.mockResolvedValue({
    slots: [],
    fetchedAt: Date.now(),
    error: null,
  });
  mocks.readClaudeUsage.mockResolvedValue({
    status: 'missing',
    reason: 'no-file',
  });
  mocks.resolveClaudeStateDir.mockReturnValue('/tmp/pa-hub-test-claude');
  mocks.watchClaudeUsage.mockReturnValue({ dispose: vi.fn() });
});

afterEach(() => {
  for (const subscription of context.subscriptions) {
    subscription.dispose();
  }
  vi.restoreAllMocks();
});

describe('pa-hub activation async behavior', () => {
  it('readAgyReceipts returns a Promise and uses async filesystem APIs', async () => {
    const source = await readFile(
      resolve(__dirname, '../activate.ts'),
      'utf8'
    );

    expect(source).toMatch(
      /async function readAgyReceipts\(logsCodexDir: string\): Promise<string\[\]>/
    );
    expect(source).toMatch(/await fs\.promises\.readdir/);
    expect(source).toMatch(/await fs\.promises\.readFile/);
    expect(source).not.toMatch(/(?:exists|readFile|readdir)Sync/);
  });

  it('catches refreshHistory failures without an unhandled rejection', async () => {
    const error = new Error('history refresh failed');
    mocks.readPdcaCycles.mockRejectedValue(error);
    const loggerError = vi.spyOn(Logger, 'error').mockImplementation(() => {});
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);

    try {
      activatePaHub(
        context,
        '/tmp/pa-hub-test-tasks',
        createPrivacyPolicy({ roots: ['/tmp'], excludeGlobs: [] })
      );
      await new Promise<void>(resolve => setImmediate(resolve));
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }

    expect(loggerError).toHaveBeenCalledWith(error);
    expect(unhandledRejections).toEqual([]);
  });
});
