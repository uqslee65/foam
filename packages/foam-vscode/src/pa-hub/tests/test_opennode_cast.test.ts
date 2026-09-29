import { describe, expect, it } from 'vitest';
import { URI } from '@foam/core';
// @ts-expect-error The graph-view package publishes its runtime protocol as ESM while this package type-checks as CommonJS.
import { makeNodeId } from '@foam/graph-view/protocol';
import type { NodeId } from '@foam/graph-view/protocol' with {
  'resolution-mode': 'import',
};
import { resolveNodeOpen } from '../open-node';
import type { DenyReason, PrivacyPolicy } from '../privacy';

const nodeId = makeNodeId('vault', 'notes/hello.md');
const uri = URI.file('/tmp/pa-hub-open-node-cast.md');

function policyFor(reason: unknown): PrivacyPolicy {
  return {
    decide: () =>
      ({
        allowed: false,
        reason,
        input: uri.toFsPath(),
        canonicalPath: uri.toFsPath(),
        root: null,
        relativePath: null,
      }) as unknown as ReturnType<PrivacyPolicy['decide']>,
  } as PrivacyPolicy;
}

function resolveWithReason(reason: unknown) {
  return resolveNodeOpen(
    nodeId,
    new Map<NodeId, URI>([[nodeId, uri]]),
    policyFor(reason),
    () => true
  );
}

describe('resolveNodeOpen DenyReason validation', () => {
  it('passes through every valid DenyReason', () => {
    const reasons: DenyReason[] = [
      'invalid_input',
      'encoded_path',
      'lookalike_path',
      'relative_path',
      'outside_roots',
      'mandatory_exclusion',
      'configured_exclusion',
    ];

    for (const reason of reasons) {
      expect(resolveWithReason(reason)).toMatchObject({
        allowed: false,
        reason: 'privacy_denied',
        denyReason: reason,
      });
    }
  });

  it('falls back to invalid_input for unexpected policy reasons', () => {
    for (const reason of [undefined, null, 'unexpected', 'allowed', 42, {}]) {
      expect(resolveWithReason(reason)).toMatchObject({
        allowed: false,
        reason: 'privacy_denied',
        denyReason: 'invalid_input',
      });
    }
  });
});
