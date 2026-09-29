import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { activatePaHub } from '../activate';
import { activateTasksTree } from '../tasks/tree-view';
import { activateBoardView } from '../tasks/board-view';
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

describe('pa-hub activation module', () => {
  let context: vscode.ExtensionContext;
  let policy: ReturnType<typeof createPrivacyPolicy>;
  const tasksDir = 'tasks-repo';

  beforeEach(() => {
    vi.clearAllMocks();
    context = {
      subscriptions: [],
      extensionPath: '/mock/extension',
    } as unknown as vscode.ExtensionContext;
    policy = createPrivacyPolicy({
      roots: ['/mock/workspace'],
      excludeGlobs: [],
    });
    activatePaHub(context, tasksDir, policy);
  });

  it('test_activation_exports_function', () => {
    expect(typeof activatePaHub).toBe('function');
  });

  it('test_activation_registers_sources_tree', () => {
    expect(vscode.window.createTreeView).toHaveBeenCalledWith(
      'pa-hub.sources',
      expect.objectContaining({
        treeDataProvider: expect.anything(),
      })
    );
  });

  it('test_activation_registers_usage_tree', () => {
    expect(vscode.window.createTreeView).toHaveBeenCalledWith(
      'pa-hub.usage',
      expect.objectContaining({
        treeDataProvider: expect.anything(),
      })
    );
  });

  it('test_activation_registers_capture_command', () => {
    expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
      'pa-hub.capture',
      expect.any(Function)
    );
  });

  it('test_activation_registers_refresh_sources', () => {
    expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
      'pa-hub.refresh-sources',
      expect.any(Function)
    );
  });

  it('test_activation_registers_refresh_usage', () => {
    expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
      'pa-hub.refresh-usage',
      expect.any(Function)
    );
  });

  it('test_activation_calls_tasks_tree', () => {
    expect(activateTasksTree).toHaveBeenCalledWith(context, tasksDir);
  });

  it('test_activation_calls_board_view', () => {
    expect(activateBoardView).toHaveBeenCalledWith(context, tasksDir);
  });
});
