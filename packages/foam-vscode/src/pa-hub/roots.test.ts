import { describe, expect, it } from 'vitest';
import { Range, URI, type Connection, type Resource } from '@foam/core';
import { buildRootQualifiedGraphData } from './graph-data';
import { classifyRoots, makeResourceNodeId, resolveRoot } from './roots';

const vaultRoot = URI.file('/workspace');
const sourcesRoot = URI.file('/sources');

function makeResource(uri: URI, title = uri.getBasename()): Resource {
  return {
    uri,
    type: 'note',
    title,
    properties: {},
    sections: [],
    blocks: [],
    tags: [],
    aliases: [],
    links: [],
    footnotes: [],
  };
}

function makeConnection(source: URI, target: URI): Connection {
  return {
    source,
    target,
    link: {
      type: 'wikilink',
      rawText: '[[target]]',
      range: Range.create(0, 0, 0, 0),
      isEmbed: false,
    },
  };
}

describe('roots and graph data', () => {
  it('test_roots_single_root_is_vault', () => {
    expect(classifyRoots([vaultRoot])).toEqual({
      roots: [{ uri: vaultRoot, kind: 'vault' }],
      rootGroups: [{ root: 'vault', label: 'Vault', color: '#4a9eff' }],
    });
  });

  it('test_roots_two_roots_first_vault_rest_sources', () => {
    expect(classifyRoots([vaultRoot, sourcesRoot])).toEqual({
      roots: [
        { uri: vaultRoot, kind: 'vault' },
        { uri: sourcesRoot, kind: 'sources' },
      ],
      rootGroups: [
        { root: 'vault', label: 'Vault', color: '#4a9eff' },
        { root: 'sources', label: 'Sources', color: '#ff9f43' },
      ],
    });
  });

  it('test_roots_resolveRoot_matches_first', () => {
    const roots = classifyRoots([
      vaultRoot,
      vaultRoot.joinPath('nested'),
    ]).roots;
    expect(resolveRoot(vaultRoot.joinPath('nested/note.md'), roots)).toBe(
      roots[0]
    );
  });

  it('test_roots_resolveRoot_no_match', () => {
    const roots = classifyRoots([vaultRoot]).roots;
    expect(resolveRoot(URI.file('/outside/note.md'), roots)).toBeUndefined();
  });

  it('test_roots_makeResourceNodeId_valid', () => {
    const roots = classifyRoots([vaultRoot]).roots;
    expect(makeResourceNodeId(vaultRoot.joinPath('notes/foo.md'), roots)).toBe(
      'vault:notes/foo.md'
    );
  });

  it('test_roots_makeResourceNodeId_outside_roots', () => {
    const roots = classifyRoots([vaultRoot]).roots;
    expect(() =>
      makeResourceNodeId(URI.file('/outside/notes/foo.md'), roots)
    ).not.toThrow();
    expect(makeResourceNodeId(URI.file('/outside/notes/foo.md'), roots)).toBe(
      undefined
    );
  });

  it('test_roots_makeResourceNodeId_invalid_path', () => {
    const roots = classifyRoots([vaultRoot]).roots;
    const invalidUri = URI.file('/workspace/notes/foo\u0000.md');
    expect(() => makeResourceNodeId(invalidUri, roots)).not.toThrow(RangeError);
    expect(makeResourceNodeId(invalidUri, roots)).toBeUndefined();
  });

  it('test_graph_data_no_absolute_paths', () => {
    const note = makeResource(vaultRoot.joinPath('notes/foo.md'));
    const graphData = buildRootQualifiedGraphData(
      [note],
      [],
      [vaultRoot]
    ).graphData;
    const serialized = JSON.stringify(graphData);
    expect(serialized).not.toContain('/workspace');
    expect(serialized).not.toContain('file:');
  });

  it('test_graph_data_no_file_uri', () => {
    const note = makeResource(vaultRoot.joinPath('notes/foo.md'));
    const serialized = JSON.stringify(
      buildRootQualifiedGraphData([note], [], [vaultRoot]).graphData
    );
    expect(serialized).not.toContain('file://');
  });

  it('test_graph_data_two_roots_correct_ids', () => {
    const vaultNote = makeResource(vaultRoot.joinPath('notes/foo.md'));
    const sourceNote = makeResource(sourcesRoot.joinPath('papers/foo.md'));
    const { graphData } = buildRootQualifiedGraphData(
      [vaultNote, sourceNote],
      [makeConnection(vaultNote.uri, sourceNote.uri)],
      [vaultRoot, sourcesRoot]
    );
    expect(Object.keys(graphData.nodeInfo)).toEqual([
      'vault:notes/foo.md',
      'sources:papers/foo.md',
    ]);
    expect(graphData.links).toEqual([
      { source: 'vault:notes/foo.md', target: 'sources:papers/foo.md' },
    ]);
  });

  it('test_graph_data_resource_outside_roots_excluded', () => {
    const inside = makeResource(vaultRoot.joinPath('inside.md'));
    const outside = makeResource(URI.file('/outside/outside.md'));
    const { graphData } = buildRootQualifiedGraphData(
      [inside, outside],
      [makeConnection(inside.uri, outside.uri)],
      [vaultRoot]
    );
    expect(graphData.nodeInfo['vault:inside.md']).toBeDefined();
    expect(Object.values(graphData.nodeInfo)).not.toContainEqual(
      expect.objectContaining({ title: 'outside.md' })
    );
    expect(graphData.links).toEqual([]);
  });

  it('test_graph_data_rootGroups_present', () => {
    const { graphData } = buildRootQualifiedGraphData(
      [],
      [],
      [vaultRoot, sourcesRoot]
    );
    expect(graphData.rootGroups).toEqual([
      { root: 'vault', label: 'Vault', color: '#4a9eff' },
      { root: 'sources', label: 'Sources', color: '#ff9f43' },
    ]);
  });

  it('test_graph_data_idToUri_mapping', () => {
    const note = makeResource(vaultRoot.joinPath('notes/foo.md'));
    const { idToUri } = buildRootQualifiedGraphData([note], [], [vaultRoot]);
    expect(idToUri.get('vault:notes/foo.md')).toBe(note.uri);
  });

  it('test_graph_data_placeholders_excluded', () => {
    const note = makeResource(vaultRoot.joinPath('notes/foo.md'));
    const placeholder = URI.placeholder('missing.md');
    const { graphData } = buildRootQualifiedGraphData(
      [note],
      [makeConnection(note.uri, placeholder)],
      [vaultRoot]
    );
    expect(graphData.nodeInfo['missing.md']).toBeUndefined();
    expect(graphData.links).toEqual([]);
  });
});
