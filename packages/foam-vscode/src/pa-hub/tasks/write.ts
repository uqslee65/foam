import { selectNewestDailyFile } from './snapshot';
import type { TaskRecord, TaskSnapshot } from './snapshot';

export type ToggleResult =
  | { ok: true; task: TaskRecord }
  | { ok: false; reason: 'unknown_identity' | 'ambiguous_id' };

export type MutationResult =
  | { ok: true; content: string }
  | { ok: false; reason: 'stale_line' };

export function resolveToggleTarget(
  snapshot: TaskSnapshot,
  identity: string
): ToggleResult {
  const task = snapshot.tasks.find(candidate => candidate.identity === identity);
  if (task === undefined) {
    return { ok: false, reason: 'unknown_identity' };
  }

  if (task.ambiguousId) {
    return { ok: false, reason: 'ambiguous_id' };
  }

  return { ok: true, task };
}

export function applyCheckboxToggle(
  content: string,
  task: TaskRecord,
  checked: boolean
): MutationResult {
  const lines = content.split('\n');
  if (lines[task.lineIndex] !== task.raw) {
    return { ok: false, reason: 'stale_line' };
  }

  const line = lines[task.lineIndex];
  lines[task.lineIndex] =
    line.slice(0, 3) + (checked ? 'x' : ' ') + line.slice(4);
  return { ok: true, content: lines.join('\n') };
}

export type WriteReason =
  | 'unknown_identity'
  | 'ambiguous_id'
  | 'latest_changed'
  | 'stale_revision'
  | 'stale_line'
  | 'no_valid_file'
  | 'io_error';

export type WriteResult =
  | { ok: true; revision: string }
  | { ok: false; reason: WriteReason };

export interface TaskWriteFs {
  listDir(dir: string): Promise<string[]>;
  readFile(path: string): Promise<string | null>;
  stat(path: string): Promise<{ revision: string; mode: number } | null>;
  writeFile(path: string, content: string, mode: number): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

export interface TaskWriter {
  toggle(
    dir: string,
    snapshot: TaskSnapshot,
    identity: string,
    checked: boolean
  ): Promise<WriteResult>;
  move(
    dir: string,
    snapshot: TaskSnapshot,
    identity: string,
    direction: 'up' | 'down'
  ): Promise<WriteResult>;
  setQuadrant(
    dir: string,
    snapshot: TaskSnapshot,
    identity: string,
    quadrant: string
  ): Promise<WriteResult>;
}

export function applyMove(
  content: string,
  task: TaskRecord,
  direction: 'up' | 'down'
): MutationResult {
  const lines = content.split('\n');
  if (lines[task.lineIndex] !== task.raw) {
    return { ok: false, reason: 'stale_line' };
  }
  const target = direction === 'up' ? task.lineIndex - 1 : task.lineIndex + 1;
  if (target < 0 || target >= lines.length || !lines[target].startsWith('- [')) {
    return { ok: false, reason: 'stale_line' };
  }
  [lines[task.lineIndex], lines[target]] = [lines[target], lines[task.lineIndex]];
  return { ok: true, content: lines.join('\n') };
}

export function applyQuadrantChange(
  content: string,
  task: TaskRecord,
  quadrant: string
): MutationResult {
  const lines = content.split('\n');
  if (lines[task.lineIndex] !== task.raw) {
    return { ok: false, reason: 'stale_line' };
  }
  const line = lines[task.lineIndex];
  const m = line.match(/<!--\s*(.*?)\s*-->/);
  if (m) {
    const comment = m[1].match(/quadrant:\S+/)
      ? m[1].replace(/quadrant:\S+/, `quadrant:${quadrant}`)
      : `${m[1]} quadrant:${quadrant}`;
    lines[task.lineIndex] = line.replace(/<!--\s*.*?\s*-->/, `<!-- ${comment} -->`);
  } else {
    lines[task.lineIndex] = `${line.trimEnd()} <!-- quadrant:${quadrant} -->`;
  }
  return { ok: true, content: lines.join('\n') };
}

export function createTaskWriter(fs: TaskWriteFs): TaskWriter {
  let chain: Promise<WriteResult | void> = Promise.resolve();

  async function doMutate(
    dir: string,
    snapshot: TaskSnapshot,
    identity: string,
    mutate: (content: string, task: TaskRecord) => MutationResult
  ): Promise<WriteResult> {
    try {
      const target = resolveToggleTarget(snapshot, identity);
      if (target.ok === false) {
        return { ok: false, reason: target.reason };
      }
      const filenames = await fs.listDir(dir);
      const filename = selectNewestDailyFile(filenames);
      if (filename === null) return { ok: false, reason: 'no_valid_file' };
      if (filename !== snapshot.filename) return { ok: false, reason: 'latest_changed' };

      const targetPath = dir + '/' + filename;
      const firstStat = await fs.stat(targetPath);
      if (firstStat === null) return { ok: false, reason: 'io_error' };
      if (firstStat.revision !== snapshot.revision) return { ok: false, reason: 'stale_revision' };

      const content = await fs.readFile(targetPath);
      if (content === null) return { ok: false, reason: 'io_error' };

      const mutation = mutate(content, target.task);
      if (!mutation.ok) return { ok: false, reason: 'stale_line' };

      const tmpPath = dir + '/.' + filename + '.tmp';
      await fs.writeFile(tmpPath, mutation.content, firstStat.mode);
      const secondStat = await fs.stat(targetPath);
      if (secondStat === null || secondStat.revision !== firstStat.revision) {
        return { ok: false, reason: 'stale_revision' };
      }
      await fs.rename(tmpPath, targetPath);
      return { ok: true, revision: secondStat.revision };
    } catch {
      return { ok: false, reason: 'io_error' };
    }
  }

  async function doToggle(
    dir: string,
    snapshot: TaskSnapshot,
    identity: string,
    checked: boolean
  ): Promise<WriteResult> {
    try {
      const target = resolveToggleTarget(snapshot, identity);
      if (target.ok === false) {
        return { ok: false, reason: target.reason };
      }

      const filenames = await fs.listDir(dir);
      const filename = selectNewestDailyFile(filenames);
      if (filename === null) {
        return { ok: false, reason: 'no_valid_file' };
      }

      if (filename !== snapshot.filename) {
        return { ok: false, reason: 'latest_changed' };
      }

      const targetPath = dir + '/' + filename;
      const firstStat = await fs.stat(targetPath);
      if (firstStat === null) {
        return { ok: false, reason: 'io_error' };
      }

      if (firstStat.revision !== snapshot.revision) {
        return { ok: false, reason: 'stale_revision' };
      }

      const content = await fs.readFile(targetPath);
      if (content === null) {
        return { ok: false, reason: 'io_error' };
      }

      const mutation = applyCheckboxToggle(content, target.task, checked);
      if (!mutation.ok) {
        return { ok: false, reason: 'stale_line' };
      }

      const tmpPath = dir + '/.' + filename + '.tmp';
      await fs.writeFile(tmpPath, mutation.content, firstStat.mode);

      const secondStat = await fs.stat(targetPath);
      if (
        secondStat === null ||
        secondStat.revision !== firstStat.revision
      ) {
        return { ok: false, reason: 'stale_revision' };
      }

      await fs.rename(tmpPath, targetPath);
      return { ok: true, revision: secondStat.revision };
    } catch {
      return { ok: false, reason: 'io_error' };
    }
  }

  function enqueue(fn: () => Promise<WriteResult>): Promise<WriteResult> {
    const next = chain
      .then(fn)
      .catch(() => ({ ok: false, reason: 'io_error' } as const));
    chain = next;
    return next;
  }

  return {
    toggle(dir, snapshot, identity, checked) {
      return enqueue(() => doToggle(dir, snapshot, identity, checked));
    },
    move(dir, snapshot, identity, direction) {
      return enqueue(() =>
        doMutate(dir, snapshot, identity, (c, t) => applyMove(c, t, direction))
      );
    },
    setQuadrant(dir, snapshot, identity, quadrant) {
      return enqueue(() =>
        doMutate(dir, snapshot, identity, (c, t) => applyQuadrantChange(c, t, quadrant))
      );
    },
  };
}
