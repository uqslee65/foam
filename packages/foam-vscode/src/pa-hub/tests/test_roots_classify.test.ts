import { describe, expect, it } from 'vitest';
import { URI } from '@foam/core';
import { classifyRoots } from '../roots';

describe('classifyRoots', () => {
  it('returns classifications for known roots', () => {
    const workspaceRoots = [URI.file('/workspace'), URI.file('/sources')];
    const classification = new Map<URI, 'vault' | 'sources'>([
      [URI.file('/workspace'), 'sources'],
      [URI.file('/sources'), 'vault'],
    ]);

    expect(classifyRoots(workspaceRoots, classification).roots).toEqual([
      { uri: workspaceRoots[0], kind: 'sources' },
      { uri: workspaceRoots[1], kind: 'vault' },
    ]);
  });

  it('uses the default kind for unclassified roots', () => {
    const workspaceRoots = [
      URI.file('/workspace'),
      URI.file('/sources'),
      URI.file('/other'),
    ];

    expect(classifyRoots(workspaceRoots, new Map()).roots).toEqual([
      { uri: workspaceRoots[0], kind: 'vault' },
      { uri: workspaceRoots[1], kind: 'sources' },
      { uri: workspaceRoots[2], kind: 'sources' },
    ]);
  });
});
