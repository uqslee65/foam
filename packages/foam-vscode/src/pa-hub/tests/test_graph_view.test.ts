import { beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { URI } from '@foam/core';
// @ts-expect-error The graph-view package publishes its runtime protocol as ESM while this package type-checks as CommonJS.
import { makeNodeId } from '@foam/graph-view/protocol';
import type { NodeId } from '@foam/graph-view/protocol' with {
  'resolution-mode': 'import',
};
import { resolveNodeOpen } from '../open-node';
import { createPrivacyPolicy } from '../privacy';
// Provider focus wiring is integration-level; these tests stay on pure helpers.
import {
  cutTitle,
  getGraphStyle,
  getNodeNavigationCommand,
  handleActiveResourceChange,
  mergeStyles,
  resolveViewStyle,
  viewConfigToStyle,
} from '../../vscode/features/graph-webview/index';

beforeEach(async () => {
  const config = vscode.workspace.getConfiguration();
  await config.update('pa-hub.graph.style', {});
  await config.update('pa-hub.graph.titleMaxLength', 24);
  await config.update('pa-hub.graph.views', []);
});

describe('graph view helpers', () => {
  it('test_graph_view_get_node_nav_md_preview', () => {
    expect(getNodeNavigationCommand('/notes/foo.md', true)).toBe(
      'markdown.showPreview'
    );
  });

  it('test_graph_view_get_node_nav_md_no_preview', () => {
    expect(getNodeNavigationCommand('/notes/foo.md', false)).toBe('vscode.open');
  });

  it('test_graph_view_get_node_nav_non_md', () => {
    expect(getNodeNavigationCommand('/notes/foo.txt', true)).toBe('vscode.open');
  });

  it('test_graph_view_merge_styles_patch_wins', () => {
    const merged = mergeStyles(
      { colorMode: 'none' },
      { colorMode: 'directory' }
    );
    expect(merged.colorMode).toBe('directory');
  });

  it('test_graph_view_merge_styles_base_preserved', () => {
    const merged = mergeStyles(
      { showNodesOfType: { tag: true, placeholder: false } },
      { colorMode: 'type' }
    );
    expect(merged.showNodesOfType).toEqual({ tag: true, placeholder: false });
  });

  it('test_graph_view_view_config_colors', () => {
    expect(
      viewConfigToStyle({ show: { tag: { color: '#ff0000' } } })
    ).toEqual({
      showNodesOfType: { tag: true },
      style: { node: { tag: '#ff0000' } },
    });
  });

  it('test_graph_view_view_config_visibility', () => {
    expect(
      viewConfigToStyle({
        show: { tag: { enabled: false }, placeholder: { enabled: true } },
      })
    ).toEqual({
      showNodesOfType: { tag: false, placeholder: true },
    });
  });

  it('test_graph_view_view_config_empty', () => {
    expect(viewConfigToStyle({})).toEqual({});
  });

  it('test_graph_view_get_graph_style_reads_config', async () => {
    await vscode.workspace
      .getConfiguration()
      .update('pa-hub.graph.style', { background: '#123456' });

    expect(getGraphStyle()).toEqual({
      style: { background: '#123456' },
    });
  });

  it('test_graph_view_cut_title_truncates', async () => {
    expect(cutTitle('Long title', 5)).toBe('Long ...');
  });

  it('test_graph_view_cut_title_short_passthrough', async () => {
    expect(cutTitle('Short title', 20)).toBe('Short title');
  });

  it('test_graph_view_resolve_view_no_args', () => {
    expect(resolveViewStyle()).toEqual({
      style: { style: {} },
      view: undefined,
    });
  });

  it('test_graph_view_handle_active_resource_no_args', () => {
    expect(() =>
      handleActiveResourceChange(undefined, {} as any, URI.file('/note.md'))
    ).not.toThrow();
  });

  it('test_graph_view_cut_title_parameterized', () => {
    expect(cutTitle('long title here', 5)).toBe('long ...');
  });

  it('test_graph_view_cut_title_zero_maxlen', () => {
    expect(cutTitle('any', 0)).toBe('any');
  });

  it('test_graph_view_cut_title_negative_maxlen', () => {
    expect(cutTitle('any', -1)).toBe('any');
  });

  it('test_graph_view_resolve_node_open_stale_mapping', () => {
    const nodeId = makeNodeId('vault', 'notes/stale.md');
    const uri = URI.file('/workspace/stale.md');
    const result = resolveNodeOpen(
      nodeId,
      new Map<NodeId, URI>([[nodeId, uri]]),
      createPrivacyPolicy({ roots: [], excludeGlobs: [] }),
      () => false
    );

    expect(result).toEqual({
      allowed: false,
      reason: 'stale_mapping',
      nodeId,
      uri,
    });
  });
});
