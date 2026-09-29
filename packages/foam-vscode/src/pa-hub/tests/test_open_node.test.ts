import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { URI } from '@foam/core';
// @ts-expect-error The graph-view package publishes its runtime protocol as ESM while this package type-checks as CommonJS.
import { makeNodeId } from '@foam/graph-view/protocol';
import type { NodeId } from '@foam/graph-view/protocol' with {
  'resolution-mode': 'import',
};
import { resolveNodeOpen } from '../open-node';
import { createPrivacyPolicy } from '../privacy';

let fixtureRoot: string;
let profilePath: string;
let notePath: string;
let policy: ReturnType<typeof createPrivacyPolicy>;
let profileId: NodeId;
let noteId: NodeId;

beforeAll(() => {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-hub-open-node-'));
  fs.mkdirSync(path.join(fixtureRoot, 'knowledge', 'me'), { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, 'notes'), { recursive: true });

  profilePath = path.join(fixtureRoot, 'knowledge', 'me', 'profile.md');
  notePath = path.join(fixtureRoot, 'notes', 'hello.md');
  fs.writeFileSync(profilePath, 'profile sentinel');
  fs.writeFileSync(notePath, 'hello');

  policy = createPrivacyPolicy({ roots: [fixtureRoot], excludeGlobs: [] });
  profileId = makeNodeId('vault', 'knowledge/me/profile.md');
  noteId = makeNodeId('vault', 'notes/hello.md');
});

afterAll(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

describe('resolveNodeOpen', () => {
  it('test_open_node_invalid_id', () => {
    const idToUri = new Map<NodeId, URI>([[noteId, URI.file(notePath)]]);

    for (const payload of [null, '', 'not:a:valid:id', 42]) {
      expect(resolveNodeOpen(payload, idToUri, policy, () => true)).toEqual({
        allowed: false,
        reason: 'invalid_id',
      });
    }
  });

  it('test_open_node_unknown_id', () => {
    const unknownId = makeNodeId('vault', 'notes/missing.md');
    const result = resolveNodeOpen(
      unknownId,
      new Map<NodeId, URI>(),
      policy,
      () => true
    );

    expect(result).toEqual({
      allowed: false,
      reason: 'unknown_id',
      nodeId: unknownId,
    });
  });

  it('test_open_node_stale_mapping', () => {
    const uri = URI.file(notePath);
    const result = resolveNodeOpen(
      noteId,
      new Map<NodeId, URI>([[noteId, uri]]),
      policy,
      () => false
    );

    expect(result).toEqual({
      allowed: false,
      reason: 'stale_mapping',
      nodeId: noteId,
      uri,
    });
  });

  it('test_open_node_privacy_denied_mandatory', () => {
    const uri = URI.file(profilePath);
    const result = resolveNodeOpen(
      profileId,
      new Map<NodeId, URI>([[profileId, uri]]),
      policy,
      () => true
    );

    expect(result).toEqual({
      allowed: false,
      reason: 'privacy_denied',
      nodeId: profileId,
      uri,
      denyReason: 'mandatory_exclusion',
    });
  });

  it('test_open_node_privacy_denied_nonfile', () => {
    const uri = URI.parse('notes/hello.md', 'placeholder');
    const result = resolveNodeOpen(
      noteId,
      new Map<NodeId, URI>([[noteId, uri]]),
      policy,
      () => true
    );

    expect(result).toEqual({
      allowed: false,
      reason: 'privacy_denied',
      nodeId: noteId,
      uri,
      denyReason: 'outside_roots',
    });
  });

  it('test_open_node_allowed', () => {
    const uri = URI.file(notePath);
    const result = resolveNodeOpen(
      noteId,
      new Map<NodeId, URI>([[noteId, uri]]),
      policy,
      () => true
    );

    expect(result).toEqual({ allowed: true, nodeId: noteId, uri });
  });
});
