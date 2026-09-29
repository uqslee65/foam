import * as fs from 'node:fs';
import * as path from 'node:path';

export const MANDATORY_EXCLUSIONS: readonly string[] = [
  'knowledge/me/profile.md',
];

export interface PrivacyConfig {
  roots: readonly string[];
  excludeGlobs: readonly string[];
}

export type DenyReason =
  | 'invalid_input'
  | 'encoded_path'
  | 'lookalike_path'
  | 'relative_path'
  | 'outside_roots'
  | 'mandatory_exclusion'
  | 'configured_exclusion';

export interface AccessDecision {
  allowed: boolean;
  reason: 'allowed' | DenyReason;
  input: string | null;
  canonicalPath: string | null;
  root: string | null;
  relativePath: string | null;
}

export interface PrivacyPolicy {
  readonly version: string;
  decide(input: unknown): AccessDecision;
  isAllowed(input: unknown): boolean;
  purge<K extends string>(keys: Iterable<K>): K[];
}

interface RootEntry {
  readonly raw: string;
  readonly canonical: string;
}

interface FileIdentity {
  readonly dev: number;
  readonly ino: number;
}

function asPosix(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

function isWithin(root: string, candidate: string): boolean {
  if (root === candidate) {
    return true;
  }

  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return candidate.startsWith(prefix);
}

function relativeTo(root: string, candidate: string): string | null {
  const normalisedRoot = path.normalize(root);
  if (!isWithin(normalisedRoot, candidate)) {
    return null;
  }
  return asPosix(path.relative(normalisedRoot, candidate));
}

function canonicaliseRoots(roots: readonly string[]): RootEntry[] {
  if (!Array.isArray(roots)) {
    return [];
  }

  return roots.flatMap(raw => {
    if (typeof raw !== 'string' || raw.length === 0) {
      return [];
    }

    try {
      const canonical = fs.realpathSync.native(raw);
      return fs.statSync(canonical).isDirectory()
        ? [{ raw, canonical }]
        : [];
    } catch {
      return [];
    }
  });
}

function fileIdentity(filePath: string): FileIdentity | null {
  try {
    const stats = fs.statSync(filePath);
    return stats.isFile() ? { dev: stats.dev, ino: stats.ino } : null;
  } catch {
    return null;
  }
}

function resolveCanonicalPath(normalisedPath: string): string | null {
  try {
    if (fs.existsSync(normalisedPath)) {
      return fs.realpathSync.native(normalisedPath);
    }

    let cursor = normalisedPath;
    const remainder: string[] = [];
    while (!fs.existsSync(cursor)) {
      const parent = path.dirname(cursor);
      if (parent === cursor) {
        return null;
      }
      remainder.unshift(path.basename(cursor));
      cursor = parent;
    }

    let canonical = fs.realpathSync.native(cursor);
    for (const part of remainder) {
      canonical = path.join(canonical, part);
    }
    return canonical;
  } catch {
    return null;
  }
}

function mandatoryMatch(relativePath: string | null): boolean {
  if (relativePath === null) {
    return false;
  }

  const comparable = relativePath.toLowerCase();
  return MANDATORY_EXCLUSIONS.some(
    exclusion => exclusion.toLowerCase() === comparable
  );
}

function globRegex(glob: string): RegExp {
  let expression = '';
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    if (character === '*' && glob[index + 1] === '*') {
      index += 1;
      if (glob[index + 1] === '/') {
        expression += '(?:.*/)?';
        index += 1;
      } else {
        expression += '.*';
      }
    } else if (character === '*') {
      expression += '[^/]*';
    } else if (character === '?') {
      expression += '[^/]';
    } else {
      expression += /[\\^$.*+?()[\]{}|]/.test(character)
        ? `\\${character}`
        : character;
    }
  }
  return new RegExp(`^${expression}$`, 'i');
}

function matchesConfiguredGlob(
  relativePath: string,
  glob: string,
  matcher: RegExp
): boolean {
  const target = glob.includes('/')
    ? relativePath
    : relativePath.slice(relativePath.lastIndexOf('/') + 1);
  return matcher.test(target);
}

function makeDecision(
  input: string | null,
  reason: AccessDecision['reason'],
  canonicalPath: string | null = null,
  root: string | null = null,
  relativePath: string | null = null
): AccessDecision {
  return {
    allowed: reason === 'allowed',
    reason,
    input,
    canonicalPath,
    root,
    relativePath,
  };
}

export function createPrivacyPolicy(config: PrivacyConfig): PrivacyPolicy {
  const roots = canonicaliseRoots(config.roots);
  const configuredGlobs = Array.isArray(config.excludeGlobs)
    ? config.excludeGlobs.filter(glob => typeof glob === 'string')
    : [];
  const configuredMatchers = configuredGlobs.map(glob => ({
    glob,
    matcher: globRegex(glob),
  }));
  const mandatoryReferencePaths = roots.flatMap(entry =>
    MANDATORY_EXCLUSIONS.map(exclusion =>
      path.join(entry.canonical, exclusion)
    )
  );
  const cachedMandatoryReferences = mandatoryReferencePaths.map(fileIdentity);
  const cachedCandidateIdentities = new Map<string, FileIdentity | null>();
  const version = `privacy-v1:${JSON.stringify({
    roots: roots.map(entry => entry.canonical),
    exclusions: [...MANDATORY_EXCLUSIONS, ...configuredGlobs],
  })}`;

  function decide(input: unknown): AccessDecision {
    const stringInput = typeof input === 'string' ? input : null;
    if (
      typeof input !== 'string' ||
      input.length === 0 ||
      /[\u0000-\u001F\u007F]/u.test(input)
    ) {
      return makeDecision(stringInput, 'invalid_input');
    }
    if (input.includes('%')) {
      return makeDecision(input, 'encoded_path');
    }
    if (
      (path.sep !== '\\' && input.includes('\\')) ||
      /[․․‥…．．／∕⁄]/u.test(input)
    ) {
      return makeDecision(input, 'lookalike_path');
    }
    if (!path.isAbsolute(input)) {
      return makeDecision(input, 'relative_path');
    }

    const normalisedInput = path.normalize(input);
    const canonicalPath = resolveCanonicalPath(input);
    if (canonicalPath === null) {
      return makeDecision(input, 'outside_roots');
    }

    const winningRoot = roots
      .filter(entry => isWithin(entry.canonical, canonicalPath))
      .sort((left, right) => right.canonical.length - left.canonical.length)[0];
    if (winningRoot === undefined) {
      return makeDecision(input, 'outside_roots', canonicalPath);
    }

    const relativePath = relativeTo(winningRoot.canonical, canonicalPath);
    if (relativePath === null) {
      return makeDecision(input, 'outside_roots', canonicalPath);
    }

    const inputMatchesMandatory = roots.some(entry =>
      [entry.raw, entry.canonical].some(root =>
        mandatoryMatch(relativeTo(root, normalisedInput))
      )
    );
    if (mandatoryMatch(relativePath) || inputMatchesMandatory) {
      return makeDecision(
        input,
        'mandatory_exclusion',
        canonicalPath,
        winningRoot.canonical,
        relativePath
      );
    }

    let candidateIdentity: FileIdentity | null;
    if (cachedCandidateIdentities.has(canonicalPath)) {
      candidateIdentity = cachedCandidateIdentities.get(canonicalPath) ?? null;
    } else {
      candidateIdentity = fileIdentity(canonicalPath);
      cachedCandidateIdentities.set(canonicalPath, candidateIdentity);
    }
    if (
      candidateIdentity !== null &&
      cachedMandatoryReferences.some(
        reference =>
          reference !== null &&
          reference.dev === candidateIdentity.dev &&
          reference.ino === candidateIdentity.ino
      )
    ) {
      return makeDecision(
        input,
        'mandatory_exclusion',
        canonicalPath,
        winningRoot.canonical,
        relativePath
      );
    }

    if (
      configuredMatchers.some(({ glob, matcher }) =>
        glob.length > 0 && matchesConfiguredGlob(relativePath, glob, matcher)
      )
    ) {
      return makeDecision(
        input,
        'configured_exclusion',
        canonicalPath,
        winningRoot.canonical,
        relativePath
      );
    }

    return makeDecision(
      input,
      'allowed',
      canonicalPath,
      winningRoot.canonical,
      relativePath
    );
  }

  return {
    version,
    decide,
    isAllowed: input => decide(input).allowed,
    purge: <K extends string>(keys: Iterable<K>): K[] => {
      const denied: K[] = [];
      for (const key of keys) {
        if (!decide(key).allowed) {
          denied.push(key);
        }
      }
      return denied;
    },
  };
}
