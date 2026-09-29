import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createPrivacyPolicy,
  type AccessDecision,
} from '../privacy';

const SENTINEL = 'PA_HUB_SENTINEL_9f3a';

let fixtureRoot: string;
let vaultRoot: string;
let sourcesRoot: string;
let outsideRoot: string;
let vault2Root: string;
let notePath: string;
let profilePath: string;
let financePath: string;
let paperPath: string;
let secretPath: string;
let profileLinkPath: string;
let outsideLinkPath: string;
let sourcesLinkPath: string;

function policy(
  roots: readonly string[] = [vaultRoot, sourcesRoot],
  excludeGlobs: readonly string[] = []
) {
  return createPrivacyPolicy({ roots, excludeGlobs });
}

function expectReason(
  decision: AccessDecision,
  reason: AccessDecision['reason']
): void {
  expect(decision.reason).toBe(reason);
  expect(decision.allowed).toBe(reason === 'allowed');
}

beforeEach(() => {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-hub-privacy-'));
  vaultRoot = path.join(fixtureRoot, 'vault');
  sourcesRoot = path.join(fixtureRoot, 'sources');
  outsideRoot = path.join(fixtureRoot, 'outside');
  vault2Root = path.join(fixtureRoot, 'vault2');

  fs.mkdirSync(path.join(vaultRoot, 'notes'), { recursive: true });
  fs.mkdirSync(path.join(vaultRoot, 'knowledge', 'me'), { recursive: true });
  fs.mkdirSync(path.join(vaultRoot, 'finance'), { recursive: true });
  fs.mkdirSync(path.join(sourcesRoot, 'topic'), { recursive: true });
  fs.mkdirSync(outsideRoot, { recursive: true });
  fs.mkdirSync(vault2Root, { recursive: true });

  notePath = path.join(vaultRoot, 'notes', 'a.md');
  profilePath = path.join(vaultRoot, 'knowledge', 'me', 'profile.md');
  financePath = path.join(vaultRoot, 'finance', 'ledger.md');
  paperPath = path.join(sourcesRoot, 'topic', 'paper.md');
  secretPath = path.join(outsideRoot, 'secret.md');
  profileLinkPath = path.join(vaultRoot, 'notes', 'link-to-profile.md');
  outsideLinkPath = path.join(vaultRoot, 'notes', 'link-out.md');
  sourcesLinkPath = path.join(vaultRoot, 'notes', 'link-to-sources.md');

  fs.writeFileSync(notePath, 'note');
  fs.writeFileSync(profilePath, SENTINEL);
  fs.writeFileSync(financePath, 'ledger');
  fs.writeFileSync(paperPath, 'paper');
  fs.writeFileSync(secretPath, 'secret');
  fs.writeFileSync(path.join(vault2Root, 'n.md'), 'lookalike');

  fs.symlinkSync('../knowledge/me/profile.md', profileLinkPath);
  fs.symlinkSync('../../outside/secret.md', outsideLinkPath);
  fs.symlinkSync('../../sources/topic/paper.md', sourcesLinkPath);
});

afterEach(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

describe('privacy policy', () => {
  it('test_privacy_policy_allows_note_inside_vault_root', () => {
    const decision = policy().decide(notePath);
    expectReason(decision, 'allowed');
    expect(decision.root).toBe(fs.realpathSync.native(vaultRoot));
    expect(decision.relativePath).toBe('notes/a.md');
  });

  it('test_privacy_policy_allows_note_inside_sources_root', () => {
    const decision = policy().decide(paperPath);
    expectReason(decision, 'allowed');
    expect(decision.root).toBe(fs.realpathSync.native(sourcesRoot));
    expect(decision.relativePath).toBe('topic/paper.md');
  });

  it('test_privacy_policy_allows_nonexistent_note_inside_root', () => {
    const decision = policy().decide(
      path.join(vaultRoot, 'notes', 'new.md')
    );
    expectReason(decision, 'allowed');
    expect(decision.canonicalPath).toMatch(/notes[\\/]new\.md$/);
  });

  it('test_privacy_policy_denies_prefix_lookalike_root', () => {
    expectReason(policy().decide(path.join(vault2Root, 'n.md')), 'outside_roots');
  });

  it('test_privacy_policy_denies_outside_roots', () => {
    expectReason(policy().decide(secretPath), 'outside_roots');
  });

  it('test_privacy_policy_denies_mandatory_profile_literal', () => {
    expectReason(policy().decide(profilePath), 'mandatory_exclusion');
  });

  it('test_privacy_policy_denies_mandatory_profile_nonexistent', () => {
    fs.rmSync(profilePath);
    expectReason(policy().decide(profilePath), 'mandatory_exclusion');
  });

  it('test_privacy_policy_denies_mandatory_profile_case_variant', () => {
    expectReason(
      policy().decide(
        path.join(vaultRoot, 'KNOWLEDGE', 'Me', 'Profile.MD')
      ),
      'mandatory_exclusion'
    );
  });

  it('test_privacy_policy_denies_symlink_to_profile', () => {
    expectReason(policy().decide(profileLinkPath), 'mandatory_exclusion');
  });

  it('test_privacy_policy_denies_hardlink_to_profile', () => {
    const hardLinkPath = path.join(vaultRoot, 'notes', 'hard.md');
    fs.linkSync(profilePath, hardLinkPath);
    expectReason(policy().decide(hardLinkPath), 'mandatory_exclusion');
    expectReason(policy().decide(notePath), 'allowed');
  });

  it('test_privacy_policy_denies_symlink_escaping_root', () => {
    expectReason(policy().decide(outsideLinkPath), 'outside_roots');
  });

  it('test_privacy_policy_cross_root_symlink_resolves_to_target_root', () => {
    const decision = policy().decide(sourcesLinkPath);
    expectReason(decision, 'allowed');
    expect(decision.root).toBe(fs.realpathSync.native(sourcesRoot));
    expect(decision.relativePath).toBe('topic/paper.md');
  });

  it('test_privacy_policy_denies_dot_segments', () => {
    expectReason(
      policy().decide(
        path.join(vaultRoot, 'notes', '..', 'knowledge', 'me', 'profile.md')
      ),
      'mandatory_exclusion'
    );
    expectReason(
      policy().decide(path.join(vaultRoot, '..', 'outside', 'secret.md')),
      'outside_roots'
    );
  });

  it('test_privacy_policy_denies_percent_encoded', () => {
    const first = policy().decide(
      path.join(vaultRoot, 'notes', '%2E%2E', 'knowledge', 'me', 'profile.md')
    );
    const second = policy().decide(
      `${vaultRoot}%2Fknowledge%2Fme%2Fprofile.md`
    );
    expectReason(first, 'encoded_path');
    expectReason(second, 'encoded_path');
    expect(first.canonicalPath).toBeNull();
    expect(second.canonicalPath).toBeNull();
  });

  it('test_privacy_policy_denies_lookalikes', () => {
    expectReason(
      policy().decide(path.join(vaultRoot, 'notes', '․․.md')),
      'lookalike_path'
    );
    expectReason(
      policy().decide(path.join(vaultRoot, 'notes\\a.md')),
      'lookalike_path'
    );
    expectReason(
      policy().decide(path.join(vaultRoot, 'notes', '／a.md')),
      'lookalike_path'
    );
  });

  it('test_privacy_policy_denies_non_string_and_relative', () => {
    expectReason(policy().decide(undefined), 'invalid_input');
    expectReason(policy().decide(42), 'invalid_input');
    expectReason(policy().decide(''), 'invalid_input');
    expectReason(policy().decide('notes/a.md'), 'relative_path');
  });

  it('test_privacy_policy_denies_control_characters', () => {
    for (const input of [
      `${vaultRoot}/notes/a.md\n`,
      `${vaultRoot}/notes/a\tb.md`,
      `${vaultRoot}/notes/\x7fa.md`,
    ]) {
      const decision = policy().decide(input);
      expectReason(decision, 'invalid_input');
      expect(decision.canonicalPath).toBeNull();
    }
  });

  it('test_privacy_policy_empty_globs_cannot_expose_profile', () => {
    expectReason(
      createPrivacyPolicy({ roots: [vaultRoot], excludeGlobs: [] }).decide(
        profilePath
      ),
      'mandatory_exclusion'
    );
    const literalNegation = createPrivacyPolicy({
      roots: [vaultRoot],
      excludeGlobs: ['!knowledge/**'],
    });
    expectReason(literalNegation.decide(profilePath), 'mandatory_exclusion');
    expectReason(literalNegation.decide(notePath), 'allowed');
  });

  it('test_privacy_policy_configured_glob_denies_only_its_matches', () => {
    const financePolicy = policy([vaultRoot], ['finance/**']);
    expectReason(financePolicy.decide(financePath), 'configured_exclusion');
    expectReason(financePolicy.decide(notePath), 'allowed');

    const basenamePolicy = policy([vaultRoot], ['*.md']);
    expectReason(basenamePolicy.decide(notePath), 'configured_exclusion');
  });

  it('test_privacy_policy_purge_evicts_protected_keys_from_synthetic_cache', () => {
    const keys = [notePath, profilePath, profileLinkPath, secretPath, paperPath];
    const cache = new Map(keys.map(key => [key, 'synthetic cache entry']));
    expect(policy().purge(cache.keys())).toEqual([
      profilePath,
      profileLinkPath,
      secretPath,
    ]);
  });

  it('test_privacy_policy_decision_carries_no_content_and_no_sentinel', () => {
    const decision = policy().decide(profilePath);
    expect(JSON.stringify(decision)).not.toContain(SENTINEL);

    fs.chmodSync(profilePath, 0o000);
    try {
      const lockedDecision = policy().decide(profilePath);
      expectReason(lockedDecision, 'mandatory_exclusion');
      expect(JSON.stringify(lockedDecision)).not.toContain(SENTINEL);
    } finally {
      fs.chmodSync(profilePath, 0o600);
    }
  });

  it('test_privacy_policy_version_changes_with_config', () => {
    const base = policy([vaultRoot, sourcesRoot], []);
    const same = policy([vaultRoot, sourcesRoot], []);
    const withGlob = policy([vaultRoot, sourcesRoot], ['finance/**']);
    const withRoot = policy([vaultRoot, sourcesRoot, outsideRoot], []);
    expect(base.version).toBe(same.version);
    expect(base.version).not.toBe(withGlob.version);
    expect(base.version).not.toBe(withRoot.version);

    const missingRoot = createPrivacyPolicy({
      roots: [path.join(fixtureRoot, 'does-not-exist')],
      excludeGlobs: [],
    });
    expectReason(missingRoot.decide(notePath), 'outside_roots');
  });
});

describe('sidebar manifest contract', () => {
  it('test_sidebar_manifest_declares_activitybar_container', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8')
    ) as { contributes: { viewsContainers: { activitybar: Array<{ id: string }> } } };
    expect(
      manifest.contributes.viewsContainers.activitybar.some(
        entry => entry.id === 'pa-hub'
      )
    ).toBe(true);
  });

  it('test_sidebar_manifest_graph_view_first', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8')
    ) as {
      contributes: {
        views: Record<string, Array<{ id: string; type: string }>>;
      };
    };
    const views = manifest.contributes.views['pa-hub'];
    expect(views?.[0]).toMatchObject({ id: 'pa-hub.graph', type: 'webview' });
    expect(views?.slice(1).map(view => view.id)).toEqual([
      'pa-hub.tasks',
      'pa-hub.sources',
      'pa-hub.usage',
      'pa-hub.calendar',
      'pa-hub.history',
    ]);
  });

  it('test_sidebar_manifest_privacy_setting_declared', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8')
    ) as {
      contributes: {
        configuration: {
          properties: Record<string, { type?: string; default?: unknown }>;
        };
      };
    };
    expect(manifest.contributes.configuration.properties[
      'pa-hub.privacy.excludeGlobs'
    ]).toMatchObject({ type: 'array', default: [] });
  });
});
