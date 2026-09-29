import { describe, expect, it, vi } from 'vitest';
import type { TemplateResult } from 'lit';

import {
  applyExtensionMessage,
  COMPACT_MAX_WIDTH,
  computeLayoutMode,
  deriveRootGroupRules,
  FoamGraph,
} from '../foam-graph';
import { GraphCanvas } from '../components/graph-canvas';
import type { GraphData, GroupRule, RootGroup } from '../protocol';

const makeNode = (id: string, type: string, title = id) => ({
  id,
  type,
  title,
  properties: {},
  tags: [],
});

const makeGraph = (nodeInfo: GraphData['nodeInfo']): GraphData => ({
  nodeInfo,
  links: [],
});

const hasControlPanel = (template: TemplateResult): boolean =>
  template.values.some(
    value =>
      value != null &&
      typeof value === 'object' &&
      'strings' in value &&
      (value as TemplateResult).strings.some(strings =>
        strings.includes('foam-control-panel')
      )
  );

const valuesAfter = (template: TemplateResult, marker: string): unknown[] =>
  template.values.filter((_, index) => template.strings[index].includes(marker));

describe('graph renderer', () => {
  it('test_graph_renderer_layout_mode_threshold', () => {
    expect(COMPACT_MAX_WIDTH).toBe(480);
    expect(computeLayoutMode(479)).toBe('compact');
    expect(computeLayoutMode(480)).toBe('wide');
    expect(computeLayoutMode(1024)).toBe('wide');
    expect(computeLayoutMode(0)).toBeNull();
    expect(computeLayoutMode(Number.NaN)).toBeNull();
  });

  it('test_graph_renderer_compact_hides_controls', () => {
    const element = new FoamGraph();
    element.showControls = true;
    element.layoutMode = 'compact';
    expect(hasControlPanel(element.render() as TemplateResult)).toBe(false);

    element.layoutMode = 'wide';
    expect(hasControlPanel(element.render() as TemplateResult)).toBe(true);
  });

  it('test_graph_renderer_root_group_rules_derived', () => {
    const rootGroups: RootGroup[] = [
      { root: 'vault', label: 'Vault', color: '#112233' },
      { root: 'sources', label: 'Sources', color: '#445566' },
    ];

    expect(deriveRootGroupRules(rootGroups)).toEqual([
      {
        id: 'root:vault',
        label: 'Vault',
        color: '#112233',
        enabled: true,
        match: { property: 'path', value: '/^vault:/' },
      },
      {
        id: 'root:sources',
        label: 'Sources',
        color: '#445566',
        enabled: true,
        match: { property: 'path', value: '/^sources:/' },
      },
    ]);
    expect(deriveRootGroupRules(undefined)).toEqual([]);
  });

  it('test_graph_renderer_root_groups_follow_user_groups', () => {
    const userGroup: GroupRule = {
      id: 'user',
      label: 'User',
      color: '#000000',
      enabled: true,
      match: { property: 'type', value: 'note' },
    };
    const element = new FoamGraph();
    element.showControls = true;
    element.graphData = {
      ...makeGraph({}),
      rootGroups: [
        { root: 'vault', label: 'Vault', color: '#112233' },
        { root: 'sources', label: 'Sources', color: '#445566' },
      ],
    };
    (element as any).updated(new Map([['graphData', null]]));
    element.graphStyle = { groups: [userGroup] };
    (element as any).updated(new Map([['graphStyle', null]]));

    const template = element.render() as TemplateResult;
    expect(valuesAfter(template, '.groups=')).toEqual([
      [
        userGroup,
        {
          id: 'root:vault',
          label: 'Vault',
          color: '#112233',
          enabled: true,
          match: { property: 'path', value: '/^vault:/' },
        },
        {
          id: 'root:sources',
          label: 'Sources',
          color: '#445566',
          enabled: true,
          match: { property: 'path', value: '/^sources:/' },
        },
      ],
    ]);
    const controlPanel = template.values.find(
      value =>
        value != null &&
        typeof value === 'object' &&
        'strings' in value &&
        (value as TemplateResult).strings.some(strings =>
          strings.includes('foam-control-panel')
        )
    ) as TemplateResult;
    expect(valuesAfter(controlPanel, '.groups=')).toEqual([[userGroup]]);
  });

  it('test_graph_renderer_visibility_pauses_canvas', () => {
    const canvas = new GraphCanvas();
    const fake = {
      pauseAnimation: vi.fn(),
      resumeAnimation: vi.fn(),
      width: vi.fn().mockReturnThis(),
      height: vi.fn().mockReturnThis(),
    };
    (canvas as any).graphInstance = fake;

    canvas.setVisible(false);

    expect(fake.pauseAnimation).toHaveBeenCalledTimes(1);
    expect(fake.resumeAnimation).not.toHaveBeenCalled();
  });

  it('test_graph_renderer_visibility_resume_resizes', () => {
    const canvas = new GraphCanvas();
    const fake = {
      pauseAnimation: vi.fn(),
      resumeAnimation: vi.fn(),
      width: vi.fn().mockReturnThis(),
      height: vi.fn().mockReturnThis(),
    };
    (canvas as any).graphInstance = fake;

    canvas.setVisible(false);
    canvas.setVisible(true);

    expect(fake.resumeAnimation).toHaveBeenCalledTimes(1);
    expect(fake.width.mock.calls.length).toBeGreaterThan(0);
  });

  it('test_graph_renderer_visibility_without_instance_is_safe', () => {
    const canvas = new GraphCanvas();
    expect(() => canvas.setVisible(false)).not.toThrow();
    expect(() => canvas.setVisible(true)).not.toThrow();
  });

  it('test_graph_renderer_focus_no_graph', () => {
    const element = new FoamGraph();
    expect(
      element.focusNode({ requestId: 'r1', nodeId: 'vault:a.md' })
    ).toEqual({
      requestId: 'r1',
      nodeId: 'vault:a.md',
      ok: false,
      reason: 'no-graph',
    });
  });

  it('test_graph_renderer_focus_unknown_node', () => {
    const element = new FoamGraph();
    element.graphData = makeGraph({
      'vault:a.md': makeNode('vault:a.md', 'note', 'A'),
    });
    (element as any).updated(new Map([['graphData', null]]));

    expect(
      element.focusNode({ requestId: 'r2', nodeId: 'vault:zzz.md' })
    ).toEqual({
      requestId: 'r2',
      nodeId: 'vault:zzz.md',
      ok: false,
      reason: 'unknown-node',
    });
  });

  it('test_graph_renderer_focus_hidden_node', () => {
    const element = new FoamGraph();
    element.graphData = makeGraph({
      'vault:img.png': makeNode('vault:img.png', 'image', 'Image'),
    });
    (element as any).updated(new Map([['graphData', null]]));

    expect(
      element.focusNode({ requestId: 'r3', nodeId: 'vault:img.png' })
    ).toEqual({
      requestId: 'r3',
      nodeId: 'vault:img.png',
      ok: false,
      reason: 'hidden-node',
    });
  });

  it('test_graph_renderer_focus_visible_node_selects', () => {
    const element = new FoamGraph();
    element.graphData = makeGraph({
      'vault:a.md': makeNode('vault:a.md', 'note', 'A'),
      'vault:b.md': makeNode('vault:b.md', 'note', 'B'),
    });
    (element as any).updated(new Map([['graphData', null]]));
    element.selectNote('vault:b.md');
    let nodeClickCount = 0;
    element.addEventListener('node-click', () => nodeClickCount++);

    expect(
      element.focusNode({ requestId: 'r4', nodeId: 'vault:a.md' })
    ).toEqual({ requestId: 'r4', nodeId: 'vault:a.md', ok: true });
    expect(element.getSelectedNodeIds()).toEqual(['vault:a.md']);
    expect(nodeClickCount).toBe(0);
  });

  it('test_graph_renderer_message_dispatch_rejects_malformed', () => {
    const element = new FoamGraph();

    expect(
      applyExtensionMessage(element, {
        type: 'didUpdateGraphData',
        payload: 'nope',
      })
    ).toBeNull();
    expect(element.graphData).toBeNull();

    expect(
      applyExtensionMessage(element, {
        type: 'didChangeVisibility',
        payload: { visible: false },
      })
    ).toBeNull();
    expect(element.visible).toBe(false);
  });

  it('test_graph_renderer_message_dispatch_focus_roundtrip', () => {
    const element = new FoamGraph();
    expect(
      applyExtensionMessage(element, {
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
      })
    ).toBeNull();
    expect(element.graphData?.nodeInfo['vault:a.md']).toBeDefined();

    (element as any).updated(new Map([['graphData', null]]));

    expect(
      applyExtensionMessage(element, {
        type: 'didRequestFocus',
        payload: { requestId: 'r-7', nodeId: 'vault:a.md', center: true },
      })
    ).toEqual({
      type: 'webviewDidFocusNode',
      payload: { requestId: 'r-7', nodeId: 'vault:a.md', ok: true },
    });
  });
});
