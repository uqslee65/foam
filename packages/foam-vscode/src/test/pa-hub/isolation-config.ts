import path from 'path';

export interface IsolationProfile {
  readonly name: string;
  readonly userDataDir: string;
  readonly extensionIds: readonly string[];
  readonly workspacePath: string;
  readonly settings: Record<string, unknown>;
}

export function getSyntheticProfile(extensionRoot: string): IsolationProfile {
  return {
    name: 'synthetic',
    userDataDir: path.join(extensionRoot, '.vscode-test-pa-hub'),
    extensionIds: ['lazarus.pa-hub'],
    workspacePath: path.join(extensionRoot, '.test-workspace'),
    settings: {
      'workbench.localHistory.enabled': false,
      'pa-hub.privacy.excludeGlobs': ['**/knowledge/me/profile.md'],
      'pa-hub.edit.linkReferenceDefinitions': 'off',
    },
  };
}

export function getCoexistenceProfile(extensionRoot: string): IsolationProfile {
  return {
    name: 'coexistence',
    userDataDir: path.join(extensionRoot, '.vscode-test-coexistence'),
    extensionIds: ['lazarus.pa-hub', 'foam.foam-vscode'],
    workspacePath: path.join(extensionRoot, '.test-workspace'),
    settings: {
      'workbench.localHistory.enabled': false,
      'pa-hub.privacy.excludeGlobs': ['**/knowledge/me/profile.md'],
      'pa-hub.edit.linkReferenceDefinitions': 'off',
    },
  };
}

export function getLaunchArgs(profile: IsolationProfile): readonly string[] {
  return [
    profile.workspacePath,
    `--user-data-dir=${profile.userDataDir}`,
    '--disable-gpu',
    '--disable-extensions',
    '--disable-workspace-trust',
    '--disable-updates',
  ];
}
