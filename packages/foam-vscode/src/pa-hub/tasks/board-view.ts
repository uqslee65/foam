import * as vscode from 'vscode';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { snapshotToBoardData, buildBoardHtml } from './board';
import {
  selectNewestDailyFile,
  snapshotFromFiles,
  type TaskSnapshot,
} from './snapshot';
import { createTaskWriter, type TaskWriteFs, type TaskWriter } from './write';

function isFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

async function loadSnapshot(dir: string): Promise<TaskSnapshot | null> {
  try {
    const filenames = await fs.promises.readdir(dir);
    const filename = selectNewestDailyFile(filenames);
    if (filename === null) return null;

    const filePath = path.join(dir, filename);
    const [content, fileStat] = await Promise.all([
      fs.promises.readFile(filePath, 'utf-8'),
      fs.promises.stat(filePath),
    ]);

    const result = await snapshotFromFiles(
      filenames,
      async candidate => (candidate === filename ? content : null),
      candidate => (candidate === filename ? String(fileStat.mtimeMs) : '')
    );
    return result.ok ? result.snapshot : null;
  } catch (error) {
    if (!isFileNotFoundError(error)) {
      console.error(error);
    }
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
    let mutationQueue: Promise<void> = Promise.resolve();

    function enqueueMutation(mutation: () => Promise<void>): Promise<void> {
      const next = mutationQueue.then(mutation);
      mutationQueue = next.catch(() => {});
      return next;
    }

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

    watcher.onDidChange(() => {
      void refresh().catch(error => console.error(error));
    });
    watcher.onDidCreate(() => {
      void refresh().catch(error => console.error(error));
    });
    watcher.onDidDelete(() => {
      void refresh().catch(error => console.error(error));
    });

    panel.webview.onDidReceiveMessage(msg => {
      if (msg.type === 'toggle') {
        void enqueueMutation(async () => {
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
        }).catch(error => console.error(error));
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
