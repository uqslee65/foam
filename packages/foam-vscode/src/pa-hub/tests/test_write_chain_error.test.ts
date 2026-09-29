import { describe, expect, it } from 'vitest';
import { createTaskWriter } from '../../pa-hub/tasks/write';
import type { TaskWriteFs } from '../../pa-hub/tasks/write';
import { createSnapshot } from '../../pa-hub/tasks/snapshot';

describe('task writer error chain', () => {
  it('test_write_chain_error_stops_after_a_failed_atomic_write', async () => {
    const dir = 'daily';
    const filename = '2026-09-29.md';
    const targetPath = `${dir}/${filename}`;
    const tmpPath = `${dir}/.${filename}.tmp`;
    const content = '- [ ] First task <!-- id:t-first -->';
    const files = new Map([
      [targetPath, { content, revision: 'rev-1', mode: 0o640 }],
    ]);
    const calls: string[] = [];
    let renameAttempts = 0;

    const fs: TaskWriteFs & {
      unlink(path: string): Promise<void>;
    } = {
      async listDir(path) {
        calls.push(`listDir:${path}`);
        return [...files.keys()].map(filePath =>
          filePath.slice(path.length + 1)
        );
      },
      async readFile(path) {
        calls.push(`readFile:${path}`);
        return files.get(path)?.content ?? null;
      },
      async stat(path) {
        calls.push(`stat:${path}`);
        const file = files.get(path);
        return file === undefined
          ? null
          : { revision: file.revision, mode: file.mode };
      },
      async writeFile(path, fileContent, mode) {
        calls.push(`writeFile:${path}`);
        files.set(path, {
          content: fileContent,
          revision: 'tmp-revision',
          mode,
        });
      },
      async rename(from, to) {
        calls.push(`rename:${from}->${to}`);
        renameAttempts += 1;
        if (renameAttempts === 1) {
          throw new Error('rename failed');
        }
        const file = files.get(from);
        if (file === undefined) {
          throw new Error('rename source missing');
        }
        files.set(to, file);
        files.delete(from);
      },
      async unlink(path) {
        calls.push(`unlink:${path}`);
        files.delete(path);
      },
    };

    const snapshot = createSnapshot(filename, 'rev-1', content);
    const writer = createTaskWriter(fs);
    const first = writer.toggle(dir, snapshot, 't-first', true);
    const second = writer.toggle(dir, snapshot, 't-first', false);

    await expect(first).rejects.toThrow('rename failed');
    await expect(second).rejects.toThrow('rename failed');

    expect(calls.filter(call => call.startsWith('readFile:'))).toHaveLength(1);
    expect(calls.filter(call => call.startsWith('writeFile:'))).toHaveLength(1);
    expect(calls).toContain(`unlink:${tmpPath}`);
    expect(files.has(tmpPath)).toBe(false);
  });
});
