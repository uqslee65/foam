import { describe, expect, it } from 'vitest';
import { FocusQueue } from '../focus';

describe('focus queue', () => {
  it('test_focus_queue_empty', () => {
    const queue = new FocusQueue();

    expect(() => queue.markNotReady()).not.toThrow();
    expect(queue.drain()).toEqual([]);
  });
});
