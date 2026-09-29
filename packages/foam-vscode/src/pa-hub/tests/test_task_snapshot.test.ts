import { describe, expect, it } from 'vitest';
import {
  createSnapshot,
  parseTaskLine,
  selectNewestDailyFile,
  snapshotFromFiles,
} from '../../pa-hub/tasks/snapshot';

describe('task snapshot', () => {
  it('test_task_snapshot_select_newest', () => {
    expect(
      selectNewestDailyFile([
        '2026-09-20.md',
        '2026-09-23.md',
        '2026-09-21.md',
      ])
    ).toBe('2026-09-23.md');
  });

  it('test_task_snapshot_select_no_valid', () => {
    expect(
      selectNewestDailyFile(['README.md', '2026-09-15-plan.md', 'notes.txt'])
    ).toBeNull();
  });

  it('test_task_snapshot_select_ignores_non_date', () => {
    expect(selectNewestDailyFile(['2026-09-20.md', 'random.md'])).toBe(
      '2026-09-20.md'
    );
  });

  it('test_task_snapshot_parse_unchecked', () => {
    const task = parseTaskLine(
      '- [ ] Do thing <!-- id:t-abc1 quadrant:Q1 -->',
      4
    );

    expect(task).toMatchObject({
      lineIndex: 4,
      checked: false,
      text: 'Do thing',
      id: 't-abc1',
      meta: { id: 't-abc1', quadrant: 'Q1' },
    });
  });

  it('test_task_snapshot_parse_checked', () => {
    expect(parseTaskLine('- [x] Done thing <!-- id:t-abc2 -->', 0)).toMatchObject(
      {
        checked: true,
        text: 'Done thing',
        id: 't-abc2',
      }
    );
  });

  it('test_task_snapshot_parse_checked_uppercase', () => {
    expect(parseTaskLine('- [X] Done thing <!-- id:t-abc3 -->', 0)).toMatchObject(
      {
        checked: true,
        text: 'Done thing',
        id: 't-abc3',
      }
    );
  });

  it('test_task_snapshot_parse_no_comment', () => {
    const task = parseTaskLine('- [ ] Plain task', 0);
    expect(task).not.toBeNull();
    expect(task?.checked).toBe(false);
    expect(task?.text).toBe('Plain task');
    expect(task?.id).toBeNull();
    expect(task?.meta).toEqual({
      id: null,
      project: null,
      quadrant: null,
      mode: null,
      lever: null,
      parent: null,
      deadline: null,
      estimate: null,
      spent: null,
      origin: null,
      priority: null,
      pdca: null,
      stakeholder: null,
      created: null,
      day: null,
      pdca_stage: null,
    });
  });

  it('test_task_snapshot_parse_colon_values', () => {
    const task = parseTaskLine(
      '- [ ] Task <!-- id:t-x lever:labor:2 origin:habit:brain-dump:2026-09-23 -->',
      0
    );

    expect(task?.meta.lever).toBe('labor:2');
    expect(task?.meta.origin).toBe('habit:brain-dump:2026-09-23');
  });

  it('test_task_snapshot_parse_null_string', () => {
    const task = parseTaskLine('- [ ] Task <!-- id:t-y deadline:null -->', 0);

    expect(task?.meta.deadline).toBeNull();
    expect(task?.id).toBe('t-y');
  });

  it('test_task_snapshot_prose_skipped', () => {
    expect(parseTaskLine('Some prose line', 0)).toBeNull();
  });

  it('test_task_snapshot_empty_newest', () => {
    expect(createSnapshot('2026-09-23.md', 'rev-1', '')).toEqual({
      filename: '2026-09-23.md',
      revision: 'rev-1',
      tasks: [],
    });
  });

  it('test_task_snapshot_duplicate_id', () => {
    const snapshot = createSnapshot(
      '2026-09-23.md',
      'rev-1',
      '- [ ] First <!-- id:t-dup -->\n- [x] Second <!-- id:t-dup -->'
    );

    expect(snapshot.tasks).toHaveLength(2);
    expect(snapshot.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 't-dup',
          identity: 't-dup',
          ambiguousId: true,
        }),
      ])
    );
  });

  it('test_task_snapshot_idless_identity', () => {
    const snapshot = createSnapshot(
      '2026-09-23.md',
      'rev-7',
      'heading\n- [ ] No id\n- [ ] Another no id'
    );

    expect(snapshot.tasks.map(task => task.identity)).toEqual([
      '2026-09-23.md@rev-7#1',
      '2026-09-23.md@rev-7#2',
    ]);
    expect(snapshot.tasks.every(task => !task.ambiguousId)).toBe(true);
  });

  it('test_task_snapshot_no_valid_file', () => {
    expect(
      snapshotFromFiles(
        ['README.md', 'notes.txt'],
        () => '- [ ] ignored',
        () => 'rev-1'
      )
    ).toEqual({ ok: false, reason: 'no_valid_file' });
  });

  it('test_task_snapshot_full_round_trip', () => {
    const result = snapshotFromFiles(
      ['README.md', '2026-09-20.md', '2026-09-23.md'],
      filename =>
        filename === '2026-09-23.md'
          ? '- [ ] New task <!-- id:t-new -->\n- [x] Done task'
          : null,
      filename => `revision:${filename}`
    );

    if (!result.ok) {
      throw new Error('expected a snapshot');
    }

    expect(result.snapshot.filename).toBe('2026-09-23.md');
    expect(result.snapshot.revision).toBe('revision:2026-09-23.md');
    expect(result.snapshot.tasks).toHaveLength(2);
    expect(result.snapshot.tasks.map(task => task.text)).toEqual([
      'New task',
      'Done task',
    ]);
  });
});
