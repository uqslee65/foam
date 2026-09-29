import { describe, expect, it } from 'vitest';
import { createSnapshot, type TaskSnapshot, type TaskRecord } from '../tasks/snapshot';
import {
  createTaskTree,
  QUADRANT_ORDER,
  UNASSIGNED_QUADRANT,
  type TaskGroupNode,
  type TaskItemNode,
  type TaskTree,
} from '../tasks/tree';

function makeSnapshot(lines: string[]): TaskSnapshot {
  const content = lines.join('\n');
  return createSnapshot('2026-09-26.md', 'rev1', content);
}

function groupsAtRoot(tree: TaskTree): TaskGroupNode[] {
  return [...tree.getChildren(undefined)] as TaskGroupNode[];
}

function itemsInGroup(tree: TaskTree, group: TaskGroupNode): TaskItemNode[] {
  return [...tree.getChildren(group)] as TaskItemNode[];
}

describe('task tree', () => {
  it('test_task_tree_groups_by_quadrant', () => {
    const tree = createTaskTree();
    tree.refresh(
      makeSnapshot([
        '- [ ] First <!-- id:t-001 quadrant:Q1 -->',
        '- [ ] Second <!-- id:t-002 quadrant:Q2 -->',
      ])
    );

    expect(groupsAtRoot(tree).map(group => group.quadrant)).toEqual(['Q1', 'Q2']);
  });

  it('test_task_tree_unassigned_for_null_quadrant', () => {
    const tree = createTaskTree();
    tree.refresh(makeSnapshot(['- [ ] No metadata task']));

    expect(groupsAtRoot(tree).map(group => group.quadrant)).toEqual([
      UNASSIGNED_QUADRANT,
    ]);
    expect(itemsInGroup(tree, groupsAtRoot(tree)[0]).map(item => item.text)).toEqual([
      'No metadata task',
    ]);
  });

  it('test_task_tree_unassigned_for_invalid_quadrant', () => {
    const tree = createTaskTree();
    tree.refresh(makeSnapshot(['- [ ] Invalid quad <!-- id:t-003 quadrant:X1 -->']));

    expect(groupsAtRoot(tree)[0].quadrant).toBe(UNASSIGNED_QUADRANT);
  });

  it('test_task_tree_group_order', () => {
    const tree = createTaskTree();
    tree.refresh(
      makeSnapshot([
        '- [ ] Fourth <!-- id:t-004 quadrant:Q4 -->',
        '- [ ] First <!-- id:t-001 quadrant:Q1 -->',
        '- [ ] Third <!-- id:t-003 quadrant:Q3 -->',
      ])
    );

    expect(groupsAtRoot(tree).map(group => group.quadrant)).toEqual(['Q1', 'Q3', 'Q4']);
    expect(QUADRANT_ORDER).toEqual(['Q1', 'Q2', 'Q3', 'Q4']);
  });

  it('test_task_tree_empty_groups_excluded', () => {
    const tree = createTaskTree();
    tree.refresh(makeSnapshot(['- [ ] Scheduled <!-- id:t-002 quadrant:Q2 -->']));

    expect(groupsAtRoot(tree)).toHaveLength(1);
    expect(groupsAtRoot(tree)[0].quadrant).toBe('Q2');
  });

  it('test_task_tree_root_returns_groups_only', () => {
    const tree = createTaskTree();
    tree.refresh(makeSnapshot(['- [ ] Task <!-- id:t-001 quadrant:Q1 -->']));

    expect(groupsAtRoot(tree).every(element => element.kind === 'group')).toBe(true);
  });

  it('test_task_tree_group_returns_items', () => {
    const tree = createTaskTree();
    tree.refresh(makeSnapshot(['- [ ] Task <!-- id:t-001 quadrant:Q1 -->']));
    const group = groupsAtRoot(tree)[0];

    expect(itemsInGroup(tree, group)).toEqual([
      expect.objectContaining({ kind: 'item', identity: 't-001' }),
    ]);
  });

  it('test_task_tree_item_checked_state', () => {
    const tree = createTaskTree();
    tree.refresh(
      makeSnapshot([
        '- [x] Done task <!-- id:t-001 quadrant:Q1 -->',
        '- [ ] Open task <!-- id:t-002 quadrant:Q1 -->',
      ])
    );
    const items = itemsInGroup(tree, groupsAtRoot(tree)[0]);

    expect(items.map(item => item.checked)).toEqual([true, false]);
  });

  it('test_task_tree_item_text', () => {
    const tree = createTaskTree();
    tree.refresh(makeSnapshot(['- [ ] Task text <!-- id:t-001 quadrant:Q1 -->']));

    expect(itemsInGroup(tree, groupsAtRoot(tree)[0])[0].text).toBe('Task text');
  });

  it('test_task_tree_refresh_replaces_data', () => {
    const tree = createTaskTree();
    tree.refresh(makeSnapshot(['- [ ] Old task <!-- id:old quadrant:Q1 -->']));
    tree.refresh(makeSnapshot(['- [ ] New task <!-- id:new quadrant:Q2 -->']));

    expect(groupsAtRoot(tree).map(group => group.quadrant)).toEqual(['Q2']);
    expect(itemsInGroup(tree, groupsAtRoot(tree)[0])[0].identity).toBe('new');
  });

  it('test_task_tree_refresh_fires_listener', () => {
    const tree = createTaskTree();
    let calls = 0;
    tree.onDidChange(() => {
      calls += 1;
    });

    tree.refresh(makeSnapshot(['- [ ] Task <!-- id:t-001 quadrant:Q1 -->']));

    expect(calls).toBe(1);
  });

  it('test_task_tree_empty_snapshot', () => {
    const tree = createTaskTree();
    tree.refresh(makeSnapshot([]));

    expect(tree.getChildren(undefined)).toEqual([]);
  });

  it('test_task_tree_dispose_removes_listener', () => {
    const tree = createTaskTree();
    let calls = 0;
    const subscription = tree.onDidChange(() => {
      calls += 1;
    });
    subscription.dispose();

    tree.refresh(makeSnapshot(['- [ ] Task <!-- id:t-001 quadrant:Q1 -->']));

    expect(calls).toBe(0);
  });

  it('test_task_tree_group_count', () => {
    const tree = createTaskTree();
    tree.refresh(
      makeSnapshot([
        '- [ ] One <!-- id:t-001 quadrant:Q1 -->',
        '- [ ] Two <!-- id:t-002 quadrant:Q1 -->',
      ])
    );

    expect(groupsAtRoot(tree)[0].count).toBe(2);
  });

  it('test_task_tree_item_record_preserved', () => {
    const tree = createTaskTree();
    const snapshot = makeSnapshot(['- [ ] Task <!-- id:t-001 quadrant:Q1 -->']);
    const record: TaskRecord = snapshot.tasks[0];
    tree.refresh(snapshot);

    expect(itemsInGroup(tree, groupsAtRoot(tree)[0])[0].record).toBe(record);
  });
});
