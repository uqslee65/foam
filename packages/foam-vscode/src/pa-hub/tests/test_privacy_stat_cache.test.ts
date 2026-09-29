import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createPrivacyPolicy } from '../privacy';

const statSyncMock = vi.hoisted(() => ({
  fn: vi.fn(),
}));

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  statSyncMock.fn = vi.fn(actual.statSync);
  return { ...actual, statSync: statSyncMock.fn };
});

describe('privacy policy mandatory reference stat cache', () => {
  let fixtureRoot: string | undefined;

  afterEach(() => {
    if (fixtureRoot !== undefined) {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
      fixtureRoot = undefined;
    }
    vi.restoreAllMocks();
  });

  it('test_privacy_stat_cache_stats_mandatory_path_only_during_init', () => {
    fixtureRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'pa-hub-privacy-stat-cache-')
    );
    const profilePath = path.join(
      fixtureRoot,
      'knowledge',
      'me',
      'profile.md'
    );
    const canonicalProfilePath = path.join(
      fs.realpathSync.native(fixtureRoot),
      'knowledge',
      'me',
      'profile.md'
    );
    const notePath = path.join(fixtureRoot, 'notes', 'note.md');
    fs.mkdirSync(path.dirname(profilePath), { recursive: true });
    fs.mkdirSync(path.dirname(notePath), { recursive: true });
    fs.writeFileSync(profilePath, 'profile');
    fs.writeFileSync(notePath, 'note');

    const policy = createPrivacyPolicy({
      roots: [fixtureRoot],
      excludeGlobs: [],
    });

    const mandatoryPathStatsAfterInit = statSyncMock.fn.mock.calls.filter(
      ([filePath]) => String(filePath) === canonicalProfilePath
    ).length;
    expect(mandatoryPathStatsAfterInit).toBe(1);

    policy.decide(notePath);
    policy.decide(notePath);

    const mandatoryPathStatsAfterDecisions = statSyncMock.fn.mock.calls.filter(
      ([filePath]) => String(filePath) === canonicalProfilePath
    ).length;
    expect(mandatoryPathStatsAfterDecisions).toBe(1);
  });

  it('test_privacy_stat_cache_candidate_path_statted_once_across_repeated_decide', () => {
    fixtureRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'pa-hub-privacy-stat-cache-candidate-')
    );
    const notePath = path.join(fixtureRoot, 'notes', 'note.md');
    fs.mkdirSync(path.dirname(notePath), { recursive: true });
    fs.writeFileSync(notePath, 'note');

    const canonicalNotePath = path.join(
      fs.realpathSync.native(fixtureRoot),
      'notes',
      'note.md'
    );

    const policy = createPrivacyPolicy({
      roots: [fixtureRoot],
      excludeGlobs: [],
    });

    statSyncMock.fn.mockClear();

    policy.decide(notePath);
    policy.decide(notePath);
    policy.decide(notePath);

    const candidateStatCalls = statSyncMock.fn.mock.calls.filter(
      ([filePath]) => String(filePath) === canonicalNotePath
    ).length;
    expect(candidateStatCalls).toBe(1);
  });
});
