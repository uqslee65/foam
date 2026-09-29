import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as cp from 'node:child_process';
import { activateTasksTree } from './tasks/tree-view';
import { activateBoardView } from './tasks/board-view';
import {
  createSourceTree,
  parseIndex,
  type SourceElement,
  type SourceTree,
} from './sources';
import {
  createUsageTree,
  type UsageTreeElement,
  type UsageTree,
} from './usage/tree';
import {
  readClaudeUsage,
  resolveClaudeStateDir,
  watchClaudeUsage,
  type ClaudeUsageState,
} from './usage/claude';
import {
  createCodexUsageProvider,
  type CodexUsageProvider,
  type CodexRunner,
  type CodexUsageSnapshot,
} from './usage/codex';
import {
  createAgyUsageSnapshot,
  type AgyUsageSnapshot,
} from './usage/antigravity';
import { createCapture } from './inbox';
import {
  readCalendar,
  resolveCalendarFile,
  createCalendarTree,
  type CalendarTreeElement,
  type CalendarFile,
} from './calendar';
import type { PrivacyPolicy } from './privacy';
import {
  readPdcaCycles,
  createHistoryTree,
  type HistoryTreeElement,
} from './history';

class SourcesTreeDataProvider implements vscode.TreeDataProvider<SourceElement> {
  readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(
    private readonly tree: SourceTree,
    private readonly workspaceRoot: string
  ) {
    this.tree.onDidChange(() => this._onDidChange.fire());
  }

  getTreeItem(element: SourceElement): vscode.TreeItem {
    if (element.kind === 'topic') {
      const item = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      item.contextValue = 'sourceTopic';
      return item;
    }

    const item = new vscode.TreeItem(
      element.label,
      vscode.TreeItemCollapsibleState.None
    );
    item.contextValue = 'sourceEntry';
    const filePath = path.isAbsolute(element.relativePath)
      ? element.relativePath
      : path.join(this.workspaceRoot, element.relativePath);
    item.command = {
      command: 'vscode.open',
      title: 'Open Source',
      arguments: [vscode.Uri.file(filePath)],
    };
    return item;
  }

  getChildren(element?: SourceElement): SourceElement[] {
    return [...this.tree.getChildren(element)];
  }
}

class UsageTreeDataProvider
  implements vscode.TreeDataProvider<UsageTreeElement>
{
  readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private readonly tree: UsageTree) {
    this.tree.onDidChange(() => this._onDidChange.fire());
  }

  getTreeItem(element: UsageTreeElement): vscode.TreeItem {
    if (element.kind === 'provider') {
      const item = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      item.description = element.statusLabel;
      item.contextValue = 'usageProvider';
      return item;
    }

    const item = new vscode.TreeItem(
      element.label,
      vscode.TreeItemCollapsibleState.None
    );
    item.description = element.value;
    item.contextValue = 'usageDetail';
    return item;
  }

  getChildren(element?: UsageTreeElement): UsageTreeElement[] {
    return [...this.tree.getChildren(element)];
  }
}

class CalendarTreeDataProvider
  implements vscode.TreeDataProvider<CalendarTreeElement>
{
  readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private tree: ReturnType<typeof createCalendarTree>;

  constructor() {
    this.tree = createCalendarTree();
    this.tree.onDidChange(() => this._onDidChange.fire());
  }

  refresh(data: CalendarFile): void {
    const tz = 'timezone' in data && data.timezone
      ? data.timezone
      : Intl.DateTimeFormat().resolvedOptions().timeZone;
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: tz }).format(new Date());
    this.tree.refresh(data, today);
  }

  getTreeItem(element: CalendarTreeElement): vscode.TreeItem {
    if (element.kind === 'date-group') {
      const item = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      item.description = `${element.count}`;
      item.contextValue = 'calendarDateGroup';
      return item;
    }
    const item = new vscode.TreeItem(
      element.label,
      vscode.TreeItemCollapsibleState.None
    );
    item.contextValue = 'calendarEvent';
    if (element.event.location) {
      item.description = element.event.location;
    }
    return item;
  }

  getChildren(element?: CalendarTreeElement): CalendarTreeElement[] {
    return [...this.tree.getChildren(element)];
  }
}

class HistoryTreeDataProvider
  implements vscode.TreeDataProvider<HistoryTreeElement>
{
  readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private tree: ReturnType<typeof createHistoryTree>;

  constructor() {
    this.tree = createHistoryTree();
    this.tree.onDidChange(() => this._onDidChange.fire());
  }

  refresh(logsDir: string, limit = 100): void {
    const cycles = readPdcaCycles(logsDir, limit);
    this.tree.refresh(cycles);
  }

  getTreeItem(element: HistoryTreeElement): vscode.TreeItem {
    if (element.kind === 'state-group') {
      const item = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      item.description = `${element.count}`;
      item.contextValue = 'historyStateGroup';
      return item;
    }
    const item = new vscode.TreeItem(
      element.label,
      vscode.TreeItemCollapsibleState.None
    );
    item.description = element.cycle.date;
    item.contextValue = 'historyCycle';
    item.tooltip = element.cycle.title;
    item.command = {
      command: 'vscode.open',
      title: 'Open Cycle',
      arguments: [vscode.Uri.file(element.cycle.source)],
    };
    return item;
  }

  getChildren(element?: HistoryTreeElement): HistoryTreeElement[] {
    return [...this.tree.getChildren(element)];
  }
}

function readAgyReceipts(logsCodexDir: string): string[] {
  try {
    if (!fs.existsSync(logsCodexDir)) {
      return [];
    }
    const entries = fs.readdirSync(logsCodexDir, { withFileTypes: true });
    const receipts: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const receiptFile = path.join(logsCodexDir, entry.name, 'receipt.json');
        if (fs.existsSync(receiptFile)) {
          try {
            receipts.push(fs.readFileSync(receiptFile, 'utf-8'));
          } catch {
            // ignore unreadable
          }
        }
      } else if (
        entry.isFile() &&
        (entry.name === 'receipt.json' || entry.name.endsWith('.json'))
      ) {
        try {
          receipts.push(
            fs.readFileSync(path.join(logsCodexDir, entry.name), 'utf-8')
          );
        } catch {
          // ignore unreadable
        }
      }
    }
    return receipts;
  } catch {
    return [];
  }
}

export function activatePaHub(
  context: vscode.ExtensionContext,
  tasksDir: string,
  privacyPolicy: PrivacyPolicy
): void {
  // 1. Tasks tree
  activateTasksTree(context, tasksDir);

  // 2. Board view
  activateBoardView(context, tasksDir);

  // 3. Sources tree view
  const researchSourcesDir = path.join(os.homedir(), 'research-sources');
  const workspaceRoot = fs.existsSync(researchSourcesDir)
    ? researchSourcesDir
    : (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
       path.resolve(tasksDir, '..'));
  const sourcesTree = createSourceTree();
  const sourcesProvider = new SourcesTreeDataProvider(
    sourcesTree,
    workspaceRoot
  );
  const sourcesTreeView = vscode.window.createTreeView('pa-hub.sources', {
    treeDataProvider: sourcesProvider,
  });

  const refreshSources = async () => {
    const candidates = [
      path.join(workspaceRoot, 'INDEX.md'),
      path.join(workspaceRoot, 'sources.md'),
      path.join(workspaceRoot, 'sources', 'index.md'),
      path.join(tasksDir, '..', 'sources.md'),
    ];
    let content = '';
    for (const candidate of candidates) {
      try {
        content = await fs.promises.readFile(candidate, 'utf-8');
        break;
      } catch {
        // try next candidate
      }
    }
    const topics = parseIndex(content);
    sourcesTree.refresh(
      topics,
      relativePath => {
        const filePath = path.isAbsolute(relativePath)
          ? relativePath
          : path.join(workspaceRoot, relativePath);
        return fs.existsSync(filePath);
      },
      relativePath => {
        const filePath = path.isAbsolute(relativePath)
          ? relativePath
          : path.join(workspaceRoot, relativePath);
        return privacyPolicy.isAllowed(filePath);
      }
    );
  };

  const refreshSourcesCommand = vscode.commands.registerCommand(
    'pa-hub.refresh-sources',
    refreshSources
  );

  refreshSources().catch(() => {});

  // 4. Usage tree view
  const usageTree = createUsageTree();
  const usageProvider = new UsageTreeDataProvider(usageTree);
  const usageTreeView = vscode.window.createTreeView('pa-hub.usage', {
    treeDataProvider: usageProvider,
  });

  const codexRunner: CodexRunner = () =>
    new Promise((resolve, reject) => {
      const script = path.join(os.homedir(), 'projects', 'export-setup', 'scripts', 'codex_accounts.py');
      cp.exec(`python3 "${script}" --status --json`, (err, stdout) => {
        if (err) {
          reject(err);
        } else {
          resolve(stdout);
        }
      });
    });
  const codexProvider: CodexUsageProvider =
    createCodexUsageProvider(codexRunner);
  const exportSetupDir = path.join(os.homedir(), 'projects', 'export-setup');
  const logsCodexDir = fs.existsSync(path.join(exportSetupDir, 'logs', 'codex'))
    ? path.join(exportSetupDir, 'logs', 'codex')
    : path.join(workspaceRoot, 'logs', 'codex');

  const claudeStateDir = resolveClaudeStateDir(
    {
      PA_HUB_STATE_DIR: process.env.PA_HUB_STATE_DIR,
      HOME: process.env.HOME,
    },
    os.homedir
  );
  let latestClaudeState: ClaudeUsageState = {
    status: 'missing',
    reason: 'no-file',
  };
  let latestCodexSnapshot: CodexUsageSnapshot | null = null;
  let latestAgySnapshot: AgyUsageSnapshot | null = null;

  const refreshUsage = async () => {
    latestClaudeState = readClaudeUsage(claudeStateDir);
    try {
      latestCodexSnapshot = await codexProvider.refresh();
    } catch {
      // codex runner unavailable in this env
    }
    const receipts = readAgyReceipts(logsCodexDir);
    latestAgySnapshot = createAgyUsageSnapshot(receipts);
    usageTree.update(
      latestClaudeState,
      latestCodexSnapshot,
      latestAgySnapshot
    );
  };

  const refreshUsageCommand = vscode.commands.registerCommand(
    'pa-hub.refresh-usage',
    refreshUsage
  );

  refreshUsage().catch(() => {});

  const claudeWatcher = watchClaudeUsage(claudeStateDir, state => {
    latestClaudeState = state;
    usageTree.update(
      latestClaudeState,
      latestCodexSnapshot,
      latestAgySnapshot
    );
  });

  const USAGE_POLL_MS = 30_000;
  const pollingInterval = setInterval(() => {
    refreshUsage().catch(() => {});
  }, USAGE_POLL_MS);
  (pollingInterval as unknown as { unref?: () => void }).unref?.();

  // 5. Inbox capture
  const inboxIdentifier = 'inbox';
  const inboxDir = path.resolve(tasksDir, '..', inboxIdentifier);
  const captureCommand = vscode.commands.registerCommand(
    'pa-hub.capture',
    async () => {
      const title = await vscode.window.showInputBox({
        prompt: 'Note title',
      });
      if (title === undefined) {
        return;
      }
      const body = await vscode.window.showInputBox({
        prompt: 'Note body (optional)',
      });
      if (body === undefined) {
        return;
      }
      const result = createCapture(
        title,
        body,
        null,
        new Date().toISOString(),
        inboxIdentifier
      );
      if (result.ok) {
        await fs.promises.mkdir(inboxDir, { recursive: true });
        await fs.promises.writeFile(
          path.join(inboxDir, result.filename),
          result.content,
          'utf-8'
        );
        vscode.window.showInformationMessage(`Captured: ${result.filename}`);
      } else {
        const reason = 'reason' in result ? result.reason : 'error';
        vscode.window.showErrorMessage(`Capture failed: ${reason}`);
      }
    }
  );

  // 6. Calendar tree view
  const calendarFilePath = resolveCalendarFile(
    os.homedir(),
    process.env.PA_HUB_CALENDAR_FILE
  );
  const calendarProvider = new CalendarTreeDataProvider();
  const calendarTreeView = vscode.window.createTreeView('pa-hub.calendar', {
    treeDataProvider: calendarProvider,
  });

  const refreshCalendar = () => {
    if (!privacyPolicy.isAllowed(calendarFilePath)) {
      calendarProvider.refresh({ status: 'missing', reason: 'blocked by privacy policy' });
      return;
    }
    const data = readCalendar(calendarFilePath);
    calendarProvider.refresh(data);
  };

  const refreshCalendarCommand = vscode.commands.registerCommand(
    'pa-hub.refresh-calendar',
    refreshCalendar
  );

  refreshCalendar();

  const calendarWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(
      vscode.Uri.file(path.dirname(calendarFilePath)),
      'events.json'
    )
  );
  calendarWatcher.onDidChange(refreshCalendar);
  calendarWatcher.onDidCreate(refreshCalendar);
  calendarWatcher.onDidDelete(refreshCalendar);

  // 7. PDCA History tree view
  const pdcaLogsDir = path.join(
    os.homedir(),
    'projects',
    'export-setup',
    'logs',
    'pdca'
  );
  const historyProvider = new HistoryTreeDataProvider();
  const historyTreeView = vscode.window.createTreeView('pa-hub.history', {
    treeDataProvider: historyProvider,
  });

  const refreshHistory = () => {
    historyProvider.refresh(pdcaLogsDir);
  };

  const refreshHistoryCommand = vscode.commands.registerCommand(
    'pa-hub.refresh-history',
    refreshHistory
  );

  refreshHistory();

  const historyWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(
      vscode.Uri.file(pdcaLogsDir),
      '*.yaml'
    )
  );
  historyWatcher.onDidChange(refreshHistory);
  historyWatcher.onDidCreate(refreshHistory);
  historyWatcher.onDidDelete(refreshHistory);

  context.subscriptions.push(
    sourcesTreeView,
    sourcesProvider._onDidChange,
    refreshSourcesCommand,
    usageTreeView,
    usageProvider._onDidChange,
    refreshUsageCommand,
    claudeWatcher,
    { dispose: () => clearInterval(pollingInterval) },
    captureCommand,
    calendarTreeView,
    calendarProvider._onDidChange,
    refreshCalendarCommand,
    calendarWatcher,
    historyTreeView,
    historyProvider._onDidChange,
    refreshHistoryCommand,
    historyWatcher
  );
}
