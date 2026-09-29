var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { LitElement, html, css } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { getDefaultStyle } from './lib/defaults';
import { createGraphModel, computeGraphStates } from './lib/graph-utils';
import { computeAutocompleteOptions, computeGroupMatchCounts, computeNodeTypeCounts, computePreviewMatchCount, computeVisibleGraph, deriveNodeTypeFilters, } from './lib/graph-view-model';
import { mergeStyles, resolveStyle } from './lib/style';
import { hashString, hashToHSL } from './lib/colors';
import { parseExtensionMessage, } from './protocol';
import './components/graph-canvas';
import './components/control-panel';
export const COMPACT_MAX_WIDTH = 480;
export function computeLayoutMode(width) {
    if (!Number.isFinite(width) || width <= 0)
        return null;
    return width < COMPACT_MAX_WIDTH ? 'compact' : 'wide';
}
export function deriveRootGroupRules(rootGroups) {
    return (rootGroups ?? []).map(({ root, label, color }) => ({
        id: `root:${root}`,
        label,
        color,
        enabled: true,
        match: { property: 'path', value: `/^${root}:/` },
    }));
}
let FoamGraph = class FoamGraph extends LitElement {
    constructor() {
        super(...arguments);
        // Public API
        this.graphData = null;
        this.graphStyle = null;
        this.showControls = false;
        this.focusNodeId = null;
        this.graphScope = 'full';
        this.maxFitZoom = null;
        this.labels = { fade: 0 };
        this.forces = {
            collide: 1,
            repel: 10,
            link: 30,
            velocityDecay: 0.4,
        };
        this.linkWidthMultiplier = 2;
        this.selection = {
            neighborDepth: 1,
            centerOnSelect: true,
            zoomOnSelect: true,
        };
        this.layoutMode = 'wide';
        this.visible = true;
        this.layoutResizeObserver = null;
        // Internal app state
        this.graphModel = null;
        this.selectedNodeIds = new Set();
        this.hoverNodeId = null;
        this.showNodesOfType = {
            placeholder: true,
            image: false,
            attachment: false,
            note: true,
            tag: true,
        };
        this.nodeFontSizeMultiplier = 1;
        this.nodeSizeMultiplier = 2;
        this.animateLinks = 'forward';
        this.localStylePatch = {};
        this.groups = [];
        this.rootGroupRules = [];
        this.groupDraft = {
            active: false,
            property: 'type',
            value: '',
        };
        // Pipeline: GraphData -> GraphModel -> VisibleGraph plus GraphStates for rendering.
        this.visibleGraph = null;
        this.graphStates = null;
    }
    static { this.styles = css `
    :host {
      display: block;
      position: relative;
      width: 100%;
      height: 100%;
    }
  `; }
    get resolvedStyle() {
        const merged = mergeStyles(this.graphStyle, this.localStylePatch);
        return resolveStyle(merged, getDefaultStyle());
    }
    get visibleFocusNodeId() {
        if (this.focusNodeId)
            return this.focusNodeId;
        if (this.graphScope === 'full')
            return null;
        return [...this.selectedNodeIds][0] ?? null;
    }
    connectedCallback() {
        super.connectedCallback();
        if ('ResizeObserver' in window) {
            this.layoutResizeObserver?.disconnect();
            this.layoutResizeObserver = new ResizeObserver(entries => {
                const mode = computeLayoutMode(entries[0]?.contentRect.width);
                if (mode !== null)
                    this.layoutMode = mode;
            });
            this.layoutResizeObserver.observe(this);
        }
    }
    disconnectedCallback() {
        super.disconnectedCallback();
        this.layoutResizeObserver?.disconnect();
        this.layoutResizeObserver = null;
    }
    updated(changed) {
        let shouldRecomputeVisibleGraph = false;
        let shouldRecomputeGraphStates = false;
        if (changed.has('graphData')) {
            this.graphModel = this.graphData
                ? createGraphModel(this.graphData)
                : null;
            this.rootGroupRules = deriveRootGroupRules(this.graphData?.rootGroups);
            this._pruneInteractionState();
            shouldRecomputeVisibleGraph = true;
            shouldRecomputeGraphStates = true;
        }
        if (changed.has('graphStyle') && this.graphStyle?.groups) {
            this.groups = this.graphStyle.groups;
            shouldRecomputeVisibleGraph = true;
        }
        if (changed.has('graphStyle') && this.graphStyle?.showNodesOfType) {
            this.showNodesOfType = {
                ...this.showNodesOfType,
                ...this.graphStyle.showNodesOfType,
            };
            shouldRecomputeVisibleGraph = true;
        }
        if ((changed.has('graphData') || changed.has('graphStyle')) &&
            this.graphModel) {
            this.showNodesOfType = deriveNodeTypeFilters(this.graphModel, this.resolvedStyle, this.showNodesOfType);
            shouldRecomputeVisibleGraph = true;
        }
        if (changed.has('focusNodeId') || changed.has('graphScope')) {
            shouldRecomputeVisibleGraph = true;
        }
        if (changed.has('visible')) {
            this.canvas?.setVisible(this.visible);
        }
        if (changed.has('selection') || changed.has('hoverNodeId')) {
            shouldRecomputeGraphStates = true;
        }
        if (shouldRecomputeVisibleGraph) {
            this._recomputeVisibleGraph();
        }
        if (shouldRecomputeGraphStates) {
            this._recomputeGraphStates();
        }
    }
    render() {
        const resolved = this.resolvedStyle;
        const groupMatchCounts = this.graphModel
            ? computeGroupMatchCounts(this.graphModel, this.groups)
            : {};
        const autocompleteOptions = this.graphModel
            ? computeAutocompleteOptions(this.graphModel, this.groupDraft.property)
            : [];
        const previewMatchCount = this.graphModel
            ? computePreviewMatchCount(this.graphModel, this.groupDraft.property, this.groupDraft.value)
            : 0;
        return html `
      <foam-graph-canvas
        .visibleGraph=${this.visibleGraph}
        .graphStates=${this.graphStates}
        .style=${resolved}
        .groups=${[...this.groups, ...this.rootGroupRules]}
        .forces=${this.forces}
        .labels=${this.labels}
        .nodeFontSizeMultiplier=${this.nodeFontSizeMultiplier}
        .nodeSizeMultiplier=${this.nodeSizeMultiplier}
        .linkWidthMultiplier=${this.linkWidthMultiplier}
        .animateLinks=${this.animateLinks}
        .maxFitZoom=${this.maxFitZoom}
        @canvas-node-click=${(e) => this._onCanvasNodeClick(e.detail)}
        @canvas-node-hover=${(e) => (this.hoverNodeId = e.detail)}
        @canvas-background-click=${(e) => this._onCanvasBackgroundClick(e.detail)}
      ></foam-graph-canvas>
      ${this.showControls && this.layoutMode !== 'compact'
            ? html `<foam-control-panel
            .style=${resolved}
            .showNodesOfType=${this.showNodesOfType}
            .nodeTypeCounts=${computeNodeTypeCounts(this.graphModel)}
            .groupMatchCounts=${groupMatchCounts}
            .autocompleteOptions=${autocompleteOptions}
            .previewMatchCount=${previewMatchCount}
            .groupDraft=${this.groupDraft}
            .groups=${this.groups}
            .textFade=${typeof this.labels === 'object' ? this.labels.fade : 0}
            .nodeFontSizeMultiplier=${this.nodeFontSizeMultiplier}
            .nodeSizeMultiplier=${this.nodeSizeMultiplier}
            .linkWidthMultiplier=${this.linkWidthMultiplier}
            .animateLinks=${this.animateLinks}
            .forces=${this.forces}
            .selection=${this.selection}
            .graphScope=${this.graphScope}
            @graph-scope-change=${(e) => (this.graphScope = e.detail)}
            @style-change=${(e) => this._onStyleChange(e.detail)}
            @toggle-node-type=${(e) => this._onToggleNodeType(e.detail)}
            @update-group=${(e) => this._onUpdateGroup(e.detail)}
            @delete-group=${(e) => this._onDeleteGroup(e.detail)}
            @start-draft=${() => (this.groupDraft = {
                active: true,
                property: this.groupDraft.property,
                value: '',
            })}
            @cancel-draft=${() => (this.groupDraft = { ...this.groupDraft, active: false })}
            @draft-change=${(e) => (this.groupDraft = e.detail)}
            @add-group=${() => this._onAddGroup()}
            @text-fade-change=${(e) => (this.labels = { fade: e.detail })}
            @font-size-multiplier-change=${(e) => (this.nodeFontSizeMultiplier = e.detail)}
            @node-size-multiplier-change=${(e) => (this.nodeSizeMultiplier = e.detail)}
            @link-width-multiplier-change=${(e) => (this.linkWidthMultiplier = e.detail)}
            @animate-links-change=${(e) => (this.animateLinks = e.detail)}
            @forces-change=${(e) => (this.forces = e.detail)}
            @selection-change=${(e) => (this.selection = e.detail)}
          ></foam-control-panel>`
            : null}
    `;
    }
    selectNote(noteId) {
        this._selectNode(noteId, false);
        if (!this.visibleGraph?.nodeInfo[noteId])
            return;
        if (this.selection.centerOnSelect) {
            this.canvas?.centerOnNode(noteId, this.selection.zoomOnSelect ? 3 : undefined, 300);
        }
        else if (this.selection.zoomOnSelect) {
            this.canvas?.zoom(3, 300);
        }
    }
    focusNode(request) {
        if (!this.graphData || !this.graphModel) {
            return {
                requestId: request.requestId,
                nodeId: request.nodeId,
                ok: false,
                reason: 'no-graph',
            };
        }
        if (!Object.prototype.hasOwnProperty.call(this.graphData.nodeInfo, request.nodeId)) {
            return {
                requestId: request.requestId,
                nodeId: request.nodeId,
                ok: false,
                reason: 'unknown-node',
            };
        }
        if (!this.visibleGraph?.nodeInfo[request.nodeId]) {
            return {
                requestId: request.requestId,
                nodeId: request.nodeId,
                ok: false,
                reason: 'hidden-node',
            };
        }
        this._selectNode(request.nodeId, false);
        if (request.center !== false) {
            this.canvas?.centerOnNode(request.nodeId, this.selection.zoomOnSelect ? 3 : undefined, 300);
        }
        return { requestId: request.requestId, nodeId: request.nodeId, ok: true };
    }
    getSelectedNodeIds() {
        return [...this.selectedNodeIds];
    }
    _onCanvasNodeClick(detail) {
        this._selectNode(detail.nodeId, detail.append);
        this.dispatchEvent(new CustomEvent('node-click', {
            detail: detail.nodeId,
            bubbles: true,
            composed: true,
        }));
    }
    _onCanvasBackgroundClick(detail) {
        if (!detail.append) {
            this.selectedNodeIds = new Set();
            this._recomputeGraphStates();
            this._recomputeVisibleGraphIfSelectionAffectsScope();
        }
    }
    _selectNode(nodeId, append) {
        const next = append ? new Set(this.selectedNodeIds) : new Set();
        next.add(nodeId);
        this.selectedNodeIds = next;
        this._recomputeGraphStates();
        this._recomputeVisibleGraphIfSelectionAffectsScope();
    }
    _onToggleNodeType(detail) {
        this.showNodesOfType = {
            ...this.showNodesOfType,
            [detail.type]: detail.visible,
        };
        this._recomputeVisibleGraph();
    }
    _onUpdateGroup(detail) {
        this.groups = this.groups.map((group, index) => index === detail.index ? { ...group, ...detail.patch } : group);
        this._recomputeVisibleGraph();
    }
    _onDeleteGroup(index) {
        this.groups = this.groups.filter((_, i) => i !== index);
        this._recomputeVisibleGraph();
    }
    _onAddGroup() {
        if (!this.groupDraft.value)
            return;
        const label = `${this.groupDraft.property}=${this.groupDraft.value}`;
        this.groups = [
            ...this.groups,
            {
                id: `group-${Date.now()}`,
                label,
                color: hashToHSL(hashString(label)),
                enabled: true,
                match: {
                    property: this.groupDraft.property,
                    value: this.groupDraft.value,
                },
            },
        ];
        this.groupDraft = { ...this.groupDraft, active: false, value: '' };
        this._recomputeVisibleGraph();
    }
    _onStyleChange(patch) {
        const { colorMode, ...styleProps } = patch;
        this.localStylePatch = {
            ...this.localStylePatch,
            ...(colorMode !== undefined ? { colorMode } : {}),
            style: { ...this.localStylePatch?.style, ...styleProps },
        };
    }
    _pruneInteractionState() {
        if (!this.graphModel) {
            this.selectedNodeIds = new Set();
            this.hoverNodeId = null;
            return;
        }
        this.selectedNodeIds = new Set([...this.selectedNodeIds].filter(id => this.graphModel.nodeInfo[id] != null));
        if (this.hoverNodeId && !this.graphModel.nodeInfo[this.hoverNodeId]) {
            this.hoverNodeId = null;
        }
    }
    _recomputeVisibleGraph() {
        this.visibleGraph = this.graphModel
            ? computeVisibleGraph(this.graphModel, this.showNodesOfType, this.groups, this.visibleFocusNodeId, this.graphScope)
            : null;
    }
    _recomputeGraphStates() {
        this.graphStates = this.graphModel
            ? computeGraphStates(this.graphModel, this.selectedNodeIds, this.hoverNodeId, this.selection.neighborDepth)
            : null;
    }
    _recomputeVisibleGraphIfSelectionAffectsScope() {
        if (!this.focusNodeId && this.graphScope !== 'full') {
            this._recomputeVisibleGraph();
        }
    }
};
__decorate([
    property({ type: Object })
], FoamGraph.prototype, "graphData", void 0);
__decorate([
    property({ type: Object })
], FoamGraph.prototype, "graphStyle", void 0);
__decorate([
    property({ type: Boolean })
], FoamGraph.prototype, "showControls", void 0);
__decorate([
    property({ type: String })
], FoamGraph.prototype, "focusNodeId", void 0);
__decorate([
    property({ type: Object })
], FoamGraph.prototype, "graphScope", void 0);
__decorate([
    property({ type: Number })
], FoamGraph.prototype, "maxFitZoom", void 0);
__decorate([
    property({ type: Object })
], FoamGraph.prototype, "labels", void 0);
__decorate([
    property({ type: Object })
], FoamGraph.prototype, "forces", void 0);
__decorate([
    property({ type: Number })
], FoamGraph.prototype, "linkWidthMultiplier", void 0);
__decorate([
    property({ type: Object })
], FoamGraph.prototype, "selection", void 0);
__decorate([
    property({ type: String, reflect: true })
], FoamGraph.prototype, "layoutMode", void 0);
__decorate([
    property({ type: Boolean })
], FoamGraph.prototype, "visible", void 0);
__decorate([
    query('foam-graph-canvas')
], FoamGraph.prototype, "canvas", void 0);
__decorate([
    state()
], FoamGraph.prototype, "graphModel", void 0);
__decorate([
    state()
], FoamGraph.prototype, "selectedNodeIds", void 0);
__decorate([
    state()
], FoamGraph.prototype, "hoverNodeId", void 0);
__decorate([
    state()
], FoamGraph.prototype, "showNodesOfType", void 0);
__decorate([
    state()
], FoamGraph.prototype, "nodeFontSizeMultiplier", void 0);
__decorate([
    state()
], FoamGraph.prototype, "nodeSizeMultiplier", void 0);
__decorate([
    state()
], FoamGraph.prototype, "animateLinks", void 0);
__decorate([
    state()
], FoamGraph.prototype, "localStylePatch", void 0);
__decorate([
    state()
], FoamGraph.prototype, "groups", void 0);
__decorate([
    state()
], FoamGraph.prototype, "rootGroupRules", void 0);
__decorate([
    state()
], FoamGraph.prototype, "groupDraft", void 0);
__decorate([
    state()
], FoamGraph.prototype, "visibleGraph", void 0);
__decorate([
    state()
], FoamGraph.prototype, "graphStates", void 0);
FoamGraph = __decorate([
    customElement('foam-graph')
], FoamGraph);
export { FoamGraph };
export function applyExtensionMessage(element, raw) {
    const parsed = parseExtensionMessage(raw);
    if (!parsed.ok)
        return null;
    switch (parsed.value.type) {
        case 'didUpdateGraphData':
            element.graphData = parsed.value.payload;
            return null;
        case 'didUpdateStyle':
            element.graphStyle = parsed.value.payload;
            return null;
        case 'didSelectNote':
            element.selectNote(parsed.value.payload);
            return null;
        case 'didChangeVisibility':
            element.visible = parsed.value.payload.visible;
            return null;
        case 'didRequestFocus':
            return {
                type: 'webviewDidFocusNode',
                payload: element.focusNode(parsed.value.payload),
            };
    }
}
