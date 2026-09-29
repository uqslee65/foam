import { describe, expect, it } from 'vitest';
import { FoamGraph } from './foam-graph';
import { makeGraph } from './test-utils';
describe('foam-graph', () => {
    it('can show/hide the control panel', () => {
        const element = new FoamGraph();
        element.graphData = makeGraph({
            nodeInfo: {
                '/note': {
                    id: '/note',
                    type: 'note',
                    title: 'Note',
                    properties: {},
                    tags: [],
                },
            },
        });
        element.showControls = true;
        const t1 = element.render();
        const c1 = t1.values.find(v => v != null &&
            typeof v === 'object' &&
            'strings' in v &&
            v.strings.some(s => s.includes('foam-control-panel')));
        expect(c1).not.toBeUndefined();
        element.showControls = false;
        const t2 = element.render();
        const c2 = t2.values.find(v => v != null &&
            typeof v === 'object' &&
            'strings' in v &&
            v.strings.some(s => s.includes('foam-control-panel')));
        expect(c2).toBeUndefined();
    });
    it('derives visible graph data from raw graph data', () => {
        const element = new FoamGraph();
        element.graphData = makeGraph({
            nodeInfo: {
                note: {
                    id: 'note',
                    type: 'note',
                    title: 'Note',
                    properties: {},
                    tags: [{ label: 'topic' }],
                },
            },
        });
        element.updated(new Map([['graphData', null]]));
        const visibleGraph = element.visibleGraph;
        expect(visibleGraph.nodeInfo.note).toBeDefined();
        expect(visibleGraph.nodeInfo.topic.type).toBe('tag');
    });
    it('keeps derived graph data cached for unrelated visual state changes', () => {
        const element = new FoamGraph();
        element.graphData = makeGraph({
            nodeInfo: {
                note: {
                    id: 'note',
                    type: 'note',
                    title: 'Note',
                    properties: {},
                    tags: [],
                },
            },
        });
        element.updated(new Map([['graphData', null]]));
        const visibleGraph = element.visibleGraph;
        const graphStates = element.graphStates;
        element.labels = { fade: 1 };
        element.render();
        expect(element.visibleGraph).toBe(visibleGraph);
        expect(element.graphStates).toBe(graphStates);
    });
    it('recomputes graph states when hover changes', () => {
        const element = new FoamGraph();
        element.graphData = makeGraph({
            nodeInfo: {
                note: {
                    id: 'note',
                    type: 'note',
                    title: 'Note',
                    properties: {},
                    tags: [],
                },
            },
        });
        element.updated(new Map([['graphData', null]]));
        element.hoverNodeId = 'note';
        element.updated(new Map([['hoverNodeId', null]]));
        expect(element.graphStates.nodeStates.get('note')).toBe('highlighted');
    });
    it('accepts graph nodes without tags when deriving autocomplete options', () => {
        const element = new FoamGraph();
        element.graphData = makeGraph({
            nodeInfo: {
                attachment: {
                    id: 'attachment',
                    type: 'attachment',
                    title: 'Attachment',
                    properties: {},
                },
            },
        });
        element.updated(new Map([['graphData', null]]));
        expect(() => element.render()).not.toThrow();
    });
    it('updates app state from child intent events', () => {
        const element = new FoamGraph();
        element._onToggleNodeType({ type: 'tag', visible: false });
        expect(element.showNodesOfType.tag).toBe(false);
        element._onCanvasNodeClick({ nodeId: 'note-a', append: false });
        expect([...element.selectedNodeIds]).toEqual(['note-a']);
        element._onCanvasNodeClick({ nodeId: 'note-b', append: true });
        expect([...element.selectedNodeIds]).toEqual(['note-a', 'note-b']);
        element._onCanvasBackgroundClick({ append: false });
        expect(element.selectedNodeIds.size).toBe(0);
    });
    it('keeps public node-click event detail as the node id string', () => {
        const element = new FoamGraph();
        let detail;
        element.addEventListener('node-click', (event) => {
            detail = event.detail;
        });
        element._onCanvasNodeClick({ nodeId: 'note-a', append: false });
        expect(detail).toBe('note-a');
    });
    it('replaces groups when a new graph style provides groups', () => {
        const element = new FoamGraph();
        element.groups = [
            {
                id: 'local',
                label: 'Local',
                color: '#111111',
                enabled: true,
                match: { property: 'type', value: 'note' },
            },
        ];
        element.graphStyle = {
            groups: [
                {
                    id: 'configured',
                    label: 'Configured',
                    color: '#222222',
                    enabled: true,
                    match: { property: 'tag', value: 'project' },
                },
            ],
        };
        element.updated(new Map([['graphStyle', null]]));
        expect(element.groups.map((group) => group.id)).toEqual([
            'configured',
        ]);
    });
    it('passes labels setting to the canvas', () => {
        const element = new FoamGraph();
        element.showControls = false;
        element.labels = 'always';
        const t = element.render();
        expect(t.strings.join('')).toContain('.labels=');
        expect(t.values).toContain('always');
    });
});
