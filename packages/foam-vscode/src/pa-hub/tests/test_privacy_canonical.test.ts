import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createPrivacyPolicy } from '../privacy';

describe('privacy canonical path exclusions', () => {
  it('test_privacy_canonical_excludes_symlink_dot_segment_path', () => {
    const fixtureRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'pa-hub-privacy-canonical-')
    );
    const nestedRoot = path.join(fixtureRoot, 'nested');
    const targetDirectory = path.join(nestedRoot, 'target');
    const secretPath = path.join(nestedRoot, 'secret.md');
    const linkPath = path.join(fixtureRoot, 'link-dir');

    try {
      fs.mkdirSync(targetDirectory, { recursive: true });
      fs.writeFileSync(secretPath, 'secret');
      fs.symlinkSync(path.join('nested', 'target'), linkPath, 'dir');

      const policy = createPrivacyPolicy({
        roots: [fixtureRoot],
        excludeGlobs: ['nested/**'],
      });
      const nonCanonicalPath = `${fixtureRoot}${path.sep}link-dir${path.sep}..${path.sep}secret.md`;
      const decision = policy.decide(nonCanonicalPath);

      expect(decision.reason).toBe('configured_exclusion');
      expect(decision.relativePath).toBe('nested/secret.md');
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
