import { describe, expect, it } from 'vitest';
import {
  buildCsp,
  fillGraphHtml,
  generateNonce,
} from '../webview-security';

const GRAPH_HTML_TEMPLATE = `<!DOCTYPE html>
<html>
  <head>
    <meta http-equiv="Content-Security-Policy" content="__PA_HUB_CSP__" />
    <meta charset="utf-8" />
    <link data-replace href="./main.css" rel="stylesheet" nonce="__PA_HUB_NONCE__" />
  </head>
  <body>
    <div id="app"></div>
    <script data-replace src="./main.js" nonce="__PA_HUB_NONCE__"></script>
  </body>
</html>`;

describe('webview security', () => {
  it('test_webview_security_nonce_length', () => {
    expect(generateNonce()).toHaveLength(64);
  });

  it('test_webview_security_nonce_uniqueness', () => {
    expect(generateNonce()).not.toBe(generateNonce());
  });

  it('test_webview_security_nonce_hex_only', () => {
    expect(generateNonce()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('test_webview_security_csp_contains_nonce', () => {
    const nonce = 'NONCE';
    expect(buildCsp({ cspSource: 'SOURCE', nonce })).toContain(
      `nonce-${nonce}`
    );
  });

  it('test_webview_security_csp_contains_csp_source', () => {
    const cspSource = 'vscode-webview://test';
    expect(buildCsp({ cspSource, nonce: 'NONCE' })).toContain(cspSource);
  });

  it('test_webview_security_csp_unsafe_inline', () => {
    expect(buildCsp({ cspSource: 'SOURCE', nonce: 'NONCE' })).toMatch(
      /style-src [^;]+ 'unsafe-inline'/
    );
  });

  it('test_webview_security_csp_default_none', () => {
    expect(buildCsp({ cspSource: 'SOURCE', nonce: 'NONCE' })).toMatch(
      /^default-src 'none'/
    );
  });

  it('test_webview_security_fill_replaces_csp', () => {
    const filled = fillGraphHtml(GRAPH_HTML_TEMPLATE, {
      csp: 'CSP_VALUE',
      nonce: 'NONCE',
      resolveAsset: filename => filename,
    });

    expect(filled).toContain('content="CSP_VALUE"');
  });

  it('test_webview_security_fill_replaces_nonce', () => {
    const filled = fillGraphHtml(GRAPH_HTML_TEMPLATE, {
      csp: 'CSP_VALUE',
      nonce: 'NONCE',
      resolveAsset: filename => filename,
    });

    expect(filled.match(/nonce="NONCE"/g)).toHaveLength(2);
  });

  it('test_webview_security_fill_no_placeholders', () => {
    const filled = fillGraphHtml(GRAPH_HTML_TEMPLATE, {
      csp: 'CSP_VALUE',
      nonce: 'NONCE',
      resolveAsset: filename => filename,
    });

    expect(filled).not.toContain('__PA_HUB_');
  });

  it('test_webview_security_fill_data_replace', () => {
    const resolvedFilenames: string[] = [];
    const filled = fillGraphHtml(GRAPH_HTML_TEMPLATE, {
      csp: 'CSP_VALUE',
      nonce: 'NONCE',
      resolveAsset: filename => {
        resolvedFilenames.push(filename);
        return `https://webview-uri/${filename.slice(2)}`;
      },
    });

    expect(resolvedFilenames).toEqual(['./main.css', './main.js']);
    expect(filled).toContain('href="https://webview-uri/main.css"');
    expect(filled).toContain('src="https://webview-uri/main.js"');
    expect(filled).not.toContain('data-replace');
  });

  it('test_webview_security_fill_preserves_structure', () => {
    const csp = buildCsp({ cspSource: 'SOURCE', nonce: 'NONCE' });
    const filled = fillGraphHtml(GRAPH_HTML_TEMPLATE, {
      csp,
      nonce: 'NONCE',
      resolveAsset: filename => `https://webview-uri/${filename.slice(2)}`,
    });

    expect(filled).toMatch(/^<!DOCTYPE html>[\s\S]*<\/html>$/);
    expect(filled).toContain(
      `<meta http-equiv="Content-Security-Policy" content="${csp}" />`
    );
    expect(filled).toContain('<div id="app"></div>');
  });

  it('test_webview_security_csp_exact_format', () => {
    expect(buildCsp({ cspSource: 'SOURCE', nonce: 'NONCE' })).toBe(
      "default-src 'none'; script-src 'nonce-NONCE'; style-src SOURCE 'unsafe-inline'; img-src SOURCE; font-src SOURCE"
    );
  });
});
