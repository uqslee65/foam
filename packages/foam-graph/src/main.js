import './foam-graph';
import { applyExtensionMessage } from './foam-graph';
import { PA_HUB_PROTOCOL_VERSION } from './protocol';
const vscode = (() => {
    try {
        return acquireVsCodeApi();
    }
    catch {
        // Not in VS Code — provide a mock for browser-based development
        return {
            postMessage: (msg) => console.log('[mock vscode] postMessage', msg),
        };
    }
})();
const element = document.createElement('foam-graph');
element.showControls = true;
document.getElementById('app').appendChild(element);
window.addEventListener('message', (event) => {
    const reply = applyExtensionMessage(element, event.data);
    if (reply)
        vscode.postMessage(reply);
});
element.addEventListener('node-click', (e) => {
    vscode.postMessage({
        type: 'webviewDidSelectNode',
        payload: e.detail,
    });
});
window.addEventListener('error', (error) => {
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
