import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  EXTENSION_MESSAGE_TYPES,
  MAX_MESSAGE_CHARS,
  PA_HUB_PROTOCOL_VERSION,
  ROOT_KINDS,
  WEBVIEW_MESSAGE_TYPES,
  isNodeId,
  makeNodeId,
  parseExtensionMessage,
  parseNodeId,
  parseWebviewMessage,
} from '../protocol';

describe('test_graph_protocol_validation', () => {
  it('test_graph_protocol_source_has_no_imports', () => {
    const moduleUrl = import.meta.url.startsWith('file:')
      ? import.meta.url
      : `file://${import.meta.url}`;
    const source = readFileSync(fileURLToPath(new URL('../protocol.ts', moduleUrl)), 'utf8');
    expect(source.split('\n').some((line) => /^\s*import\b/.test(line))).toBe(false);
    expect(/\brequire\(/.test(source)).toBe(false);
    expect(source).toContain('pa-hub.show-graph');
    expect(source).not.toContain('foam-vscode.show-graph');
  });

  it('test_graph_protocol_version_and_roots', () => {
    expect(PA_HUB_PROTOCOL_VERSION).toBe(1);
    expect(ROOT_KINDS).toEqual(['vault', 'sources']);
  });

  it('test_graph_protocol_node_id_accepts', () => {
    const cases = [
      ['vault:notes/a.md', 'vault', 'notes/a.md'],
      ['sources:papers/x.pdf', 'sources', 'papers/x.pdf'],
      ['vault:deep/dir/file name.md', 'vault', 'deep/dir/file name.md'],
    ] as const;

    for (const [value, root, path] of cases) {
      expect(parseNodeId(value)).toEqual({ root, path });
      expect(makeNodeId(root, path)).toBe(value);
    }
  });

  it('test_graph_protocol_node_id_rejects', () => {
    const invalid = [
      'file:///etc/passwd',
      'command:pa-hub.open',
      'vscode://x',
      'vault:/abs.md',
      'vault:../x.md',
      'vault:a/../b.md',
      'vault:a//b',
      'vault:',
      'notes/a.md',
      'VAULT:a.md',
      'vault:a\\b.md',
      'vault:%2e%2e/x',
      'vault:a%2Fb',
      'vault:http://x',
      'vault:a\u0000b',
      42,
      null,
      {},
      `vault:${'a'.repeat(1025)}`,
    ];

    for (const value of invalid) {
      expect(parseNodeId(value)).toBeNull();
      expect(isNodeId(value)).toBe(false);
    }
    expect(() => makeNodeId('vault', '../x')).toThrow(RangeError);
  });

  it('test_graph_protocol_extension_message_legacy_variants', () => {
    const styleInput = { type: 'didUpdateStyle', payload: { colorMode: 'type' } };
    const style = parseExtensionMessage(styleInput);
    expect(style.ok).toBe(true);
    expect(style.value).not.toBe(styleInput);

    const graphInput = {
      type: 'didUpdateGraphData',
      payload: {
        nodeInfo: {
          'vault:a.md': {
            id: 'vault:a.md',
            type: 'note',
            title: 'A',
            properties: {},
            tags: [],
            root: 'vault',
          },
          'sources:b.pdf': {
            id: 'sources:b.pdf',
            type: 'attachment',
            title: 'B',
            properties: {},
            tags: [],
            root: 'sources',
          },
        },
        links: [{ source: 'vault:a.md', target: 'sources:b.pdf' }],
        rootGroups: [
          { root: 'vault', label: 'Vault', color: '#112233' },
          { root: 'sources', label: 'Sources', color: '#aAbBcC' },
        ],
        protocolVersion: 1,
      },
    };
    const graph = parseExtensionMessage(graphInput);
    expect(graph.ok).toBe(true);
    expect(graph.value).not.toBe(graphInput);

    const selected = parseExtensionMessage({ type: 'didSelectNote', payload: 'vault:a.md' });
    expect(selected.ok).toBe(true);
  });

  it('test_graph_protocol_extension_message_focus_visibility', () => {
    expect(
      parseExtensionMessage({
        type: 'didRequestFocus',
        payload: { requestId: 'r-1', nodeId: 'vault:a.md', center: true },
      }).ok,
    ).toBe(true);
    expect(
      parseExtensionMessage({ type: 'didChangeVisibility', payload: { visible: false } }).ok,
    ).toBe(true);

    const badNode = parseExtensionMessage({
      type: 'didRequestFocus',
      payload: { requestId: 'r-1', nodeId: 'file:///x' },
    });
    expect(badNode.ok).toBe(false);
    expect(!badNode.ok && badNode.reason.startsWith('bad_')).toBe(true);

    const badRequestId = parseExtensionMessage({
      type: 'didRequestFocus',
      payload: { requestId: 'bad id!', nodeId: 'vault:a.md' },
    });
    expect(badRequestId.ok).toBe(false);
  });

  it('test_graph_protocol_webview_message_variants', () => {
    expect(parseWebviewMessage({ type: 'webviewDidLoad' }).ok).toBe(true);
    expect(parseWebviewMessage({ type: 'webviewDidLoad', payload: {} }).ok).toBe(false);
    expect(parseWebviewMessage({ type: 'webviewDidSelectNode', payload: 'vault:a.md' }).ok).toBe(
      true,
    );
    const rawPath = parseWebviewMessage({
      type: 'webviewDidSelectNode',
      payload: '/path/to/note.md',
    });
    expect(rawPath.ok).toBe(false);
    expect(
      parseWebviewMessage({ type: 'webviewDidBecomeReady', payload: { protocolVersion: 1 } }).ok,
    ).toBe(true);
    expect(
      parseWebviewMessage({ type: 'webviewDidBecomeReady', payload: { protocolVersion: 0 } }).ok,
    ).toBe(false);
    expect(
      parseWebviewMessage({ type: 'webviewDidBecomeReady', payload: { protocolVersion: '1' } }).ok,
    ).toBe(false);
    expect(
      parseWebviewMessage({
        type: 'webviewDidFocusNode',
        payload: { requestId: 'r-1', nodeId: 'vault:a.md', ok: true },
      }).ok,
    ).toBe(true);
  });

  it('test_graph_protocol_error_payload_sanitized', () => {
    expect(
      parseWebviewMessage({
        type: 'error',
        payload: {
          message: 'x'.repeat(5000),
          filename: 'file.ts',
          lineno: 1,
          colno: 1,
          error: { stack: 'stack' },
        },
      }).ok,
    ).toBe(false);

    const result = parseWebviewMessage({
      type: 'error',
      payload: {
        message: 'x'.repeat(100),
        filename: 'file.ts',
        lineno: 1,
        colno: 1,
        error: { stack: 'stack' },
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect('error' in result.value.payload).toBe(false);
    }
    expect(
      parseWebviewMessage({
        type: 'error',
        payload: { message: 'x', filename: 'file.ts', lineno: -1, colno: 1 },
      }).ok,
    ).toBe(false);
    expect(
      parseWebviewMessage({
        type: 'error',
        payload: { message: 'x', filename: 'file.ts', lineno: Number.NaN, colno: 1 },
      }).ok,
    ).toBe(false);
  });

  it('test_graph_protocol_rejects_shapes', () => {
    const forbidden = JSON.parse(
      '{"type":"didSelectNote","payload":"vault:a.md","__proto__":{}}',
    );
    const nullPrototype = Object.create(null) as { type: string; payload: string };
    nullPrototype.type = 'didSelectNote';
    nullPrototype.payload = 'vault:a.md';
    const cases = [
      [null, 'not_object'],
      ['string', 'not_object'],
      [7, 'not_object'],
      [[], 'not_object'],
      [new Date(), 'not_object'],
      [forbidden, 'forbidden_key'],
      [nullPrototype, 'not_object'],
      [{ type: 'nope' }, 'unknown_type'],
      [{ type: 'didSelectNote' }, 'bad_payload'],
      [{ type: 'didSelectNote', payload: 'vault:a.md', extra: 1 }, 'extra_key'],
    ] as const;

    for (const [input, reason] of cases) {
      const result = parseExtensionMessage(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason.startsWith(reason)).toBe(true);
      }
    }
  });

  it('test_graph_protocol_rejects_oversized', () => {
    const input = {
      type: 'didUpdateGraphData',
      payload: {
        nodeInfo: {
          'vault:a.md': {
            id: 'vault:a.md',
            type: 'note',
            title: 'x'.repeat(3_000_000),
            properties: {},
            tags: [],
          },
        },
        links: [],
      },
    };
    const oversized = parseExtensionMessage(input);
    expect(oversized.ok).toBe(false);
    if (!oversized.ok) {
      expect(oversized.reason).toBe('too_large');
    }
    expect(parseExtensionMessage(input, { maxChars: 10_000_000 }).ok).toBe(true);

    const cyclic: { type: string; payload: unknown; self?: unknown } = {
      type: 'didSelectNote',
      payload: 'vault:a.md',
    };
    cyclic.self = cyclic;
    const unserializable = parseExtensionMessage(cyclic);
    expect(unserializable.ok).toBe(false);
    if (!unserializable.ok) {
      expect(unserializable.reason).toBe('unserializable');
    }
    expect(MAX_MESSAGE_CHARS).toBe(2_000_000);
  });

  it('test_graph_protocol_graph_data_integrity', () => {
    const base = {
      type: 'didUpdateGraphData',
      payload: {
        nodeInfo: {
          'vault:a.md': {
            id: 'vault:a.md',
            type: 'note',
            title: 'A',
            properties: {},
            tags: [],
          },
        },
        links: [],
      },
    };
    expect(
      parseExtensionMessage({
        ...base,
        payload: { ...base.payload, links: [{ source: 'vault:a.md', target: 'vault:missing.md' }] },
      }).ok,
    ).toBe(false);
    expect(
      parseExtensionMessage({
        ...base,
        payload: {
          ...base.payload,
          nodeInfo: { 'vault:a.md': { ...base.payload.nodeInfo['vault:a.md'], id: 'vault:b.md' } },
        },
      }).ok,
    ).toBe(false);
    expect(
      parseExtensionMessage({
        ...base,
        payload: {
          ...base.payload,
          rootGroups: [
            { root: 'vault', label: 'A', color: '#112233' },
            { root: 'vault', label: 'B', color: '#445566' },
          ],
        },
      }).ok,
    ).toBe(false);
    expect(
      parseExtensionMessage({
        ...base,
        payload: { ...base.payload, rootGroups: [{ root: 'vault', label: 'A', color: 'red' }] },
      }).ok,
    ).toBe(false);
    expect(
      parseExtensionMessage({ ...base, payload: { ...base.payload, protocolVersion: 2 } }).ok,
    ).toBe(false);
    expect(
      parseExtensionMessage({
        ...base,
        payload: {
          ...base.payload,
          nodeInfo: { 'vault:a.md': { ...base.payload.nodeInfo['vault:a.md'], root: 'other' } },
        },
      }).ok,
    ).toBe(false);
  });

  it('test_graph_protocol_message_type_tables', () => {
    expect(EXTENSION_MESSAGE_TYPES).toEqual([
      'didUpdateStyle',
      'didUpdateGraphData',
      'didSelectNote',
      'didRequestFocus',
      'didChangeVisibility',
    ]);
    expect(WEBVIEW_MESSAGE_TYPES).toEqual([
      'webviewDidLoad',
      'webviewDidSelectNode',
      'error',
      'webviewDidBecomeReady',
      'webviewDidFocusNode',
    ]);

    const extensionCases: Array<[string, unknown]> = [
      ['didUpdateStyle', {}],
      ['didUpdateGraphData', { nodeInfo: {}, links: [] }],
      ['didSelectNote', 'vault:a.md'],
      ['didRequestFocus', { requestId: 'r-1', nodeId: 'vault:a.md' }],
      ['didChangeVisibility', { visible: true }],
    ];
    for (const [type, payload] of extensionCases) {
      expect(parseExtensionMessage({ type, payload }).ok).toBe(true);
      const other = parseWebviewMessage({ type, payload });
      expect(other.ok).toBe(false);
      if (!other.ok) {
        expect(other.reason).toBe('unknown_type');
      }
    }

    const webviewCases: Array<[string, unknown?, boolean?]> = [
      ['webviewDidLoad', undefined, false],
      ['webviewDidSelectNode', 'vault:a.md'],
      ['error', { message: 'x', filename: 'file.ts', lineno: 0, colno: 0 }],
      ['webviewDidBecomeReady', { protocolVersion: 1 }],
      ['webviewDidFocusNode', { requestId: 'r-1', nodeId: 'vault:a.md', ok: true }],
    ];
    for (const [type, payload, hasPayload] of webviewCases) {
      const input = hasPayload === false ? { type } : { type, payload };
      expect(parseWebviewMessage(input).ok).toBe(true);
      const other = parseExtensionMessage(input);
      expect(other.ok).toBe(false);
      if (!other.ok) {
        expect(other.reason).toBe('unknown_type');
      }
    }
  });

  it('test_graph_protocol_value_is_fresh_and_frozen_free', () => {
    const input = {
      type: 'didUpdateStyle',
      payload: {
        colorMode: 'directory',
        groups: [
          {
            id: 'notes',
            label: 'Notes',
            color: '#112233',
            enabled: true,
            match: { property: 'type', value: 'note' },
          },
        ],
        style: { node: { note: '#ffffff' } },
      },
    };
    const result = parseExtensionMessage(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(input);
      expect(result.value).not.toBe(input);
      expect(result.value.payload).not.toBe(input.payload);
      expect(result.value.payload.groups).not.toBe(input.payload.groups);
      input.payload.groups[0].label = 'changed';
      input.payload.style.node.note = '#000000';
      expect(result.value.payload.groups?.[0].label).toBe('Notes');
      expect(result.value.payload.style?.node?.note).toBe('#ffffff');
    }
  });
});
