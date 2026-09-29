import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const platform = vi.hoisted(() => ({ sep: '/' }));

vi.mock('node:path', async importOriginal => {
  const actual = await importOriginal<typeof import('node:path')>();
  return Object.defineProperty({ ...actual }, 'sep', {
    configurable: true,
    enumerable: true,
    get: () => platform.sep,
  });
});

import { createPrivacyPolicy } from '../privacy';

interface Fixture {
  readonly root: string;
  readonly windowsStylePath: string;
  readonly cleanup: () => void;
}

function createFixture(): Fixture {
  const fixtureRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'pa-hub-privacy-windows-')
  );
  const root = path.join(fixtureRoot, 'workspace');
  const windowsStylePath = `${root}\\notes\\windows.md`;

  fs.mkdirSync(root);
  fs.writeFileSync(windowsStylePath, 'note');

  return {
    root,
    windowsStylePath,
    cleanup: () => fs.rmSync(fixtureRoot, { recursive: true, force: true }),
  };
}

afterEach(() => {
  platform.sep = '/';
});

describe('privacy policy platform-specific path separators', () => {
  it('test_privacy_windows_accepts_backslash_paths_on_windows', () => {
    platform.sep = '\\';
    const fixture = createFixture();

    try {
      const decision = createPrivacyPolicy({
        roots: [fixture.root],
        excludeGlobs: [],
      }).decide(fixture.windowsStylePath);

      expect(decision.allowed).toBe(true);
      expect(decision.reason).toBe('allowed');
    } finally {
      fixture.cleanup();
    }
  });

  it('test_privacy_windows_rejects_backslash_paths_on_posix', () => {
    platform.sep = '/';
    const fixture = createFixture();

    try {
      const decision = createPrivacyPolicy({
        roots: [fixture.root],
        excludeGlobs: [],
      }).decide(fixture.windowsStylePath);

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe('lookalike_path');
    } finally {
      fixture.cleanup();
    }
  });
});
