/**
 * Shared message types between the extension host and the graph webview.
 * This file must remain free of VS Code and Node.js imports.
 */
export const PA_HUB_PROTOCOL_VERSION = 1;
export const ROOT_KINDS = ['vault', 'sources'];
export const EXTENSION_MESSAGE_TYPES = [
    'didUpdateStyle',
    'didUpdateGraphData',
    'didSelectNote',
    'didRequestFocus',
    'didChangeVisibility',
];
export const WEBVIEW_MESSAGE_TYPES = [
    'webviewDidLoad',
    'webviewDidSelectNode',
    'error',
    'webviewDidBecomeReady',
    'webviewDidFocusNode',
];
export const MAX_MESSAGE_CHARS = 2_000_000;
function isRootKind(value) {
    return value === 'vault' || value === 'sources';
}
function isValidNodePath(path) {
    if (path.length === 0 || path.length > 1024 || path.startsWith('/')) {
        return false;
    }
    if (path.includes('\\') || path.includes('://')) {
        return false;
    }
    if (/^[A-Za-z]+:/.test(path) || /%2e|%2f|%5c/i.test(path)) {
        return false;
    }
    for (const character of path) {
        const codePoint = character.codePointAt(0);
        if (codePoint !== undefined && (codePoint < 0x20 || codePoint === 0x7f)) {
            return false;
        }
    }
    return path
        .split('/')
        .every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}
export function parseNodeId(value) {
    if (typeof value !== 'string' || value.length > 1100) {
        return null;
    }
    const separator = value.indexOf(':');
    if (separator <= 0) {
        return null;
    }
    const root = value.slice(0, separator);
    const path = value.slice(separator + 1);
    if (!isRootKind(root) || !isValidNodePath(path)) {
        return null;
    }
    return { root, path };
}
export function isNodeId(value) {
    return parseNodeId(value) !== null;
}
export function makeNodeId(root, path) {
    const value = `${root}:${path}`;
    if (!isNodeId(value)) {
        throw new RangeError('Invalid node id');
    }
    return value;
}
function isPlainObject(value) {
    return (typeof value === 'object' &&
        value !== null &&
        Object.getPrototypeOf(value) === Object.prototype);
}
function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}
function hasForbiddenKey(value) {
    return Object.getOwnPropertyNames(value).some((key) => key === '__proto__' || key === 'constructor' || key === 'prototype');
}
function hasExtraKey(value, allowed) {
    return Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !allowed.includes(key));
}
function fail(reason) {
    return { ok: false, reason };
}
function success(value) {
    return { ok: true, value };
}
function badPayload(field) {
    return fail(`bad_payload:${field}`);
}
function getMaxChars(options) {
    const maxChars = options?.maxChars;
    return typeof maxChars === 'number' && Number.isFinite(maxChars) && maxChars >= 0
        ? maxChars
        : MAX_MESSAGE_CHARS;
}
function parseEnvelope(input, allowedTypes, options) {
    if (!isPlainObject(input)) {
        return fail('not_object');
    }
    if (hasForbiddenKey(input)) {
        return fail('forbidden_key');
    }
    try {
        const serialized = JSON.stringify(input);
        if (typeof serialized !== 'string') {
            return fail('unserializable');
        }
        if (serialized.length > getMaxChars(options)) {
            return fail('too_large');
        }
    }
    catch {
        return fail('unserializable');
    }
    const type = input.type;
    if (typeof type !== 'string' || !allowedTypes.includes(type)) {
        return fail('unknown_type');
    }
    if (hasExtraKey(input, ['type', 'payload'])) {
        return fail('extra_key');
    }
    return success({
        type,
        hasPayload: hasOwn(input, 'payload'),
        payload: input.payload,
    });
}
function requirePayload(envelope) {
    if (!envelope.hasPayload || !isPlainObject(envelope.payload)) {
        return badPayload('payload');
    }
    return success(envelope.payload);
}
function validateRequestId(value) {
    return (typeof value === 'string' &&
        value.length > 0 &&
        value.length <= 128 &&
        /^[A-Za-z0-9._-]+$/.test(value));
}
function parseRootGroup(value, field) {
    if (!isPlainObject(value) || hasForbiddenKey(value)) {
        return badPayload(field);
    }
    const { root, label, color } = value;
    if (!isRootKind(root) || typeof label !== 'string' || typeof color !== 'string') {
        return badPayload(field);
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
        return badPayload(field);
    }
    return success({ root, label, color });
}
function parseFocusRequest(value) {
    if (!isPlainObject(value) || hasForbiddenKey(value)) {
        return badPayload('focus');
    }
    if (!validateRequestId(value.requestId)) {
        return badPayload('focus.requestId');
    }
    if (!isNodeId(value.nodeId)) {
        return badPayload('focus.nodeId');
    }
    if (hasOwn(value, 'center') && typeof value.center !== 'boolean') {
        return badPayload('focus.center');
    }
    const result = {
        requestId: value.requestId,
        nodeId: value.nodeId,
    };
    if (hasOwn(value, 'center')) {
        result.center = value.center;
    }
    return success(result);
}
function parseFocusResult(value) {
    if (!isPlainObject(value) || hasForbiddenKey(value)) {
        return badPayload('focus');
    }
    if (!validateRequestId(value.requestId)) {
        return badPayload('focus.requestId');
    }
    if (!isNodeId(value.nodeId)) {
        return badPayload('focus.nodeId');
    }
    if (typeof value.ok !== 'boolean') {
        return badPayload('focus.ok');
    }
    if (hasOwn(value, 'reason') &&
        (typeof value.reason !== 'string' || value.reason.length > 500)) {
        return badPayload('focus.reason');
    }
    const result = {
        requestId: value.requestId,
        nodeId: value.nodeId,
        ok: value.ok,
    };
    if (hasOwn(value, 'reason')) {
        result.reason = value.reason;
    }
    return success(result);
}
function parseGroupMatch(value, field) {
    if (!isPlainObject(value) || hasForbiddenKey(value)) {
        return badPayload(field);
    }
    if (typeof value.property !== 'string' || typeof value.value !== 'string') {
        return badPayload(field);
    }
    return success({ property: value.property, value: value.value });
}
function parseGroupRule(value, field) {
    if (!isPlainObject(value) || hasForbiddenKey(value)) {
        return badPayload(field);
    }
    if (typeof value.id !== 'string' ||
        typeof value.label !== 'string' ||
        typeof value.color !== 'string' ||
        typeof value.enabled !== 'boolean') {
        return badPayload(field);
    }
    const match = parseGroupMatch(value.match, `${field}.match`);
    if (!match.ok) {
        return match;
    }
    return success({
        id: value.id,
        label: value.label,
        color: value.color,
        enabled: value.enabled,
        match: match.value,
    });
}
function parseStyleConfig(value, field) {
    if (!isPlainObject(value) || hasForbiddenKey(value)) {
        return badPayload(field);
    }
    const result = {};
    const stringFields = [
        'background',
        'fontFamily',
        'lineColor',
        'highlightedForeground',
    ];
    const numberFields = ['fontSize', 'lineWidth', 'particleWidth'];
    for (const key of stringFields) {
        if (hasOwn(value, key)) {
            if (typeof value[key] !== 'string') {
                return badPayload(`${field}.${key}`);
            }
            result[key] = value[key];
        }
    }
    for (const key of numberFields) {
        if (hasOwn(value, key)) {
            if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) {
                return badPayload(`${field}.${key}`);
            }
            result[key] = value[key];
        }
    }
    if (hasOwn(value, 'node')) {
        if (!isPlainObject(value.node) || hasForbiddenKey(value.node)) {
            return badPayload(`${field}.node`);
        }
        const node = {};
        for (const key of Reflect.ownKeys(value.node)) {
            if (typeof key !== 'string') {
                return badPayload(`${field}.node`);
            }
            const nodeValue = value.node[key];
            if (typeof nodeValue !== 'string' && nodeValue !== undefined) {
                return badPayload(`${field}.node`);
            }
            Object.defineProperty(node, key, {
                configurable: true,
                enumerable: true,
                value: nodeValue,
                writable: true,
            });
        }
        result.node = node;
    }
    return success(result);
}
function parseBooleanRecord(value, field) {
    if (!isPlainObject(value) || hasForbiddenKey(value)) {
        return badPayload(field);
    }
    const result = {};
    for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== 'string' || typeof value[key] !== 'boolean') {
            return badPayload(field);
        }
        Object.defineProperty(result, key, {
            configurable: true,
            enumerable: true,
            value: value[key],
            writable: true,
        });
    }
    return success(result);
}
function parseGraphStyle(value) {
    if (!isPlainObject(value) || hasForbiddenKey(value)) {
        return badPayload('style');
    }
    const result = {};
    if (hasOwn(value, 'colorMode')) {
        if (value.colorMode !== 'none' && value.colorMode !== 'directory' && value.colorMode !== 'type') {
            return badPayload('colorMode');
        }
        result.colorMode = value.colorMode;
    }
    if (hasOwn(value, 'groups')) {
        if (!Array.isArray(value.groups)) {
            return badPayload('groups');
        }
        const groups = [];
        for (const [index, group] of value.groups.entries()) {
            const parsed = parseGroupRule(group, `groups[${index}]`);
            if (!parsed.ok) {
                return parsed;
            }
            groups.push(parsed.value);
        }
        result.groups = groups;
    }
    if (hasOwn(value, 'showNodesOfType')) {
        const showNodesOfType = parseBooleanRecord(value.showNodesOfType, 'showNodesOfType');
        if (!showNodesOfType.ok) {
            return showNodesOfType;
        }
        result.showNodesOfType = showNodesOfType.value;
    }
    if (hasOwn(value, 'style')) {
        const style = parseStyleConfig(value.style, 'style');
        if (!style.ok) {
            return style;
        }
        result.style = style.value;
    }
    return success(result);
}
function cloneUnknown(value) {
    if (value === null || typeof value !== 'object') {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((item) => cloneUnknown(item));
    }
    if (isPlainObject(value)) {
        const result = {};
        for (const key of Object.keys(value)) {
            Object.defineProperty(result, key, {
                configurable: true,
                enumerable: true,
                value: cloneUnknown(value[key]),
                writable: true,
            });
        }
        return result;
    }
    return undefined;
}
function parseTags(value, field) {
    if (!Array.isArray(value)) {
        return badPayload(field);
    }
    const tags = [];
    for (const [index, tag] of value.entries()) {
        if (!isPlainObject(tag) || hasForbiddenKey(tag) || typeof tag.label !== 'string') {
            return badPayload(`${field}[${index}]`);
        }
        tags.push({ label: tag.label });
    }
    return success(tags);
}
function parseNodeInfo(value, field) {
    if (!isPlainObject(value) || hasForbiddenKey(value)) {
        return badPayload(field);
    }
    if (typeof value.id !== 'string' ||
        typeof value.type !== 'string' ||
        typeof value.title !== 'string' ||
        !isPlainObject(value.properties)) {
        return badPayload(field);
    }
    if (hasForbiddenKey(value.properties)) {
        return badPayload(`${field}.properties`);
    }
    const tags = parseTags(value.tags, `${field}.tags`);
    if (!tags.ok) {
        return tags;
    }
    if (hasOwn(value, 'root') && !isRootKind(value.root)) {
        return badPayload(`${field}.root`);
    }
    const result = {
        id: value.id,
        type: value.type,
        title: value.title,
        properties: cloneUnknown(value.properties),
        tags: tags.value,
    };
    if (hasOwn(value, 'root')) {
        result.root = value.root;
    }
    return success(result);
}
function parseGraphData(value) {
    if (!isPlainObject(value) || hasForbiddenKey(value)) {
        return badPayload('graphData');
    }
    if (!isPlainObject(value.nodeInfo)) {
        return badPayload('nodeInfo');
    }
    if (hasForbiddenKey(value.nodeInfo)) {
        return badPayload('nodeInfo');
    }
    const nodeInfo = {};
    for (const key of Reflect.ownKeys(value.nodeInfo)) {
        if (typeof key !== 'string') {
            return badPayload('nodeInfo');
        }
        const parsed = parseNodeInfo(value.nodeInfo[key], `nodeInfo.${key}`);
        if (!parsed.ok) {
            return parsed;
        }
        if (parsed.value.id !== key) {
            return badPayload('nodeInfo');
        }
        Object.defineProperty(nodeInfo, key, {
            configurable: true,
            enumerable: true,
            value: parsed.value,
            writable: true,
        });
    }
    if (!Array.isArray(value.links)) {
        return badPayload('links');
    }
    const links = [];
    for (const [index, link] of value.links.entries()) {
        if (!isPlainObject(link) ||
            hasForbiddenKey(link) ||
            typeof link.source !== 'string' ||
            typeof link.target !== 'string' ||
            !Object.prototype.hasOwnProperty.call(nodeInfo, link.source) ||
            !Object.prototype.hasOwnProperty.call(nodeInfo, link.target)) {
            return badPayload(`links[${index}]`);
        }
        links.push({ source: link.source, target: link.target });
    }
    const result = { nodeInfo, links };
    if (hasOwn(value, 'rootGroups')) {
        if (!Array.isArray(value.rootGroups)) {
            return badPayload('rootGroups');
        }
        const rootGroups = [];
        const seenRoots = new Set();
        for (const [index, rootGroup] of value.rootGroups.entries()) {
            const parsed = parseRootGroup(rootGroup, `rootGroups[${index}]`);
            if (!parsed.ok) {
                return parsed;
            }
            if (seenRoots.has(parsed.value.root)) {
                return badPayload('rootGroups');
            }
            seenRoots.add(parsed.value.root);
            rootGroups.push(parsed.value);
        }
        result.rootGroups = rootGroups;
    }
    if (hasOwn(value, 'protocolVersion')) {
        if (value.protocolVersion !== PA_HUB_PROTOCOL_VERSION) {
            return badPayload('protocolVersion');
        }
        result.protocolVersion = value.protocolVersion;
    }
    return success(result);
}
function parseVisibility(value) {
    if (!isPlainObject(value) || hasForbiddenKey(value) || typeof value.visible !== 'boolean') {
        return badPayload('visibility');
    }
    return success({ visible: value.visible });
}
function parseReady(value) {
    if (!isPlainObject(value) ||
        hasForbiddenKey(value) ||
        typeof value.protocolVersion !== 'number' ||
        !Number.isFinite(value.protocolVersion) ||
        !Number.isInteger(value.protocolVersion) ||
        value.protocolVersion < 1) {
        return badPayload('protocolVersion');
    }
    return success({ protocolVersion: value.protocolVersion });
}
function parseErrorPayload(value) {
    if (!isPlainObject(value) || hasForbiddenKey(value)) {
        return badPayload('error');
    }
    if (typeof value.message !== 'string' ||
        value.message.length > 2000 ||
        typeof value.filename !== 'string' ||
        value.filename.length > 1024 ||
        typeof value.lineno !== 'number' ||
        !Number.isFinite(value.lineno) ||
        value.lineno < 0 ||
        typeof value.colno !== 'number' ||
        !Number.isFinite(value.colno) ||
        value.colno < 0) {
        return badPayload('error');
    }
    return success({
        message: value.message,
        filename: value.filename,
        lineno: value.lineno,
        colno: value.colno,
    });
}
export function parseExtensionMessage(input, options) {
    const envelope = parseEnvelope(input, EXTENSION_MESSAGE_TYPES, options);
    if (!envelope.ok) {
        return envelope;
    }
    switch (envelope.value.type) {
        case 'didUpdateStyle': {
            const payload = requirePayload(envelope.value);
            if (!payload.ok) {
                return payload;
            }
            const style = parseGraphStyle(payload.value);
            return style.ok
                ? success({ type: 'didUpdateStyle', payload: style.value })
                : style;
        }
        case 'didUpdateGraphData': {
            const payload = requirePayload(envelope.value);
            if (!payload.ok) {
                return payload;
            }
            const graphData = parseGraphData(payload.value);
            return graphData.ok
                ? success({ type: 'didUpdateGraphData', payload: graphData.value })
                : graphData;
        }
        case 'didSelectNote':
            if (!envelope.value.hasPayload || !isNodeId(envelope.value.payload)) {
                return badPayload('nodeId');
            }
            return success({ type: 'didSelectNote', payload: envelope.value.payload });
        case 'didRequestFocus': {
            const focus = parseFocusRequest(envelope.value.payload);
            return focus.ok
                ? success({ type: 'didRequestFocus', payload: focus.value })
                : focus;
        }
        case 'didChangeVisibility': {
            const visibility = parseVisibility(envelope.value.payload);
            return visibility.ok
                ? success({ type: 'didChangeVisibility', payload: visibility.value })
                : visibility;
        }
    }
    return fail('unknown_type');
}
export function parseWebviewMessage(input, options) {
    const envelope = parseEnvelope(input, WEBVIEW_MESSAGE_TYPES, options);
    if (!envelope.ok) {
        return envelope;
    }
    switch (envelope.value.type) {
        case 'webviewDidLoad':
            if (envelope.value.hasPayload) {
                return badPayload('payload');
            }
            return success({ type: 'webviewDidLoad' });
        case 'webviewDidSelectNode':
            if (!envelope.value.hasPayload || !isNodeId(envelope.value.payload)) {
                return badPayload('nodeId');
            }
            return success({ type: 'webviewDidSelectNode', payload: envelope.value.payload });
        case 'webviewDidBecomeReady': {
            const ready = parseReady(envelope.value.payload);
            return ready.ok
                ? success({ type: 'webviewDidBecomeReady', payload: ready.value })
                : ready;
        }
        case 'webviewDidFocusNode': {
            const focus = parseFocusResult(envelope.value.payload);
            return focus.ok
                ? success({ type: 'webviewDidFocusNode', payload: focus.value })
                : focus;
        }
        case 'error': {
            const error = parseErrorPayload(envelope.value.payload);
            return error.ok ? success({ type: 'error', payload: error.value }) : error;
        }
    }
    return fail('unknown_type');
}
