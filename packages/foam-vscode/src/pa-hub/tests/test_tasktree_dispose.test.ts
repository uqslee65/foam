import { describe, expect, it, vi } from 'vitest';
import { createSnapshot } from '../tasks/snapshot';
import { createTaskTree } from '../tasks/tree';

describe('task tree disposal', () => {
  it('test_task_tree_dispose_disposes_registered_listeners', () => {
    const tree = createTaskTree();
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    const firstSubscription = tree.onDidChange(firstListener);
    const secondSubscription = tree.onDidChange(secondListener);
    const firstDispose = vi.spyOn(firstSubscription, 'dispose');
    const secondDispose = vi.spyOn(secondSubscription, 'dispose');

    tree.dispose();
    tree.refresh(createSnapshot('2026-09-29.md', 'rev-1', '- [ ] Task'));

    expect(firstDispose).toHaveBeenCalledOnce();
    expect(secondDispose).toHaveBeenCalledOnce();
    expect(firstListener).not.toHaveBeenCalled();
    expect(secondListener).not.toHaveBeenCalled();
  });
});
