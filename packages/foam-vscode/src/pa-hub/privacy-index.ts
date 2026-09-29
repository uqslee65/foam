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
    write: (uri, content) => dataStore.write(uri, content),
    delete: uri => dataStore.delete(uri),
    move: (from, to) => dataStore.move(from, to),
    exists: uri => dataStore.exists(uri),
  };

  return { matcher: wrappedMatcher, dataStore: wrappedDataStore };
}
