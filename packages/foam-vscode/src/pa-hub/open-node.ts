import type { URI } from '@foam/core';
// @ts-expect-error The graph-view package publishes its runtime protocol as ESM while this package type-checks as CommonJS.
import { isNodeId } from '@foam/graph-view/protocol';
import type { NodeId } from '@foam/graph-view/protocol' with {
  'resolution-mode': 'import',
};
import type { DenyReason, PrivacyPolicy } from './privacy';

function isDenyReason(value: unknown): value is DenyReason {
  switch (value) {
    case 'invalid_input':
    case 'encoded_path':
    case 'lookalike_path':
    case 'relative_path':
    case 'outside_roots':
    case 'mandatory_exclusion':
    case 'configured_exclusion':
      return true;
    default:
      return false;
  }
}

export type OpenNodeDeny =
  | { allowed: false; reason: 'invalid_id' }
  | { allowed: false; reason: 'unknown_id'; nodeId: NodeId }
  | { allowed: false; reason: 'stale_mapping'; nodeId: NodeId; uri: URI }
  | {
      allowed: false;
      reason: 'privacy_denied';
      nodeId: NodeId;
      uri: URI;
      denyReason: DenyReason;
    };

export type OpenNodeAllow = { allowed: true; nodeId: NodeId; uri: URI };

export type OpenNodeResult = OpenNodeAllow | OpenNodeDeny;

export function resolveNodeOpen(
  payload: unknown,
  idToUri: Map<NodeId, URI>,
  policy: PrivacyPolicy,
  isInWorkspace: (uri: URI) => boolean
): OpenNodeResult {
  if (!isNodeId(payload)) {
    return { allowed: false, reason: 'invalid_id' };
  }

  const uri = idToUri.get(payload);
  if (uri === undefined) {
    return { allowed: false, reason: 'unknown_id', nodeId: payload };
  }

  if (!isInWorkspace(uri)) {
    return { allowed: false, reason: 'stale_mapping', nodeId: payload, uri };
  }

  if (uri.scheme !== 'file') {
    return {
      allowed: false,
      reason: 'privacy_denied',
      nodeId: payload,
      uri,
      denyReason: 'outside_roots',
    };
  }

  const decision = policy.decide(uri.toFsPath());
  if (!decision.allowed) {
    return {
      allowed: false,
      reason: 'privacy_denied',
      nodeId: payload,
      uri,
      denyReason: isDenyReason(decision.reason)
        ? decision.reason
        : 'invalid_input',
    };
  }

  return { allowed: true, nodeId: payload, uri };
}
