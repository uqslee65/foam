import { describe, expect, it, vi } from 'vitest';
import { createUsageTree } from '../usage/tree';

describe('usage tree disposal', () => {
  it('test_usage_tree_dispose_disposes_registered_listeners', () => {
    const tree = createUsageTree();
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    const firstSubscription = tree.onDidChange(firstListener);
    const secondSubscription = tree.onDidChange(secondListener);
    const firstDispose = vi.spyOn(firstSubscription, 'dispose');
    const secondDispose = vi.spyOn(secondSubscription, 'dispose');

    tree.dispose();
    tree.update({ status: 'missing', reason: 'no-file' }, null, null);

    expect(firstDispose).toHaveBeenCalledOnce();
    expect(secondDispose).toHaveBeenCalledOnce();
    expect(firstListener).not.toHaveBeenCalled();
    expect(secondListener).not.toHaveBeenCalled();
  });
});
