import { rgb, hsl } from 'd3-color';
import { resolveGroupColor } from './groups';
export function getNodeTypeColor(type, style) {
    return style.node[type] ?? style.node['note'];
}
export function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
    }
    return Math.abs(hash);
}
export function hashToHSL(hash) {
    const hue = hash % 360;
    const saturation = 50 + (hash % 20);
    const lightness = 50 + ((hash >> 8) % 20);
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}
export function getDirectoryColor(nodeId) {
    let currentPath = nodeId;
    const lastSegment = currentPath.split('/').pop();
    if (lastSegment?.includes('.')) {
        currentPath = currentPath.substring(0, currentPath.lastIndexOf('/'));
    }
    if (currentPath.length > 0 && !currentPath.endsWith('/')) {
        currentPath += '/';
    }
    return hashToHSL(hashString(currentPath));
}
export function getTypeColor(type, style) {
    if (style.node[type] !== undefined) {
        return style.node[type];
    }
    return hashToHSL(hashString(type));
}
export function getNodeFillAndBorder(nodeInfo, state, style, colorMode, groups = []) {
    let baseColor;
    if (nodeInfo.properties.color) {
        baseColor = nodeInfo.properties.color;
    }
    else if (colorMode === 'none') {
        baseColor = style.node['note'];
    }
    else if (colorMode === 'directory' && nodeInfo.type !== 'placeholder' && nodeInfo.type !== 'tag') {
        baseColor = getDirectoryColor(nodeInfo.id);
    }
    else {
        baseColor = getTypeColor(nodeInfo.type, style);
    }
    const groupColor = resolveGroupColor(nodeInfo, groups);
    if (groupColor)
        baseColor = groupColor;
    const typeFill = rgb(baseColor);
    switch (state) {
        case 'regular':
            return { fill: typeFill, border: typeFill };
        case 'lessened': {
            const transparent = typeFill.copy({ opacity: 0.05 });
            return { fill: transparent, border: transparent };
        }
        case 'highlighted': {
            const highlight = rgb(style.highlightedForeground);
            return { fill: highlight, border: highlight };
        }
    }
}
export function getNodeLabelColor(fill, state, opacity, style) {
    if (state === 'highlighted')
        return rgb(style.lineColor).copy({ opacity });
    return fill.copy({ opacity });
}
export function getLinkColor(linkState, sourceType, targetType, style) {
    switch (linkState) {
        case 'regular':
            if (sourceType === 'tag' && targetType === 'tag') {
                return hsl(getNodeTypeColor('tag', style)).copy({ opacity: 0.4 }).toString();
            }
            return hsl(style.lineColor).copy({ opacity: 0.4 }).toString();
        case 'highlighted':
            return style.highlightedForeground;
        case 'lessened':
            return hsl(style.lineColor).copy({ opacity: 0.05 }).toString();
    }
}
