import type { URI } from '@foam/core';
import type { Resource, Connection } from '@foam/core';
import { buildGraphData } from '@foam/core';
import type { GraphData, NodeId } from '@foam/graph-view/protocol' with {
  'resolution-mode': 'import',
};
import { classifyRoots, makeResourceNodeId } from './roots';

export function buildRootQualifiedGraphData(
  resources: Resource[],
  connections: Connection[],
  workspaceRoots: URI[]
): { graphData: GraphData; idToUri: Map<NodeId, URI> } {
  const classification = classifyRoots(workspaceRoots);
  const builtGraphData = buildGraphData(resources, connections, {
    resourceToId: uri => makeResourceNodeId(uri, classification.roots),
    includePlaceholders: false,
  });

  const idToUri = new Map<NodeId, URI>();
  for (const resource of resources) {
    const id = makeResourceNodeId(resource.uri, classification.roots);
    if (id !== undefined) {
      idToUri.set(id, resource.uri);
    }
  }

  const graphData: GraphData = {
    ...builtGraphData,
    rootGroups: classification.rootGroups,
  };

  return { graphData, idToUri };
}
