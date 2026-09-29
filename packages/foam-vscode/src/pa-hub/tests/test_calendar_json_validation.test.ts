import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readCalendar } from '../calendar';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-json-validation-'));
}

describe('readCalendar JSON validation', () => {
  it('returns missing for malformed calendar JSON shapes', () => {
    const malformedInputs = [
      JSON.stringify('not an object'),
      JSON.stringify(42),
      JSON.stringify([]),
      JSON.stringify({ events: 'not an array' }),
      JSON.stringify({ events: [{}] }),
      JSON.stringify({ events: [{ id: 'event-1', date: '2026-09-29' }] }),
      JSON.stringify({ events: [{ id: 'event-1', date: 20260929, title: 'Wrong date type' }] }),
      JSON.stringify({ events: [null] }),
    ];

    const tmpDir = makeTmpDir();
    try {
      for (const [index, contents] of malformedInputs.entries()) {
        const filePath = path.join(tmpDir, `events-${index}.json`);
        fs.writeFileSync(filePath, contents);

        expect(readCalendar(filePath).status).toBe('missing');
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});
