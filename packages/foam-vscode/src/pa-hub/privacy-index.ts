import type { IDataStore, IMatcher, URI } from '@foam/core';
import type { PrivacyPolicy } from './privacy';

function isAllowedUri(policy: PrivacyPolicy, uri: URI): boolean {
  if (uri.scheme !== 'file') {
    return false;
  }

  return policy.isAllowed(uri.toFsPath());
}

export function withPrivacy(
  policy: PrivacyPolicy,
  matcher: IMatcher,
  dataStore: IDataStore
): { matcher: IMatcher; dataStore: IDataStore } {
  const wrappedMatcher: IMatcher = {
    include: matcher.include,
    exclude: matcher.exclude,
    isMatch: uri => matcher.isMatch(uri) && isAllowedUri(policy, uri),
    match: files =>
      matcher.match(files).filter(uri => isAllowedUri(policy, uri)),
    refresh: () => matcher.refresh(),
  };

  const wrappedDataStore: IDataStore = {
    list: async pattern =>
      (await dataStore.list(pattern)).filter(uri =>
        isAllowedUri(policy, uri)
      ),
    read: async uri =>
      isAllowedUri(policy, uri) ? dataStore.read(uri) : Promise.resolve(null),
    write: async (uri, content) => {
      if (!isAllowedUri(policy, uri)) {
        throw new Error('Privacy policy denied write');
      }
      await dataStore.write(uri, content);
    },
    delete: async uri => {
      if (!isAllowedUri(policy, uri)) {
        throw new Error('Privacy policy denied delete');
      }
      await dataStore.delete(uri);
    },
    move: async (from, to) => {
      if (!isAllowedUri(policy, from) || !isAllowedUri(policy, to)) {
        throw new Error('Privacy policy denied move');
      }
      await dataStore.move(from, to);
    },
    exists: uri => dataStore.exists(uri),
  };

  return { matcher: wrappedMatcher, dataStore: wrappedDataStore };
}
