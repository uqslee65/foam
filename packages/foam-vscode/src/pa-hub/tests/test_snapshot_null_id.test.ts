import { expect, it } from 'vitest';
import { createSnapshot } from '../tasks/snapshot';

it('test_snapshot_null_id', () => {
  const snapshot = createSnapshot(
    '2026-09-29.md',
    'rev-1',
    '- [ ] Task with an empty id <!-- id: -->'
  );

  expect(snapshot.tasks).toHaveLength(1);
  expect(snapshot.tasks[0]).toMatchObject({
    id: '',
    identity: '',
    ambiguousId: false,
  });
});
