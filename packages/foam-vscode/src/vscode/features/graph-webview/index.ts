import * as vscode from 'vscode';
// Native directory events are required for the PA Hub focus-file watcher.
// eslint-disable-next-line no-restricted-imports
import { watch as fsWatch } from 'fs';
import { readFile as fsReadFile } from 'fs/promises';
import { homedir } from 'os';
import { Foam, URI } from '@foam/core';
import { Logger } from '@foam/core';
import { fromVsCodeUri, toVsCodeUri } from '../../utils/vsc-utils';
import { isSome } from '@foam/core';
import { getFoamVsCodeConfig } from '../../config';
import { getActiveTabUri, onDidChangeActiveTab } from '../../services/editor';
import { buildRootQualifiedGraphData } from '../../../pa-hub/graph-data';
import { FocusQueue, watchFocusFile } from '../../../pa-hub/focus';
import { resolveNodeOpen } from '../../../pa-hub/open-node';
import { createPrivacyPolicy } from '../../../pa-hub/privacy';
import type { FocusFs } from '../../../pa-hub/focus';
import type { PrivacyPolicy } from '../../../pa-hub/privacy';
import {
  buildCsp,
  fillGraphHtml,
  generateNonce,
} from '../../../pa-hub/webview-security';
import type {
  GraphStyle,
  GraphViewConfig,
  ShowGraphArgs,
} from '@foam/graph-view/protocol' with { 'resolution-mode': 'import' };
import type { FocusRequest } from '@foam/graph-view/protocol' with { 'resolution-mode': 'import' };
import type { NodeId } from '@foam/graph-view/protocol' with {
  'resolution-mode': 'import',
};

interface GraphWebviewHost {
  webview: vscode.Webview;
}

class GraphWebviewProvider implements vscode.WebviewViewProvider {
  private webviewView: vscode.WebviewView | undefined;
  private idToUri: Map<NodeId, URI> = new Map();
  private policy: PrivacyPolicy;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly foamPromise: Promise<Foam>,
    private readonly focusQueue: FocusQueue
  ) {}

  async resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): Promise<void> {
    this.webviewView = webviewView;

    const datavizUri = vscode.Uri.joinPath(
      this.context.extensionUri,
      'static',
      'dataviz'
    );
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [datavizUri],
    };

    const nonce = generateNonce();
    const csp = buildCsp({
      cspSource: webviewView.webview.cspSource,
      nonce,
    });
    const template = new TextDecoder('utf-8').decode(
      await vscode.workspace.fs.readFile(
        vscode.Uri.joinPath(datavizUri, 'index.html')
      )
    );
    const filled = fillGraphHtml(template, {
      csp,
      nonce,
      resolveAsset: fileName =>
        webviewView.webview
          .asWebviewUri(vscode.Uri.joinPath(datavizUri, fileName))
          .toString(),
    });
    webviewView.webview.html = filled;

    const foam = await this.foamPromise;
    const workspaceFolderFsPaths =
      vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) ??
      [];
    const excludeGlobs = vscode.workspace
      .getConfiguration('pa-hub')
      .get<string[]>('privacy.excludeGlobs', []);
    this.policy = createPrivacyPolicy({
      roots: workspaceFolderFsPaths,
      excludeGlobs,
    });

    webviewView.webview.onDidReceiveMessage(
      async message => {
        switch (message.type) {
          case 'webviewDidLoad': {
            const style = getGraphStyle();
            webviewView.webview.postMessage({
              type: 'didUpdateStyle',
              payload: style,
            });

            this.updateGraph(webviewView, foam);
            break;
          }
          case 'webviewDidSelectNode': {
            const result = resolveNodeOpen(
              message.payload,
              this.idToUri,
              this.policy,
              uri => isSome(foam.workspace.find(uri))
            );
            if (!result.allowed) {
              break;
            }

            const noteUri = toVsCodeUri(result.uri);
            const navigateToPreview = getFoamVsCodeConfig(
              'graph.navigateToPreview',
              false
            );
            const command = getNodeNavigationCommand(
              result.uri.path,
              navigateToPreview
            );
            if (command === 'markdown.showPreview') {
              vscode.commands.executeCommand(command, noteUri);
            } else {
              vscode.commands.executeCommand(
                command,
                noteUri,
                vscode.ViewColumn.One
              );
            }
            break;
          }
          case 'webviewDidBecomeReady': {
            this.focusQueue.markReady();
            for (const request of this.focusQueue.drain()) {
              webviewView.webview.postMessage({
                type: 'didRequestFocus',
                payload: request,
              });
            }
            break;
          }
          case 'error': {
            Logger.error('An error occurred in the graph view', message.payload);
            break;
          }
          case 'webviewDidFocusNode': {
            Logger.info('Focus result', message.payload);
            break;
          }
        }
      },
      undefined,
      this.context.subscriptions
    );

    const noteUpdatedListener = foam.graph.onDidUpdate(() => {
      this.updateGraph(webviewView, foam);
    });
    const editorListener = onDidChangeActiveTab(() => {
      handleActiveResourceChange(
        webviewView,
        foam,
        getActiveTabUri(foam.workspace),
        this.idToUri
      );
    });
    webviewView.onDidDispose(() => {
      noteUpdatedListener.dispose();
      editorListener.dispose();
      this.focusQueue.markNotReady();
      if (this.webviewView === webviewView) {
        this.webviewView = undefined;
      }
    });
  }

  updateStyle(style: GraphStyle): void {
    this.webviewView?.webview.postMessage({
      type: 'didUpdateStyle',
      payload: style,
    });
  }

  private updateGraph(webviewHost: GraphWebviewHost, foam: Foam): void {
    const { graphData, idToUri } = buildRootQualifiedGraphData(
      foam.workspace.list(),
      foam.graph.getAllConnections(),
      vscode.workspace.workspaceFolders?.map(folder => fromVsCodeUri(folder.uri)) ?? []
    );
    this.idToUri = idToUri;

    const maxLen = vscode.workspace
      .getConfiguration('pa-hub.graph')
      .get<number>('titleMaxLength', 24);
    for (const node of Object.values(graphData.nodeInfo)) {
      node.title = cutTitle(node.title, maxLen);
    }

    webviewHost.webview.postMessage({
      type: 'didUpdateGraphData',
      payload: graphData,
    });
  }
}

export default async function activate(
  context: vscode.ExtensionContext,
  foamPromise: Promise<Foam>
) {
  const focusQueue = new FocusQueue();
  const provider = new GraphWebviewProvider(context, foamPromise, focusQueue);
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('pa-hub.graph.style')) {
        provider.updateStyle(getGraphStyle());
      }
    }),
    vscode.window.registerWebviewViewProvider('pa-hub.graph', provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'pa-hub.show-graph',
      () => vscode.commands.executeCommand('pa-hub.graph.focus')
    )
  );

  const focusDir = `${homedir()}/.claude/state`;
  const focusFilename = 'pa-hub-focus.json';
  const workspaceId = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';

  const focusFs: FocusFs = {
    async readFile(filePath: string): Promise<string | null> {
      try {
        return await fsReadFile(filePath, 'utf-8');
      } catch {
        return null;
      }
    },
    watchDir(
      dir: string,
      onChange: () => void,
      onError: (err: unknown) => void
    ): { close(): void } {
      const watcher = fsWatch(dir, { persistent: false }, () => onChange());
      watcher.on('error', onError);
      return { close: () => watcher.close() };
    },
  };

  const focusWatcher = watchFocusFile({
    dir: focusDir,
    filename: focusFilename,
    fs: focusFs,
    workspaceId,
    onRequest: (request: FocusRequest) => focusQueue.enqueue(request),
  });

  context.subscriptions.push({ dispose: () => focusWatcher.dispose() });
}

export function cutTitle(title: string, maxLen: number): string {
  if (maxLen > 0 && title.length > maxLen) {
    return title.substring(0, maxLen).concat('...');
  }
  return title;
}

export function getGraphStyle(): GraphStyle {
  const styleConfig =
    vscode.workspace.getConfiguration('pa-hub.graph').get('style') ?? {};
  return { style: styleConfig };
}

export function viewConfigToStyle(config: GraphViewConfig): GraphStyle {
  const nodeColors = config.show
    ? Object.fromEntries(
        Object.entries(config.show)
          .filter(([, cfg]) => cfg.color)
          .map(([type, cfg]) => [type, cfg.color!])
      )
    : undefined;

  const showNodesOfType = config.show
    ? Object.fromEntries(
        Object.entries(config.show).map(([type, cfg]) => [
          type,
          cfg.enabled ?? true,
        ])
      )
    : undefined;

  const styleProps: Record<string, unknown> = {};
  if (config.background !== undefined)
    styleProps.background = config.background;
  if (config.fontSize !== undefined) styleProps.fontSize = config.fontSize;
  if (config.fontFamily !== undefined)
    styleProps.fontFamily = config.fontFamily;
  if (config.lineColor !== undefined) styleProps.lineColor = config.lineColor;
  if (nodeColors && Object.keys(nodeColors).length > 0)
    styleProps.node = nodeColors;

  return {
    ...(config.colorBy !== undefined ? { colorMode: config.colorBy } : {}),
    ...(config.groups !== undefined ? { groups: config.groups } : {}),
    ...(showNodesOfType !== undefined ? { showNodesOfType } : {}),
    ...(Object.keys(styleProps).length > 0 ? { style: styleProps } : {}),
  };
}

export function mergeStyles(base: GraphStyle, patch: GraphStyle): GraphStyle {
  return {
    colorMode: patch.colorMode ?? base.colorMode,
    groups: patch.groups ?? base.groups,
    showNodesOfType: { ...base.showNodesOfType, ...patch.showNodesOfType },
    style: { ...base.style, ...patch.style },
  };
}

export function resolveViewStyle(args?: ShowGraphArgs): {
  style: GraphStyle;
  view?: string;
} {
  const views: GraphViewConfig[] =
    vscode.workspace.getConfiguration('pa-hub.graph').get('views') ?? [];

  let style: GraphStyle = getGraphStyle();

  // If no view name given and no inline config, fall back to the "Default" named view
  const namedView = args?.view ?? (args?.config ? undefined : 'Default');

  if (namedView) {
    const view = views.find(v => v.name === namedView);
    if (view) {
      style = mergeStyles(style, viewConfigToStyle(view));
    }
  }

  if (args?.config) {
    style = mergeStyles(style, viewConfigToStyle(args.config));
  }

  return { style, view: args?.view };
}

export function handleActiveResourceChange(
  webviewHost: GraphWebviewHost | undefined,
  foam: Foam,
  uri: URI | undefined,
  idToUri: Map<NodeId, URI> = new Map()
) {
  if (webviewHost && uri && uri.scheme !== 'untitled') {
    const note = foam.workspace.find(uri);
    if (isSome(note)) {
      let nodeId: NodeId | undefined;
      for (const [id, resourceUri] of idToUri) {
        if (resourceUri.isEqual(uri)) {
          nodeId = id;
          break;
        }
      }

      if (!nodeId) {
        return;
      }

      webviewHost.webview.postMessage({
        type: 'didSelectNote',
        payload: nodeId,
      });
    }
  }
}

export function getNodeNavigationCommand(
  uriPath: string,
  navigateToPreview: boolean
): string {
  if (navigateToPreview && uriPath.endsWith('.md')) {
    return 'markdown.showPreview';
  }
  return 'vscode.open';
}
