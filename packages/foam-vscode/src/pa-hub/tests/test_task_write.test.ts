import { describe, expect, it } from 'vitest';
import {
  applyCheckboxToggle,
  createTaskWriter,
  resolveToggleTarget,
} from '../../pa-hub/tasks/write';
import type { TaskWriteFs } from '../../pa-hub/tasks/write';
import { createSnapshot } from '../../pa-hub/tasks/snapshot';
import type { TaskRecord, TaskSnapshot } from '../../pa-hub/tasks/snapshot';

function firstTask(snapshot: TaskSnapshot): TaskRecord {
  const task = snapshot.tasks[0];
  if (task === undefined) {
    throw new Error('expected a task');
  }
  return task;
}

describe('task write', () => {
  it('test_task_write_toggle_on', () => {
    const content = '# Daily\n- [ ] First task\n- [x] Other task\ntail';
    const snapshot = createSnapshot('2026-09-23.md', 'rev-1', content);
    const result = applyCheckboxToggle(content, firstTask(snapshot), true);

    expect(result).toEqual({
      ok: true,
      content: '# Daily\n- [x] First task\n- [x] Other task\ntail',
    });
  });

  it('test_task_write_toggle_off', () => {
    const content = '- [x] Finished task\n- [ ] Other task';
    const snapshot = createSnapshot('2026-09-23.md', 'rev-1', content);
    const result = applyCheckboxToggle(content, firstTask(snapshot), false);

    expect(result).toEqual({
      ok: true,
      content: '- [ ] Finished task\n- [ ] Other task',
    });
  });

  it('test_task_write_toggle_off_uppercase', () => {
    const content = '- [X] Finished task\n- [ ] Other task';
    const snapshot = createSnapshot('2026-09-23.md', 'rev-1', content);
    const result = applyCheckboxToggle(content, firstTask(snapshot), false);

    expect(result).toEqual({
      ok: true,
      content: '- [ ] Finished task\n- [ ] Other task',
    });
  });

  it('test_task_write_stale_line', () => {
    const original = '- [ ] Original task\n- [ ] Other task';
    const snapshot = createSnapshot('2026-09-23.md', 'rev-1', original);
    const result = applyCheckboxToggle(
      '- [ ] Changed task\n- [ ] Other task',
      firstTask(snapshot),
      true
    );

    expect(result).toEqual({ ok: false, reason: 'stale_line' });
  });

  it('test_task_write_ambiguous_refused', () => {
    const snapshot = createSnapshot(
      '2026-09-23.md',
      'rev-1',
      '- [ ] First task <!-- id:t-dup -->\n- [x] Second task <!-- id:t-dup -->'
    );

    expect(resolveToggleTarget(snapshot, 't-dup')).toEqual({
      ok: false,
      reason: 'ambiguous_id',
    });
  });

  it('test_task_write_unknown_identity', () => {
    const snapshot = createSnapshot(
      '2026-09-23.md',
      'rev-1',
      '- [ ] Known task <!-- id:t-known -->'
    );

    expect(resolveToggleTarget(snapshot, 't-missing')).toEqual({
      ok: false,
      reason: 'unknown_identity',
    });
  });

  it('test_task_write_preserves_crlf', () => {
    const content = 'heading\r\n- [ ] Target task\r\ntrailing\r\n';
    const snapshot = createSnapshot('2026-09-23.md', 'rev-1', content);
    const result = applyCheckboxToggle(content, firstTask(snapshot), true);

    expect(result).toEqual({
      ok: true,
      content: 'heading\r\n- [x] Target task\r\ntrailing\r\n',
    });
  });

  it('test_task_write_only_one_line_differs', () => {
    const content = [
      'heading',
      '- [ ] First task',
      '- [ ] Target task',
      'trailing',
    ].join('\n');
    const snapshot = createSnapshot('2026-09-23.md', 'rev-1', content);
    const task = snapshot.tasks[1];
    if (task === undefined) {
      throw new Error('expected a second task');
    }

    const result = applyCheckboxToggle(content, task, true);
    if (!result.ok) {
      throw new Error('expected a successful mutation');
    }

    const beforeLines = content.split('\n');
    const afterLines = result.content.split('\n');
    expect(afterLines[task.lineIndex]).toBe('- [x] Target task');
    const unchangedAfterLines = beforeLines
      .map((_, lineIndex) => afterLines[lineIndex])
      .filter((_, lineIndex) => lineIndex !== task.lineIndex);
    expect(unchangedAfterLines).toEqual(
      beforeLines.filter((_, lineIndex) => lineIndex !== task.lineIndex)
    );
  });
});

function createMockFs(options: {
  files?: Record<
    string,
    { content: string; revision: string; mode: number }
  >;
  failOn?: { method: string; path?: string };
  revisionBumpAfterWrite?: boolean;
} = {}): TaskWriteFs & {
  calls: Array<{ method: string; args: unknown[] }>;
} {
  const files = new Map(Object.entries(options.files ?? {}));
  const calls: Array<{ method: string; args: unknown[] }> = [];
  let wroteFile = false;

  function record(method: string, ...args: unknown[]): void {
    calls.push({ method, args });
  }

  function failIfConfigured(method: string, path?: string): void {
    if (options.failOn?.method !== method) {
      return;
    }
    if (
      options.failOn.path !== undefined &&
      options.failOn.path !== path
    ) {
      return;
    }
    throw new Error(`mock ${method} failure`);
  }

  return {
    calls,
    async listDir(dir: string): Promise<string[]> {
      record('listDir', dir);
      failIfConfigured('listDir', dir);
      const prefix = dir + '/';
      return [...files.keys()]
        .filter(path => path.startsWith(prefix))
        .map(path => path.slice(prefix.length))
        .filter(filename => filename.length > 0 && !filename.includes('/'));
    },
    async readFile(path: string): Promise<string | null> {
      record('readFile', path);
      failIfConfigured('readFile', path);
      return files.get(path)?.content ?? null;
    },
    async stat(
      path: string
    ): Promise<{ revision: string; mode: number } | null> {
      record('stat', path);
      failIfConfigured('stat', path);
      const file = files.get(path);
      if (file === undefined) {
        return null;
      }

      return {
        revision:
          options.revisionBumpAfterWrite && wroteFile
            ? `${file.revision}-bumped`
            : file.revision,
        mode: file.mode,
      };
    },
    async writeFile(
      path: string,
      content: string,
      mode: number
    ): Promise<void> {
      record('writeFile', path, content, mode);
      failIfConfigured('writeFile', path);
      files.set(path, { content, revision: 'tmp-revision', mode });
      wroteFile = true;
    },
    async rename(from: string, to: string): Promise<void> {
      record('rename', from, to);
      failIfConfigured('rename', from);
      const file = files.get(from);
      if (file === undefined) {
        throw new Error('mock rename source missing');
      }
      const target = files.get(to);
      files.set(to, {
        ...file,
        revision: target?.revision ?? file.revision,
      });
      files.delete(from);
    },
  };
}

describe('async task writer', () => {
  const dir = 'daily';
  const filename = '2026-09-23.md';
  const targetPath = `${dir}/${filename}`;
  const content = '- [ ] First task <!-- id:t-first -->\n- [x] Other task';

  function makeSnapshot() {
    return createSnapshot(filename, 'rev-1', content);
  }

  function makeFs(
    options: Parameters<typeof createMockFs>[0] = {}
  ): ReturnType<typeof createMockFs> {
    return createMockFs({
      ...options,
      files: {
        [targetPath]: { content, revision: 'rev-1', mode: 0o640 },
        ...options.files,
      },
    });
  }

  it('test_task_write_writer_writes_to_tmp', async () => {
    const fs = makeFs();
    const result = await createTaskWriter(fs).toggle(
      dir,
      makeSnapshot(),
      't-first',
      true
    );

    expect(result).toEqual({ ok: true, revision: 'rev-1' });
    const writeCalls = fs.calls.filter(call => call.method === 'writeFile');
    expect(writeCalls).toHaveLength(1);
    expect(writeCalls[0]?.args[0]).toBe(`${dir}/.${filename}.tmp`);
    expect(writeCalls.some(call => call.args[0] === targetPath)).toBe(false);
  });

  it('test_task_write_writer_rename_follows_write', async () => {
    const fs = makeFs();
    await createTaskWriter(fs).toggle(dir, makeSnapshot(), 't-first', true);

    const writeIndex = fs.calls.findIndex(call => call.method === 'writeFile');
    const renameIndex = fs.calls.findIndex(call => call.method === 'rename');
    expect(renameIndex).toBeGreaterThan(writeIndex);
    expect(fs.calls[renameIndex]?.args).toEqual([
      `${dir}/.${filename}.tmp`,
      targetPath,
    ]);
  });

  it('test_task_write_writer_mode_passed', async () => {
    const fs = makeFs();
    await createTaskWriter(fs).toggle(dir, makeSnapshot(), 't-first', true);

    const writeCall = fs.calls.find(call => call.method === 'writeFile');
    expect(writeCall?.args[2]).toBe(0o640);
  });

  it('test_task_write_writer_stale_revision_no_rename', async () => {
    const fs = makeFs({ revisionBumpAfterWrite: true });
    const result = await createTaskWriter(fs).toggle(
      dir,
      makeSnapshot(),
      't-first',
      true
    );

    expect(result).toEqual({ ok: false, reason: 'stale_revision' });
    expect(fs.calls.some(call => call.method === 'rename')).toBe(false);
  });

  it('test_task_write_writer_latest_changed', async () => {
    const fs = makeFs({
      files: {
        [`${dir}/2026-09-24.md`]: {
          content,
          revision: 'rev-2',
          mode: 0o640,
        },
      },
    });
    const result = await createTaskWriter(fs).toggle(
      dir,
      makeSnapshot(),
      't-first',
      true
    );

    expect(result).toEqual({ ok: false, reason: 'latest_changed' });
    expect(fs.calls.some(call => call.method === 'writeFile')).toBe(false);
    expect(fs.calls.some(call => call.method === 'rename')).toBe(false);
  });

  it('test_task_write_writer_readfile_null', async () => {
    const fs = makeFs();
    fs.readFile = async path => {
      fs.calls.push({ method: 'readFile', args: [path] });
      return null;
    };

    const result = await createTaskWriter(fs).toggle(
      dir,
      makeSnapshot(),
      't-first',
      true
    );

    expect(result).toEqual({ ok: false, reason: 'io_error' });
  });

  it('test_task_write_writer_unknown_identity', async () => {
    const fs = makeFs();
    const result = await createTaskWriter(fs).toggle(
      dir,
      makeSnapshot(),
      't-missing',
      true
    );

    expect(result).toEqual({ ok: false, reason: 'unknown_identity' });
    expect(fs.calls).toHaveLength(0);
  });

  it('test_task_write_writer_serializes', async () => {
    const fs = makeFs();
    const writer = createTaskWriter(fs);
    const first = writer.toggle(dir, makeSnapshot(), 't-first', true);
    const second = writer.toggle(dir, makeSnapshot(), 't-first', false);

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toEqual({ ok: true, revision: 'rev-1' });
    expect(secondResult).toEqual({ ok: false, reason: 'stale_line' });

    const renameIndex = fs.calls.findIndex(call => call.method === 'rename');
    const readIndexes = fs.calls
      .map((call, index) => (call.method === 'readFile' ? index : -1))
      .filter(index => index !== -1);
    expect(readIndexes).toHaveLength(2);
    expect(readIndexes[1]).toBeGreaterThan(renameIndex);
  });
});
