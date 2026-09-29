import { GraphModelLink, } from './types';
export function createGraphModel(graph) {
    const model = { nodeInfo: {}, links: [] };
    // Copy nodes with initialized neighbors/links
    for (const node of Object.values(graph.nodeInfo)) {
        model.nodeInfo[node.id] = { ...node, neighbors: [], links: [] };
    }
    // Copy links
    model.links = graph.links.map(l => ({ ...l }));
    // Process tags: create tag nodes and hierarchy links
    for (const node of Object.values(model.nodeInfo)) {
        if (!node.tags?.length)
            continue;
        for (const tag of node.tags) {
            const subtags = tag.label.split('/');
            for (let i = 0; i < subtags.length; i++) {
                const label = subtags.slice(0, i + 1).join('/');
                if (!model.nodeInfo[label]) {
                    model.nodeInfo[label] = {
                        id: label,
                        title: '#' + label,
                        type: 'tag',
                        properties: {},
                        tags: [],
                        neighbors: [],
                        links: [],
                    };
                }
                if (i > 0) {
                    const parent = subtags.slice(0, i).join('/');
                    model.links.push({ source: parent, target: label });
                }
            }
            model.links.push({ source: tag.label, target: node.id });
        }
    }
    // Deduplicate links
    const seen = new Set();
    model.links = model.links.filter(link => {
        const key = GraphModelLink.getKey(link);
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
    // Build neighbor relationships
    for (const link of model.links) {
        const a = model.nodeInfo[GraphModelLink.getNodeId(link.source)];
        const b = model.nodeInfo[GraphModelLink.getNodeId(link.target)];
        if (a && b) {
            a.neighbors.push(b.id);
            b.neighbors.push(a.id);
            a.links.push(link);
            b.links.push(link);
        }
    }
    return model;
}
export function getNeighbors(nodeId, depth, nodeInfo) {
    let neighbors = new Set([nodeId]);
    for (let i = 0; i < depth; i++) {
        const newNeighbors = new Set();
        for (const id of neighbors) {
            const node = nodeInfo[id];
            if (node) {
                for (const n of node.neighbors)
                    newNeighbors.add(n);
            }
            else {
                console.debug(`getNeighbors: node '${id}' not found in nodeInfo, skipping.`);
            }
        }
        for (const n of newNeighbors)
            neighbors.add(n);
    }
    return neighbors;
}
export function computeFocusSets(selectedNodes, hoverNode, neighborDepth, nodeInfo, links) {
    const focusNodes = new Set();
    const focusLinks = new Set();
    const originNodes = [...selectedNodes, hoverNode].filter(Boolean);
    for (const nodeId of originNodes) {
        const neighbors = getNeighbors(nodeId, neighborDepth, nodeInfo);
        for (const n of neighbors)
            focusNodes.add(n);
    }
    const originSet = new Set(originNodes);
    for (const link of links) {
        const src = GraphModelLink.getNodeId(link.source);
        const tgt = GraphModelLink.getNodeId(link.target);
        if (originSet.has(src) || originSet.has(tgt)) {
            focusLinks.add(link);
        }
    }
    return { focusNodes, focusLinks };
}
export function getNodeState(nodeId, selectedNodes, hoverNode, focusNodes) {
    if (selectedNodes.has(nodeId) || hoverNode === nodeId)
        return 'highlighted';
    if (focusNodes.size === 0 || focusNodes.has(nodeId))
        return 'regular';
    return 'lessened';
}
export function getLinkState(link, focusNodes, focusLinks) {
    if (focusNodes.size === 0)
        return 'regular';
    const src = GraphModelLink.getNodeId(link.source);
    const tgt = GraphModelLink.getNodeId(link.target);
    for (const fl of focusLinks) {
        if (GraphModelLink.getNodeId(fl.source) === src &&
            GraphModelLink.getNodeId(fl.target) === tgt) {
            return 'highlighted';
        }
    }
    return 'lessened';
}
export function getFocusSubset(graphModel, focusNodeId, focusDepth) {
    return getNeighbors(focusNodeId, focusDepth, graphModel.nodeInfo);
}
export function computeGraphStates(graphModel, selectedNodes, hoverNode, neighborDepth) {
    const { focusNodes, focusLinks } = computeFocusSets(selectedNodes, hoverNode, neighborDepth, graphModel.nodeInfo, graphModel.links);
    const nodeStates = new Map();
    for (const id of Object.keys(graphModel.nodeInfo)) {
        nodeStates.set(id, getNodeState(id, selectedNodes, hoverNode, focusNodes));
    }
    const highlightedLinks = new Set([...focusLinks].map(link => GraphModelLink.getKey(link)));
    const linkStates = new Map();
    for (const link of graphModel.links) {
        const key = GraphModelLink.getKey(link);
        if (focusNodes.size === 0) {
            linkStates.set(key, 'regular');
        }
        else {
            linkStates.set(key, highlightedLinks.has(key) ? 'highlighted' : 'lessened');
        }
    }
    return { nodeStates, linkStates };
}
