import { URI } from '@foam/core';
import type { IDataStore, IMatcher } from '@foam/core';
import { describe, expect, it } from 'vitest';
import type { PrivacyPolicy } from '../privacy';
import { withPrivacy } from '../privacy-index';

const allowedUri = URI.file('/synthetic/allowed.md');
const excludedUri = URI.file('/synthetic/private.md');

function createPolicy(excluded: URI): PrivacyPolicy {
  const isAllowed = (input: unknown): boolean =>
    typeof input === 'string' && input !== excluded.toFsPath();

  return {
    version: 'test-privacy-v1',
    decide: input => {
      const allowed = isAllowed(input);
      return {
        allowed,
        reason: allowed ? 'allowed' : 'configured_exclusion',
        input: typeof input === 'string' ? input : null,
        canonicalPath: null,
        root: null,
        relativePath: null,
      };
    },
    isAllowed,
    purge: <K extends string>(keys: Iterable<K>): K[] =>
      [...keys].filter(key => isAllowed(key)),
  };
}

function createStore(): {
  dataStore: IDataStore;
  writes: Array<{ uri: URI; content: string }>;
  deletes: URI[];
  moves: Array<{ from: URI; to: URI }>;
} {
  const writes: Array<{ uri: URI; content: string }> = [];
  const deletes: URI[] = [];
  const moves: Array<{ from: URI; to: URI }> = [];

  return {
    dataStore: {
      list: async () => [],
      read: async () => null,
      write: async (uri, content) => {
        writes.push({ uri, content });
      },
      delete: async uri => {
        deletes.push(uri);
      },
      move: async (from, to) => {
        moves.push({ from, to });
      },
      exists: async () => false,
    },
    writes,
    deletes,
    moves,
  };
}

function createMatcher(): IMatcher {
  return {
    include: ['**/*'],
    exclude: [],
    isMatch: () => true,
    match: files => files,
    refresh: async () => undefined,
  };
}

function createWrappedStore(store: IDataStore): IDataStore {
  return withPrivacy(createPolicy(excludedUri), createMatcher(), store)
    .dataStore;
}

describe('privacy-index mutation checks', () => {
  it('test_privacy_index_write_rejects_excluded_uri', async () => {
    const store = createStore();
    const wrapped = createWrappedStore(store.dataStore);

    await expect(wrapped.write(excludedUri, 'secret')).rejects.toThrow();

    expect(store.writes).toEqual([]);
  });

  it('test_privacy_index_delete_rejects_excluded_uri', async () => {
    const store = createStore();
    const wrapped = createWrappedStore(store.dataStore);

    await expect(wrapped.delete(excludedUri)).rejects.toThrow();

    expect(store.deletes).toEqual([]);
  });

  it('test_privacy_index_move_rejects_excluded_source_uri', async () => {
    const store = createStore();
    const wrapped = createWrappedStore(store.dataStore);

    await expect(wrapped.move(excludedUri, allowedUri)).rejects.toThrow();

    expect(store.moves).toEqual([]);
  });

  it('test_privacy_index_move_rejects_excluded_destination_uri', async () => {
    const store = createStore();
    const wrapped = createWrappedStore(store.dataStore);

    await expect(wrapped.move(allowedUri, excludedUri)).rejects.toThrow();

    expect(store.moves).toEqual([]);
  });
});
