import * as vscode from 'vscode';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { snapshotToBoardData, buildBoardHtml } from './board';
import { snapshotFromFiles, type TaskSnapshot } from './snapshot';
import { createTaskWriter, type TaskWriteFs, type TaskWriter } from './write';

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

export function activateBoardView(
  context: vscode.ExtensionContext,
  tasksDir: string
): void {
  let currentPanel: vscode.WebviewPanel | undefined;
  const writer: TaskWriter = createTaskWriter(writeFs);

  const openBoard = async () => {
    if (currentPanel) {
      currentPanel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    const staticDir = vscode.Uri.file(
      path.join(context.extensionPath, 'static', 'pa-hub')
    );

    const panel = vscode.window.createWebviewPanel(
      'pa-hub.board',
      'Task Board',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [staticDir],
      }
    );

    currentPanel = panel;

    const nonce = crypto.randomBytes(16).toString('hex');
    const scriptUri = panel.webview.asWebviewUri(
      vscode.Uri.file(
        path.join(context.extensionPath, 'static', 'pa-hub', 'board.js')
      )
    );
    const styleUri = panel.webview.asWebviewUri(
      vscode.Uri.file(
        path.join(context.extensionPath, 'static', 'pa-hub', 'board.css')
      )
    );

    panel.webview.html = buildBoardHtml({
      nonce,
      scriptUri: scriptUri.toString(),
      styleUri: styleUri.toString(),
      cspSource: panel.webview.cspSource,
    });

    let currentSnapshot: TaskSnapshot | null = null;

    async function refresh(): Promise<void> {
      currentSnapshot = await loadSnapshot(tasksDir);
      if (currentSnapshot) {
        const data = snapshotToBoardData(currentSnapshot);
        panel.webview.postMessage({ type: 'update', data });
      }
    }

    await refresh();

    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(tasksDir, '*.md')
    );

    watcher.onDidChange(() => refresh());
    watcher.onDidCreate(() => refresh());
    watcher.onDidDelete(() => refresh());

    panel.webview.onDidReceiveMessage(async msg => {
      if (msg.type === 'toggle') {
        const snapshot = currentSnapshot ?? (await loadSnapshot(tasksDir));
        if (snapshot) {
          const result = await writer.toggle(
            tasksDir,
            snapshot,
            msg.identity,
            msg.checked
          );
          if (result.ok) {
            currentSnapshot = await loadSnapshot(tasksDir);
          }
        }
      }
    });

    panel.onDidDispose(() => {
      watcher.dispose();
      currentPanel = undefined;
    });

    context.subscriptions.push(panel, watcher);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('pa-hub.show-board', openBoard),
    vscode.commands.registerCommand('pa-hub.open-board', openBoard)
  );
}
