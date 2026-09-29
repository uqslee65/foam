import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { activatePaHub } from '../activate';
import { createPrivacyPolicy } from '../privacy';

vi.mock('../tasks/tree-view', () => ({
  activateTasksTree: vi.fn(),
}));

vi.mock('../tasks/board-view', () => ({
  activateBoardView: vi.fn(),
}));

vi.mock('vscode', async importOriginal => {
  const actual = await importOriginal<typeof import('vscode')>();
  return {
    ...actual,
    window: {
      ...actual.window,
      createTreeView: vi.fn().mockImplementation(() => ({
        dispose: vi.fn(),
      })),
      showInputBox: vi.fn(),
      showInformationMessage: vi.fn(),
      showErrorMessage: vi.fn(),
    },
    commands: {
      ...actual.commands,
      registerCommand: vi.fn().mockImplementation(() => ({
        dispose: vi.fn(),
      })),
    },
  };
});

describe('pa-hub capture handler', () => {
  it('captures into inbox when tasks directory is absolute', async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'pa-hub-capture-')
    );
    const tasksDir = path.join(workspaceRoot, 'tasks');
    const context = {
      subscriptions: [],
      extensionPath: '/mock/extension',
    } as unknown as vscode.ExtensionContext;
    const policy = createPrivacyPolicy({
      roots: [workspaceRoot],
      excludeGlobs: [],
    });

    try {
      vi.mocked(vscode.commands.registerCommand).mockClear();
      vi.mocked(vscode.window.showInputBox)
        .mockResolvedValueOnce('Absolute Task Capture')
        .mockResolvedValueOnce('Body text');

      activatePaHub(context, tasksDir, policy);

      const captureRegistration = vi
        .mocked(vscode.commands.registerCommand)
        .mock.calls.find(([command]) => command === 'pa-hub.capture');
      expect(captureRegistration).toBeDefined();

      await captureRegistration![1]();

      const inboxDir = path.join(workspaceRoot, 'inbox');
      const files = await fs.readdir(inboxDir);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(
        /^\d{4}-\d{2}-\d{2}-\d{6}-absolute-task-capture-[a-z0-9]{4}\.md$/
      );
      await expect(
        fs.readFile(path.join(inboxDir, files[0]), 'utf8')
      ).resolves.toContain('title: Absolute Task Capture');
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringMatching(
          /^Captured: .*absolute-task-capture-[a-z0-9]{4}\.md$/
        )
      );
    } finally {
      for (const disposable of context.subscriptions) {
        disposable.dispose();
      }
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
