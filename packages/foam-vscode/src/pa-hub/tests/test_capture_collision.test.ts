import { describe, expect, it, vi } from 'vitest';
import { generateFilename } from '../inbox';

describe('capture filename collision prevention', () => {
  it('generates distinct filenames for same-second captures', () => {
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.1234).mockReturnValueOnce(0.5678);

    const firstFilename = generateFilename('Same Title', '2026-09-26T14:30:00.100Z');
    const secondFilename = generateFilename('Same Title', '2026-09-26T14:30:00.900Z');

    expect(firstFilename).not.toBe(secondFilename);
    vi.restoreAllMocks();
  });
});
