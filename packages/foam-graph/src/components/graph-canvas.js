var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import ForceGraph from 'force-graph';
import { forceX, forceY, forceCollide, forceManyBody, forceLink, } from 'd3-force';
import { scaleLinear } from 'd3-scale';
import { Painter } from '../lib/painter';
import { getNodeFillAndBorder, getLinkColor, getNodeLabelColor, } from '../lib/colors';
import { GraphModelLink } from '../lib/types';
export function measureGraphViewport(element, fallback) {
    const rect = element.getBoundingClientRect();
    const parent = element.parentElement;
    const parentRect = parent?.getBoundingClientRect();
    return {
        width: rect.width ||
            element.clientWidth ||
            parentRect?.width ||
            parent?.clientWidth ||
            fallback.width,
        height: rect.height ||
            element.clientHeight ||
            parentRect?.height ||
            parent?.clientHeight ||
            fallback.height,
    };
}
export function graphPointToViewport(transform, x, y, devicePixelRatio) {
    const ratio = devicePixelRatio || 1;
    return {
        x: (transform.a * x + transform.c * y + transform.e) / ratio,
        y: (transform.b * x + transform.d * y + transform.f) / ratio,
    };
}
export function computeLabelFontSize(baseFontSize, multiplier) {
    return baseFontSize * multiplier;
}
export function computeLabelOpacity(state, globalScale, fillOpacity, getOpacity, labels) {
    if (labels === 'always' || state === 'highlighted')
        return 1;
    const opacity = getOpacity(globalScale);
    return state === 'regular' ? opacity : Math.min(opacity, fillOpacity);
}
export function computeFitZoom(bounds, viewport, padding, maxZoom) {
    const availableWidth = Math.max(viewport.width - padding * 2, 1);
    const availableHeight = Math.max(viewport.height - padding * 2, 1);
    const graphWidth = Math.max(bounds.x[1] - bounds.x[0], 1e-12);
    const graphHeight = Math.max(bounds.y[1] - bounds.y[0], 1e-12);
    const fitZoom = Math.max(1e-12, Math.min(1e12, availableWidth / graphWidth, availableHeight / graphHeight));
    return maxZoom == null ? fitZoom : Math.min(fitZoom, maxZoom);
}
let GraphCanvas = class GraphCanvas extends LitElement {
    constructor() {
        super(...arguments);
        /**
         * Pre-filtered graph data ready for rendering. `nodeInfo` should contain only
         * visible nodes.
         */
        this.visibleGraph = null;
        this.graphStates = null;
        this.style = {};
        this.forces = {
            collide: 2,
            repel: 30,
            link: 30,
            velocityDecay: 0.4,
        };
        this.labels = { fade: 0 };
        this.nodeFontSizeMultiplier = 1;
        this.nodeSizeMultiplier = 1;
        this.linkWidthMultiplier = 2;
        this.animateLinks = 'forward';
        this.groups = [];
        this.maxFitZoom = null;
        // Mutable rendering state closed over by force-graph callbacks.
        this.rs = {
            nodeInfo: {},
            data: { nodes: [], links: [] },
            graphStates: null,
            style: {},
            forces: {},
            nodeFontSizeMultiplier: 1,
            nodeSizeMultiplier: 1,
            linkWidthMultiplier: 2,
            animateLinks: 'forward',
            colorMode: 'type',
            groups: [],
        };
        this.getNodeSize = scaleLinear()
            .domain([0, 30])
            .range([0.6, 3])
            .clamp(true);
        this.getNodeLabelOpacity = scaleLinear()
            .domain([1.2, 2.0])
            .range([0, 1])
            .clamp(true);
        this.graphInstance = null;
        this.firstGraphLoad = true;
        this.visibleState = true;
        this.resizeObserver = null;
        this.onResize = () => {
            if (!this.visibleState)
                return;
            this.resizeGraphToViewport();
        };
    }
    static { this.styles = css `
    :host {
      display: block;
      position: absolute;
      inset: 0;
    }

    #canvas-container {
      width: 100%;
      height: 100%;
    }
  `; }
    render() {
        return html `<div id="canvas-container"></div>`;
    }
    firstUpdated() {
        const container = this.shadowRoot.getElementById('canvas-container');
        container.addEventListener('mouseleave', () => {
            this._emit('canvas-node-hover', null);
        });
        const painter = new Painter();
        this.graphInstance = ForceGraph()(container)
            .graphData(this.rs.data)
            .backgroundColor(this.rs.style.background || '#202020')
            .linkHoverPrecision(8)
            .d3Force('x', forceX())
            .d3Force('y', forceY())
            .d3Force('collide', forceCollide(4 /* default nodeRelSize */ * this.rs.forces.collide || 8))
            .d3Force('charge', forceManyBody().strength(-(this.rs.forces.repel || 30)))
            .d3Force('link', forceLink(this.rs.data.links).distance(this.rs.forces.link || 30))
            .d3VelocityDecay(1 - (this.rs.forces.velocityDecay ?? 0.4))
            .linkWidth(() => this.rs.style.lineWidth * this.rs.linkWidthMultiplier)
            .linkDirectionalParticles(1)
            .linkDirectionalParticleSpeed(this.rs.animateLinks === 'reverse' ? -0.004 : 0.004)
            .linkDirectionalParticleWidth(link => {
            if (this.rs.animateLinks === 'off')
                return 0;
            const graphLink = link;
            const key = GraphModelLink.getKey(graphLink);
            const state = this.rs.graphStates?.linkStates.get(key) ?? 'regular';
            return state === 'highlighted' ? this.rs.style.particleWidth : 0;
        })
            .nodeCanvasObject((node, ctx, globalScale) => {
            const info = this.rs.nodeInfo[node.id];
            if (!info)
                return;
            const size = this.getNodeSize(info.neighbors.length) *
                this.rs.nodeSizeMultiplier;
            const state = this.rs.graphStates?.nodeStates.get(node.id) ?? 'regular';
            const { fill, border } = getNodeFillAndBorder(info, state, this.rs.style, this.rs.colorMode, this.rs.groups);
            const fontSize = computeLabelFontSize(this.rs.style.fontSize, this.rs.nodeFontSizeMultiplier);
            const opacity = computeLabelOpacity(state, globalScale, fill.opacity, scale => this.getNodeLabelOpacity(scale), this.labels);
            const textColor = getNodeLabelColor(fill, state, opacity, this.rs.style);
            const labelPosition = graphPointToViewport(ctx.getTransform(), node.x, node.y + size + 1, window.devicePixelRatio || 1);
            painter
                .circle(node.x, node.y, size, fill, border)
                .screenText(info.title, labelPosition.x, labelPosition.y, fontSize, this.rs.style.fontFamily, textColor);
        })
            .onRenderFramePost((ctx) => {
            painter.paint(ctx);
        })
            .linkColor((link) => {
            const graphLink = link;
            const key = GraphModelLink.getKey(graphLink);
            const state = this.rs.graphStates?.linkStates.get(key) ?? 'regular';
            const srcInfo = this.rs.nodeInfo[GraphModelLink.getNodeId(graphLink.source)];
            const tgtInfo = this.rs.nodeInfo[GraphModelLink.getNodeId(graphLink.target)];
            return getLinkColor(state, srcInfo?.type ?? 'note', tgtInfo?.type ?? 'note', this.rs.style);
        })
            .nodePointerAreaPaint((node, color, ctx) => {
            const info = this.rs.nodeInfo[node.id];
            if (!info)
                return;
            const size = this.getNodeSize(info.neighbors.length) *
                this.rs.nodeSizeMultiplier;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);
            ctx.fill();
        })
            .onNodeHover((node) => {
            const nodeId = node?.id ?? null;
            this._emit('canvas-node-hover', nodeId);
            container.style.cursor = node ? 'pointer' : 'default';
        })
            .onNodeClick((node, event) => {
            this._emit('canvas-node-click', {
                nodeId: node.id,
                append: event.getModifierState('Shift'),
            });
        })
            .onBackgroundClick((event) => {
            this._emit('canvas-background-click', {
                append: event.getModifierState('Shift'),
            });
        });
        this.resizeGraphToViewport();
        if ('ResizeObserver' in window) {
            this.resizeObserver = new ResizeObserver(() => {
                if (!this.visibleState)
                    return;
                this.resizeGraphToViewport();
            });
            this.resizeObserver.observe(this);
        }
        window.addEventListener('resize', this.onResize);
    }
    disconnectedCallback() {
        super.disconnectedCallback();
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        window.removeEventListener('resize', this.onResize);
        this.graphInstance?._destructor?.();
    }
    updated(changed) {
        if (changed.has('style')) {
            this.rs.style = this.style;
            this.rs.colorMode = this.style.colorMode;
            this.graphInstance?.backgroundColor(this.style.background);
        }
        if (changed.has('graphStates')) {
            this.rs.graphStates = this.graphStates;
        }
        if (changed.has('forces')) {
            this.rs.forces = this.forces;
            if (this.graphInstance) {
                this.graphInstance.d3Force('collide')?.radius(this.graphInstance.nodeRelSize() * this.forces.collide);
                this.graphInstance.d3Force('charge')?.strength(-this.forces.repel);
                this.graphInstance.d3Force('link')?.distance(this.forces.link);
                this.graphInstance.d3VelocityDecay(1 - this.forces.velocityDecay);
                this.graphInstance.d3ReheatSimulation();
            }
        }
        if (changed.has('groups')) {
            this.rs.groups = this.groups;
        }
        if (changed.has('labels')) {
            if (typeof this.labels === 'object') {
                const invertedValue = 3 - this.labels.fade;
                this.getNodeLabelOpacity.domain([invertedValue, invertedValue + 0.8]);
            }
        }
        if (changed.has('nodeFontSizeMultiplier')) {
            this.rs.nodeFontSizeMultiplier = this.nodeFontSizeMultiplier;
        }
        if (changed.has('nodeSizeMultiplier')) {
            this.rs.nodeSizeMultiplier = this.nodeSizeMultiplier;
        }
        if (changed.has('linkWidthMultiplier')) {
            this.rs.linkWidthMultiplier = this.linkWidthMultiplier;
            this.graphInstance?.linkWidth(() => this.rs.style.lineWidth * this.rs.linkWidthMultiplier);
        }
        if (changed.has('animateLinks')) {
            this.rs.animateLinks = this.animateLinks;
            this.graphInstance?.linkDirectionalParticleSpeed(this.animateLinks === 'reverse' ? -0.004 : 0.004);
        }
        if (changed.has('visibleGraph')) {
            const nextGraph = this.visibleGraph ?? {
                nodeInfo: {},
                nodes: [],
                links: [],
            };
            this.rs.nodeInfo = nextGraph.nodeInfo;
            this._updateGraphData(nextGraph);
            if (this.visibleGraph && this.firstGraphLoad && this.graphInstance) {
                this.firstGraphLoad = false;
                this.graphInstance.zoom(this.graphInstance.zoom() * 1.5);
                this.graphInstance.cooldownTicks(100);
                this.graphInstance.onEngineStop(() => {
                    this.graphInstance.onEngineStop(() => { });
                    this.zoomToFit(500);
                });
            }
        }
    }
    setVisible(visible) {
        this.visibleState = visible;
        if (!this.graphInstance)
            return;
        if (!visible) {
            this.graphInstance.pauseAnimation();
            return;
        }
        this.graphInstance.resumeAnimation();
        this.resizeGraphToViewport();
    }
    /** Centers the viewport on a currently visible node. */
    centerOnNode(nodeId, zoom, duration = 300) {
        if (!this.graphInstance)
            return;
        const nodes = this.graphInstance.graphData().nodes;
        const node = nodes.find(n => n.id === nodeId);
        if (!node)
            return;
        this.graphInstance.centerAt(node.x, node.y, duration);
        if (zoom !== undefined) {
            this.graphInstance.zoom(zoom, duration);
        }
    }
    /** Fits the current graph into the available canvas area. */
    zoomToFit(duration = 500) {
        if (!this.graphInstance)
            return;
        if (this.maxFitZoom == null) {
            this.graphInstance.zoomToFit(duration);
            return;
        }
        const graphInstance = this.graphInstance;
        const bounds = graphInstance.getGraphBbox?.();
        if (!bounds)
            return;
        const center = {
            x: (bounds.x[0] + bounds.x[1]) / 2,
            y: (bounds.y[0] + bounds.y[1]) / 2,
        };
        const viewport = measureGraphViewport(this, {
            width: window.innerWidth,
            height: window.innerHeight,
        });
        const zoom = computeFitZoom(bounds, viewport, 10, this.maxFitZoom);
        this.graphInstance.centerAt(center.x, center.y, duration);
        this.graphInstance.zoom(zoom, duration);
    }
    /** Sets the current zoom level without changing the graph data. */
    zoom(zoom, duration = 300) {
        this.graphInstance?.zoom(zoom, duration);
    }
    resizeGraphToViewport() {
        if (!this.graphInstance)
            return;
        const { width, height } = measureGraphViewport(this, {
            width: window.innerWidth,
            height: window.innerHeight,
        });
        if (width <= 0 || height <= 0)
            return;
        this.graphInstance.width(width).height(height);
    }
    _updateGraphData(visibleGraph) {
        if (!this.graphInstance)
            return;
        const nodeIdsToAdd = new Set(visibleGraph.nodes.map(node => node.id));
        const nodeIdsToRemove = new Set();
        for (const node of this.rs.data.nodes) {
            if (nodeIdsToAdd.has(node.id)) {
                nodeIdsToAdd.delete(node.id);
            }
            else {
                nodeIdsToRemove.add(node.id);
            }
        }
        for (const id of nodeIdsToRemove) {
            const idx = this.rs.data.nodes.findIndex(node => node.id === id);
            if (idx !== -1)
                this.rs.data.nodes.splice(idx, 1);
        }
        for (const id of nodeIdsToAdd) {
            this.rs.data.nodes.push({ id });
        }
        this.rs.data.links = visibleGraph.links.map(link => ({ ...link }));
        this.graphInstance.graphData(this.rs.data);
        this.graphInstance.d3Force('link')?.links(this.rs.data.links);
    }
    _emit(eventName, detail) {
        this.dispatchEvent(new CustomEvent(eventName, { detail, bubbles: true, composed: true }));
    }
};
__decorate([
    property({ type: Object })
], GraphCanvas.prototype, "visibleGraph", void 0);
__decorate([
    property({ type: Object })
], GraphCanvas.prototype, "graphStates", void 0);
__decorate([
    property({ type: Object })
], GraphCanvas.prototype, "style", void 0);
__decorate([
    property({ type: Object })
], GraphCanvas.prototype, "forces", void 0);
__decorate([
    property({ type: Object })
], GraphCanvas.prototype, "labels", void 0);
__decorate([
    property({ type: Number })
], GraphCanvas.prototype, "nodeFontSizeMultiplier", void 0);
__decorate([
    property({ type: Number })
], GraphCanvas.prototype, "nodeSizeMultiplier", void 0);
__decorate([
    property({ type: Number })
], GraphCanvas.prototype, "linkWidthMultiplier", void 0);
__decorate([
    property({ type: String })
], GraphCanvas.prototype, "animateLinks", void 0);
__decorate([
    property({ type: Array })
], GraphCanvas.prototype, "groups", void 0);
__decorate([
    property({ type: Number })
], GraphCanvas.prototype, "maxFitZoom", void 0);
GraphCanvas = __decorate([
    customElement('foam-graph-canvas')
], GraphCanvas);
export { GraphCanvas };
