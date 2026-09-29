import * as vscode from 'vscode';
import {
  createTaskTree,
  type TaskTree,
  type TaskGroupNode,
  type TaskItemNode,
  type TaskTreeElement,
} from './tree';
import { snapshotFromFiles, type TaskSnapshot } from './snapshot';
import {
  createTaskWriter,
  type TaskWriteFs,
  type TaskWriter,
} from './write';
import * as fs from 'node:fs';
import * as path from 'node:path';

async function loadSnapshot(dir: string): Promise<TaskSnapshot | null> {
  try {
    const filenames = await fs.promises.readdir(dir);
    const contents = new Map<string, string | null>();
    const revisions = new Map<string, string>();

    await Promise.all(
      filenames.map(async filename => {
        try {
          const [content, fileStat] = await Promise.all([
            fs.promises.readFile(path.join(dir, filename), 'utf-8'),
            fs.promises.stat(path.join(dir, filename)),
          ]);
          contents.set(filename, content);
          revisions.set(filename, String(fileStat.mtimeMs));
        } catch {
          contents.set(filename, null);
        }
      })
    );

    const result = snapshotFromFiles(
      filenames,
      filename => contents.get(filename) ?? null,
      filename => revisions.get(filename) ?? ''
    );
    return result.ok ? result.snapshot : null;
  } catch {
    return null;
  }
}

const writeFs: TaskWriteFs = {
  listDir: dir => fs.promises.readdir(dir),
  readFile: filePath =>
    fs.promises.readFile(filePath, 'utf-8').catch(() => null),
  stat: async filePath => {
    try {
      const fileStat = await fs.promises.stat(filePath);
      return { revision: String(fileStat.mtimeMs), mode: fileStat.mode };
    } catch {
      return null;
    }
  },
  writeFile: (filePath, content, mode) =>
    fs.promises.writeFile(filePath, content, { mode }),
  rename: (from, to) => fs.promises.rename(from, to),
};

class TasksTreeDataProvider
  implements vscode.TreeDataProvider<TaskTreeElement>
{
  readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private readonly tree: TaskTree) {
    tree.onDidChange(() => this._onDidChange.fire());
  }

  getTreeItem(element: TaskTreeElement): vscode.TreeItem {
    if (element.kind === 'group') {
      const group: TaskGroupNode = element;
      const item = new vscode.TreeItem(
        group.label,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      item.contextValue = 'taskGroup';
      return item;
    }

    const task: TaskItemNode = element;
    const item = new vscode.TreeItem(
      task.text,
      vscode.TreeItemCollapsibleState.None
    );
    item.checkboxState = task.checked
      ? vscode.TreeItemCheckboxState.Checked
      : vscode.TreeItemCheckboxState.Unchecked;
    item.contextValue = 'taskItem';
    item.description = task.quadrant;
    return item;
  }

  getChildren(element?: TaskTreeElement): TaskTreeElement[] {
    return [...this.tree.getChildren(element)];
  }
}

export function activateTasksTree(
  context: vscode.ExtensionContext,
  tasksDir: string
): void {
  const tree = createTaskTree();
  const writer: TaskWriter = createTaskWriter(writeFs);
  const provider = new TasksTreeDataProvider(tree);
  const treeView = vscode.window.createTreeView('pa-hub.tasks', {
    treeDataProvider: provider,
    manageCheckboxStateManually: true,
  });
  let currentSnapshot: TaskSnapshot | null = null;
  let mutationQueue: Promise<void> = Promise.resolve();

  function enqueueMutation(mutation: () => Promise<void>): Promise<void> {
    const next = mutationQueue.then(mutation);
    mutationQueue = next.catch(() => {});
    return next;
  }

  treeView.onDidChangeCheckboxState(event => {
    void enqueueMutation(async () => {
      for (const [item, state] of event.items) {
        if (item.kind !== 'item') continue;
        const snapshot = currentSnapshot;
        if (!snapshot) continue;

        const checked = state === vscode.TreeItemCheckboxState.Checked;
        const result = await writer.toggle(
          tasksDir,
          snapshot,
          item.identity,
          checked
        );
        if (result.ok) {
          currentSnapshot = await loadSnapshot(tasksDir);
          if (currentSnapshot) tree.refresh(currentSnapshot);
        }
      }
    }).catch(error => console.error(error));
  });

  async function mutateAndRefresh(
    fn: (snap: TaskSnapshot) => Promise<{ ok: boolean }>
  ): Promise<void> {
    if (!currentSnapshot) return;
    const result = await fn(currentSnapshot);
    if (result.ok) {
      currentSnapshot = await loadSnapshot(tasksDir);
      if (currentSnapshot) tree.refresh(currentSnapshot);
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('pa-hub.task-move-up', (node: TaskItemNode) => {
      if (!node?.identity) return;
      return enqueueMutation(() =>
        mutateAndRefresh(snap => writer.move(tasksDir, snap, node.identity, 'up'))
      );
    }),
    vscode.commands.registerCommand('pa-hub.task-move-down', (node: TaskItemNode) => {
      if (!node?.identity) return;
      return enqueueMutation(() =>
        mutateAndRefresh(snap => writer.move(tasksDir, snap, node.identity, 'down'))
      );
    }),
    vscode.commands.registerCommand('pa-hub.task-set-quadrant', async (node: TaskItemNode) => {
      if (!node?.identity) return;
      const pick = await vscode.window.showQuickPick(
        ['Q1', 'Q2', 'Q3', 'Q4'],
        { placeHolder: 'Assign quadrant' }
      );
      if (!pick) return;
      return enqueueMutation(() =>
        mutateAndRefresh(snap =>
          writer.setQuadrant(tasksDir, snap, node.identity, pick)
        )
      );
    }),
    vscode.commands.registerCommand('pa-hub.task-dispatch', (node: TaskItemNode) => {
      if (!node?.identity) return;
      if (!currentSnapshot) return;
      const task = currentSnapshot.tasks.find(t => t.identity === node.identity);
      const slug = task?.meta.pdca;
      if (!slug) {
        vscode.window.showInformationMessage('No PDCA cycle linked. Add pdca:<slug> to task metadata.');
        return;
      }
      const terminal = vscode.window.createTerminal({ name: `dispatch: ${slug}` });
      terminal.sendText(
        `cd ~/projects/export-setup && bash scripts/pal_dispatch.sh -b -m gemini-3.8-flash --slug ${slug}`
      );
      terminal.show();
    })
  );

  async function refreshFromDisk(): Promise<void> {
    currentSnapshot = await loadSnapshot(tasksDir);
    if (currentSnapshot) tree.refresh(currentSnapshot);
  }

  void refreshFromDisk().catch(error => console.error(error));

  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.Uri.file(tasksDir), '*.md')
  );
  watcher.onDidChange(() => {
    void refreshFromDisk().catch(error => console.error(error));
  });
  watcher.onDidCreate(() => {
    void refreshFromDisk().catch(error => console.error(error));
  });
  watcher.onDidDelete(() => {
    void refreshFromDisk().catch(error => console.error(error));
  });

  context.subscriptions.push(treeView, watcher, provider._onDidChange);
}
