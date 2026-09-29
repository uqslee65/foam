import type { URI } from '@foam/core';
import { relativeTo, isWithinPath } from '@foam/core';
// @ts-expect-error The graph-view package publishes its runtime protocol as ESM while this package type-checks as CommonJS.
import { makeNodeId, parseNodeId } from '@foam/graph-view/protocol';
import type { NodeId, RootGroup, RootKind } from '@foam/graph-view/protocol' with {
  'resolution-mode': 'import',
};

export interface ClassifiedRoot {
  uri: URI;
  kind: RootKind;
}

export interface RootClassification {
  roots: ClassifiedRoot[];
  rootGroups: RootGroup[];
}

const ROOT_GROUPS: Record<RootKind, RootGroup> = {
  vault: { root: 'vault', label: 'Vault', color: '#4a9eff' },
  sources: { root: 'sources', label: 'Sources', color: '#ff9f43' },
};

export function classifyRoots(
  workspaceRoots: URI[],
  classification?: Map<URI, RootKind>
): RootClassification {
  const classificationByUri = new Map<string, RootKind>();
  classification?.forEach((kind, uri) =>
    classificationByUri.set(uri.toString(), kind)
  );

  const roots = workspaceRoots.map((uri, index): ClassifiedRoot => {
    const mappedKind = classificationByUri.get(uri.toString());
    return {
      uri,
      kind: mappedKind ?? (index === 0 ? 'vault' : 'sources'),
    };
  });

  const rootGroups = Array.from(new Set(roots.map(root => root.kind))).map(
    kind => ({ ...ROOT_GROUPS[kind] })
  );

  return { roots, rootGroups };
}

export function resolveRoot(
  uri: URI,
  classifiedRoots: ClassifiedRoot[]
): ClassifiedRoot | undefined {
  return classifiedRoots.find(root => isWithinPath(uri, root.uri));
}

function isValidNodePath(path: string): boolean {
  return parseNodeId(`vault:${path}`)?.path === path;
}

export function makeResourceNodeId(
  uri: URI,
  classifiedRoots: ClassifiedRoot[]
): NodeId | undefined {
  const root = resolveRoot(uri, classifiedRoots);
  if (!root) {
    return undefined;
  }

  const relativePath = relativeTo(uri.path, root.uri.path);
  if (!isValidNodePath(relativePath)) {
    return undefined;
  }

  return makeNodeId(root.kind, relativePath);
}
