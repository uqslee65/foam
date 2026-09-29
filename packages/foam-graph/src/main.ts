import './foam-graph';
import { applyExtensionMessage } from './foam-graph';
import { PA_HUB_PROTOCOL_VERSION, type WebviewMessage } from './protocol';
import type { FoamGraph } from './foam-graph';

declare function acquireVsCodeApi(): {
  postMessage: (msg: WebviewMessage) => void;
};

const vscode = (() => {
  try {
    return acquireVsCodeApi();
  } catch {
    // Not in VS Code — provide a mock for browser-based development
    return {
      postMessage: (msg: unknown) => console.log('[mock vscode] postMessage', msg),
    };
  }
})();

const element = document.createElement('foam-graph') as FoamGraph;
element.showControls = true;
document.getElementById('app')!.appendChild(element);

window.addEventListener('message', (event: MessageEvent) => {
  const reply = applyExtensionMessage(element, event.data);
  if (reply) vscode.postMessage(reply);
});

element.addEventListener('node-click', (e: Event) => {
  vscode.postMessage({
    type: 'webviewDidSelectNode',
    payload: (e as CustomEvent).detail,
  });
});

window.addEventListener('error', (error: ErrorEvent) => {
  vscode.postMessage({
    type: 'error',
    payload: {
      message: error.message,
      filename: error.filename,
      lineno: error.lineno,
      colno: error.colno,
      error: error.error,
    },
  });
});

vscode.postMessage({ type: 'webviewDidLoad' });
vscode.postMessage({
  type: 'webviewDidBecomeReady',
  payload: { protocolVersion: PA_HUB_PROTOCOL_VERSION },
});
