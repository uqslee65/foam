import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  bootstrap,
  createMarkdownParser,
  Emitter,
  MarkdownResourceProvider,
  URI,
} from '@foam/core';
import type { IDataStore, IMatcher, IWatcher } from '@foam/core';
import { describe, expect, it } from 'vitest';
import { createPrivacyPolicy } from '../privacy';
import type { PrivacyPolicy } from '../privacy';
import { withPrivacy } from '../privacy-index';

const ROOT = '/synthetic-workspace';
const allowedUri = URI.file(`${ROOT}/notes/allowed.md`);
const excludedUri = URI.file(`${ROOT}/knowledge/me/profile.md`);
const globExcludedUri = URI.file(`${ROOT}/private/ledger.md`);
const nonFileUri = new URI({
  scheme: 'untitled',
  path: `${ROOT}/notes/allowed.md`,
});
const SENTINEL = 'PA_HUB_SENTINEL_9f3a';

function createPolicy(isDenied: (input: string) => boolean): PrivacyPolicy {
  const isAllowed = (input: unknown): boolean =>
    typeof input === 'string' && !isDenied(input);

  return {
    version: 'test-privacy-v1',
    decide: input => {
      const stringInput = typeof input === 'string' ? input : null;
      const allowed = isAllowed(input);
      return {
        allowed,
        reason: allowed
          ? 'allowed'
          : stringInput === null
          ? 'invalid_input'
          : 'configured_exclusion',
        input: stringInput,
        canonicalPath: null,
        root: null,
        relativePath: null,
      };
    },
    isAllowed,
    purge: <K extends string>(keys: Iterable<K>): K[] =>
      [...keys].filter(key => !isAllowed(key)),
  };
}

function createMatcher(matchedUris: URI[]): {
  matcher: IMatcher;
  refreshCount: () => number;
} {
  let refreshes = 0;
  const matches = (uri: URI) =>
    matchedUris.some(matchedUri => matchedUri.isEqual(uri));

  return {
    matcher: {
      include: ['**/*'],
      exclude: [],
      isMatch: matches,
      match: files => files.filter(matches),
      refresh: async () => {
        refreshes += 1;
      },
    },
    refreshCount: () => refreshes,
  };
}

function createDataStore(
  files: URI[],
  content: Map<string, string>
): {
  dataStore: IDataStore;
  reads: URI[];
  writes: Array<{ uri: URI; content: string }>;
  deletes: URI[];
  moves: Array<{ from: URI; to: URI }>;
  exists: URI[];
  patterns: Array<string | undefined>;
} {
  const reads: URI[] = [];
  const writes: Array<{ uri: URI; content: string }> = [];
  const deletes: URI[] = [];
  const moves: Array<{ from: URI; to: URI }> = [];
  const exists: URI[] = [];
  const patterns: Array<string | undefined> = [];

  return {
    dataStore: {
      list: async pattern => {
        patterns.push(pattern);
        return files;
      },
      read: async uri => {
        reads.push(uri);
        return content.get(uri.toString()) ?? null;
      },
      write: async (uri, value) => {
        writes.push({ uri, content: value });
      },
      delete: async uri => {
        deletes.push(uri);
      },
      move: async (from, to) => {
        moves.push({ from, to });
      },
      exists: async uri => {
        exists.push(uri);
        return content.has(uri.toString());
      },
    },
    reads,
    writes,
    deletes,
    moves,
    exists,
    patterns,
  };
}

function pathList(uris: URI[]): string[] {
  return uris.map(uri => uri.path);
}

interface RealVaultFixture {
  vaultDir: string;
  profileUri: URI;
  allowedUri: URI;
  files: URI[];
  content: Map<string, string>;
  store: ReturnType<typeof createDataStore>;
}

function createRealVaultFixture(includePrivateFile = false): RealVaultFixture {
  const vaultDir = mkdtempSync('/private/tmp/privacy-index-');
  const profilePath = join(vaultDir, 'knowledge/me/profile.md');
  const allowedPath = join(vaultDir, 'notes/a.md');
  const profileUri = URI.file(profilePath);
  const allowedUri = URI.file(allowedPath);
  const files = [profileUri, allowedUri];
  const content = new Map([
    [profileUri.toString(), SENTINEL],
    [allowedUri.toString(), '# Allowed note'],
  ]);

  mkdirSync(dirname(profilePath), { recursive: true });
  mkdirSync(dirname(allowedPath), { recursive: true });
  writeFileSync(profilePath, SENTINEL);
  writeFileSync(allowedPath, '# Allowed note');

  if (includePrivateFile) {
    const privatePath = join(vaultDir, 'private/x.md');
    const privateUri = URI.file(privatePath);
    mkdirSync(dirname(privatePath), { recursive: true });
    writeFileSync(privatePath, '# Private note');
    files.push(privateUri);
    content.set(privateUri.toString(), '# Private note');
  }

  return {
    vaultDir,
    profileUri,
    allowedUri,
    files,
    content,
    store: createDataStore(files, content),
  };
}

function addRealVaultFile(
  fixture: RealVaultFixture,
  relativePath: string,
  value: string
): URI {
  const uri = URI.file(join(fixture.vaultDir, relativePath));
  writeFileSync(uri.toFsPath(), value);
  fixture.files.push(uri);
  fixture.content.set(uri.toString(), value);
  return uri;
}

class FakeWatcher implements IWatcher {
  onDidCreateEmitter = new Emitter<URI>();
  onDidChangeEmitter = new Emitter<URI>();
  onDidDeleteEmitter = new Emitter<URI>();
  onDidCreate = this.onDidCreateEmitter.event;
  onDidChange = this.onDidChangeEmitter.event;
  onDidDelete = this.onDidDeleteEmitter.event;

  fireCreate(uri: URI) {
    this.onDidCreateEmitter.fire(uri);
  }

  fireChange(uri: URI) {
    this.onDidChangeEmitter.fire(uri);
  }

  fireDelete(uri: URI) {
    this.onDidDeleteEmitter.fire(uri);
  }
}

const waitForCreateDebounce = () =>
  new Promise(resolve => setTimeout(resolve, 200));

describe('withPrivacy', () => {
  it('test_privacy_index_filters_excluded_resources_from_initial_list', async () => {
    const store = createDataStore([allowedUri, excludedUri], new Map());
    const wrapped = withPrivacy(
      createPolicy(input => input === excludedUri.toFsPath()),
      createMatcher([allowedUri, excludedUri]).matcher,
      store.dataStore
    );

    expect(pathList(await wrapped.dataStore.list())).toEqual([allowedUri.path]);
  });

  it('test_privacy_index_passes_list_patterns_before_filtering', async () => {
    const store = createDataStore([allowedUri], new Map());
    const wrapped = withPrivacy(
      createPolicy(() => false),
      createMatcher([allowedUri]).matcher,
      store.dataStore
    );

    await wrapped.dataStore.list('notes/**/*.md');

    expect(store.patterns).toEqual(['notes/**/*.md']);
  });

  it('test_privacy_index_returns_null_for_excluded_read_without_inner_call', async () => {
    const store = createDataStore(
      [excludedUri],
      new Map([[excludedUri.toString(), SENTINEL]])
    );
    const wrapped = withPrivacy(
      createPolicy(input => input === excludedUri.toFsPath()),
      createMatcher([excludedUri]).matcher,
      store.dataStore
    );

    expect(await wrapped.dataStore.read(excludedUri)).toBeNull();
    expect(store.reads).toEqual([]);
  });

  it('test_privacy_index_reads_allowed_content_through_inner_store', async () => {
    const store = createDataStore(
      [allowedUri],
      new Map([[allowedUri.toString(), 'visible content']])
    );
    const wrapped = withPrivacy(
      createPolicy(() => false),
      createMatcher([allowedUri]).matcher,
      store.dataStore
    );

    expect(await wrapped.dataStore.read(allowedUri)).toBe('visible content');
    expect(pathList(store.reads)).toEqual([allowedUri.path]);
  });

  it('test_privacy_index_denies_excluded_matcher_checks', () => {
    const store = createDataStore([], new Map());
    const wrapped = withPrivacy(
      createPolicy(input => input === excludedUri.toFsPath()),
      createMatcher([excludedUri]).matcher,
      store.dataStore
    );

    expect(wrapped.matcher.isMatch(excludedUri)).toBe(false);
  });

  it('test_privacy_index_filters_excluded_uris_from_matcher_results_once', () => {
    const store = createDataStore([], new Map());
    const wrapped = withPrivacy(
      createPolicy(input => input === excludedUri.toFsPath()),
      createMatcher([allowedUri, excludedUri]).matcher,
      store.dataStore
    );

    expect(pathList(wrapped.matcher.match([allowedUri, excludedUri]))).toEqual([
      allowedUri.path,
    ]);
  });

  it('test_privacy_index_ignores_excluded_watcher_create_and_change', () => {
    const store = createDataStore([], new Map());
    const wrapped = withPrivacy(
      createPolicy(input => input === excludedUri.toFsPath()),
      createMatcher([allowedUri, excludedUri]).matcher,
      store.dataStore
    );
    const watcherEvents = [
      { kind: 'create', uri: excludedUri },
      { kind: 'change', uri: excludedUri },
      { kind: 'change', uri: allowedUri },
    ];

    const processed = watcherEvents.filter(event =>
      wrapped.matcher.isMatch(event.uri)
    );

    expect(processed).toEqual([{ kind: 'change', uri: allowedUri }]);
  });

  it('test_privacy_index_filters_paths_denied_by_configured_glob', async () => {
    const store = createDataStore([allowedUri, globExcludedUri], new Map());
    const wrapped = withPrivacy(
      createPolicy(input => input.startsWith(`${ROOT}/private/`)),
      createMatcher([allowedUri, globExcludedUri]).matcher,
      store.dataStore
    );

    expect(pathList(await wrapped.dataStore.list('**/*.md'))).toEqual([
      allowedUri.path,
    ]);
  });

  it('test_privacy_index_never_leaks_excluded_sentinel_through_bootstrap', async () => {
    const store = createDataStore(
      [allowedUri, excludedUri],
      new Map([
        [allowedUri.toString(), '# Visible note'],
        [excludedUri.toString(), SENTINEL],
      ])
    );
    const innerMatcher = createMatcher([allowedUri, excludedUri]);
    const wrapped = withPrivacy(
      createPolicy(input => input === excludedUri.toFsPath()),
      innerMatcher.matcher,
      store.dataStore
    );
    const parser = createMarkdownParser([]);
    const provider = new MarkdownResourceProvider(wrapped.dataStore, parser);
    const foam = await bootstrap(
      [URI.file(ROOT)],
      wrapped.matcher,
      undefined,
      wrapped.dataStore,
      parser,
      [provider],
      '.md',
      'off'
    );

    try {
      expect(
        pathList(foam.workspace.list().map(resource => resource.uri))
      ).toEqual([allowedUri.path]);
      expect(await foam.workspace.readAsMarkdown(excludedUri)).toBeNull();
      expect(pathList(store.reads)).toEqual([allowedUri.path]);
      expect(JSON.stringify(foam.workspace.list())).not.toContain(SENTINEL);
    } finally {
      foam.dispose();
    }
  });

  it('test_privacy_index_denies_non_file_scheme_even_when_policy_allows', async () => {
    const store = createDataStore(
      [nonFileUri],
      new Map([[nonFileUri.toString(), SENTINEL]])
    );
    const wrapped = withPrivacy(
      createPolicy(() => false),
      createMatcher([nonFileUri]).matcher,
      store.dataStore
    );

    expect(wrapped.matcher.isMatch(nonFileUri)).toBe(false);
    expect(await wrapped.dataStore.list()).toEqual([]);
    expect(await wrapped.dataStore.read(nonFileUri)).toBeNull();
    expect(store.reads).toEqual([]);
  });

  it('test_privacy_index_delegates_matcher_refresh', async () => {
    const store = createDataStore([], new Map());
    const innerMatcher = createMatcher([]);
    const wrapped = withPrivacy(
      createPolicy(() => false),
      innerMatcher.matcher,
      store.dataStore
    );

    await wrapped.matcher.refresh();

    expect(innerMatcher.refreshCount()).toBe(1);
  });

  it('test_privacy_index_denies_excluded_writes_and_passes_allowed_writes_through', async () => {
    const store = createDataStore([], new Map());
    const wrapped = withPrivacy(
      createPolicy(input => input === excludedUri.toFsPath()),
      createMatcher([]).matcher,
      store.dataStore
    );

    await expect(
      wrapped.dataStore.write(excludedUri, 'new content')
    ).rejects.toThrow('Privacy policy denied write');
    expect(store.writes).toEqual([]);

    await wrapped.dataStore.write(allowedUri, 'allowed content');

    expect(store.writes).toEqual([
      { uri: allowedUri, content: 'allowed content' },
    ]);
  });

  it('test_privacy_index_denies_excluded_deletes_and_passes_allowed_deletes_through', async () => {
    const store = createDataStore([], new Map());
    const wrapped = withPrivacy(
      createPolicy(input => input === excludedUri.toFsPath()),
      createMatcher([]).matcher,
      store.dataStore
    );

    await expect(wrapped.dataStore.delete(excludedUri)).rejects.toThrow(
      'Privacy policy denied delete'
    );
    expect(store.deletes).toEqual([]);

    await wrapped.dataStore.delete(allowedUri);

    expect(pathList(store.deletes)).toEqual([allowedUri.path]);
  });

  it('test_privacy_index_denies_excluded_moves_and_passes_allowed_moves_through', async () => {
    const store = createDataStore([], new Map());
    const wrapped = withPrivacy(
      createPolicy(input => input === excludedUri.toFsPath()),
      createMatcher([]).matcher,
      store.dataStore
    );

    await expect(
      wrapped.dataStore.move(excludedUri, allowedUri)
    ).rejects.toThrow('Privacy policy denied move');
    await expect(
      wrapped.dataStore.move(allowedUri, excludedUri)
    ).rejects.toThrow('Privacy policy denied move');
    expect(store.moves).toEqual([]);

    const movedUri = URI.file(`${ROOT}/notes/moved.md`);
    await wrapped.dataStore.move(allowedUri, movedUri);

    expect(store.moves).toEqual([{ from: allowedUri, to: movedUri }]);
  });

  it('test_privacy_index_passes_exists_through', async () => {
    const store = createDataStore(
      [excludedUri],
      new Map([[excludedUri.toString(), SENTINEL]])
    );
    const wrapped = withPrivacy(
      createPolicy(input => input === excludedUri.toFsPath()),
      createMatcher([]).matcher,
      store.dataStore
    );

    expect(await wrapped.dataStore.exists(excludedUri)).toBe(true);
    expect(pathList(store.exists)).toEqual([excludedUri.path]);
  });

  it('test_privacy_index_real_policy_excludes_mandatory_path', async () => {
    const fixture = createRealVaultFixture();
    const policy = createPrivacyPolicy({
      roots: [fixture.vaultDir],
      excludeGlobs: [],
    });
    const wrapped = withPrivacy(
      policy,
      createMatcher(fixture.files).matcher,
      fixture.store.dataStore
    );
    const parser = createMarkdownParser([]);
    const provider = new MarkdownResourceProvider(wrapped.dataStore, parser);
    const foam = await bootstrap(
      [URI.file(fixture.vaultDir)],
      wrapped.matcher,
      undefined,
      wrapped.dataStore,
      parser,
      [provider],
      '.md',
      'off'
    );

    try {
      expect(
        pathList(foam.workspace.list().map(resource => resource.uri))
      ).toEqual([fixture.allowedUri.path]);
      expect(
        await foam.workspace.readAsMarkdown(fixture.profileUri)
      ).toBeNull();
      expect(JSON.stringify(foam.workspace.list())).not.toContain(SENTINEL);
    } finally {
      foam.dispose();
      rmSync(fixture.vaultDir, { recursive: true, force: true });
    }
  });

  it('test_privacy_index_real_policy_with_glob_exclusion', async () => {
    const fixture = createRealVaultFixture(true);
    const policy = createPrivacyPolicy({
      roots: [fixture.vaultDir],
      excludeGlobs: ['private/**'],
    });
    const wrapped = withPrivacy(
      policy,
      createMatcher(fixture.files).matcher,
      fixture.store.dataStore
    );
    const parser = createMarkdownParser([]);
    const provider = new MarkdownResourceProvider(wrapped.dataStore, parser);
    const foam = await bootstrap(
      [URI.file(fixture.vaultDir)],
      wrapped.matcher,
      undefined,
      wrapped.dataStore,
      parser,
      [provider],
      '.md',
      'off'
    );

    try {
      expect(
        pathList(foam.workspace.list().map(resource => resource.uri))
      ).toEqual([fixture.allowedUri.path]);
    } finally {
      foam.dispose();
      rmSync(fixture.vaultDir, { recursive: true, force: true });
    }
  });

  it('test_privacy_index_watcher_create_excluded_through_bootstrap', async () => {
    const fixture = createRealVaultFixture();
    const policy = createPrivacyPolicy({
      roots: [fixture.vaultDir],
      excludeGlobs: [],
    });
    const wrapped = withPrivacy(
      policy,
      createMatcher(fixture.files).matcher,
      fixture.store.dataStore
    );
    const parser = createMarkdownParser([]);
    const provider = new MarkdownResourceProvider(wrapped.dataStore, parser);
    const watcher = new FakeWatcher();
    const foam = await bootstrap(
      [URI.file(fixture.vaultDir)],
      wrapped.matcher,
      watcher,
      wrapped.dataStore,
      parser,
      [provider],
      '.md',
      'off'
    );

    try {
      watcher.fireChange(fixture.profileUri);
      watcher.fireCreate(fixture.profileUri);
      await waitForCreateDebounce();

      expect(
        pathList(foam.workspace.list().map(resource => resource.uri))
      ).toEqual([fixture.allowedUri.path]);
    } finally {
      foam.dispose();
      rmSync(fixture.vaultDir, { recursive: true, force: true });
    }
  });

  it('test_privacy_index_watcher_create_allowed_succeeds', async () => {
    const fixture = createRealVaultFixture();
    const policy = createPrivacyPolicy({
      roots: [fixture.vaultDir],
      excludeGlobs: [],
    });
    const wrapped = withPrivacy(
      policy,
      createMatcher(fixture.files).matcher,
      fixture.store.dataStore
    );
    const parser = createMarkdownParser([]);
    const provider = new MarkdownResourceProvider(wrapped.dataStore, parser);
    const watcher = new FakeWatcher();
    const foam = await bootstrap(
      [URI.file(fixture.vaultDir)],
      wrapped.matcher,
      watcher,
      wrapped.dataStore,
      parser,
      [provider],
      '.md',
      'off'
    );

    try {
      const newUri = addRealVaultFile(fixture, 'notes/b.md', '# Created note');
      watcher.fireCreate(newUri);
      await waitForCreateDebounce();

      expect(
        pathList(foam.workspace.list().map(resource => resource.uri)).sort()
      ).toEqual([fixture.allowedUri.path, newUri.path].sort());
    } finally {
      foam.dispose();
      rmSync(fixture.vaultDir, { recursive: true, force: true });
    }
  });
});
