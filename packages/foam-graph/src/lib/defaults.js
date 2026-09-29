function getCSSVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
export function getDefaultStyle() {
    return {
        background: getCSSVar('--vscode-panel-background') || '#202020',
        fontSize: parseInt(getCSSVar('--vscode-font-size') || '12') - 2,
        fontFamily: 'Sans-Serif',
        lineColor: getCSSVar('--vscode-editor-foreground') || '#277da1',
        lineWidth: 0.4,
        particleWidth: 1.0,
        highlightedForeground: getCSSVar('--vscode-list-highlightForeground') || '#f9c74f',
        node: {
            note: getCSSVar('--vscode-editor-foreground') || '#277da1',
            placeholder: getCSSVar('--vscode-list-deemphasizedForeground') || '#545454',
            tag: getCSSVar('--vscode-list-highlightForeground') || '#f9c74f',
        },
        colorMode: 'type',
        groups: [],
    };
}
