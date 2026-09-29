import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  generateFilename,
  validateCapture,
  formatNote,
  parseNote,
  createCapture,
  type InboxNote,
  type CaptureResult,
  type CaptureError,
} from '../inbox';

describe('inbox domain module', () => {
  it('test_inbox_generate_filename_basic', () => {
    const filename = generateFilename('My Great Idea', '2026-09-26T14:30:00Z');
    expect(filename).toMatch(/^2026-09-26-143000-my-great-idea-[a-z0-9]{8,}\.md$/);
  });

  it('test_inbox_generate_filename_special_chars', () => {
    const filename = generateFilename(
      'Idea #1: Fast & Furious! (2026)',
      '2026-09-26T14:30:00Z'
    );
    expect(filename).toMatch(/^2026-09-26-143000-idea-1-fast-furious-2026-[a-z0-9]{8,}\.md$/);
  });

  it('test_inbox_generate_filename_long_title', () => {
    const longTitle = 'a'.repeat(60);
    const filename = generateFilename(longTitle, '2026-09-26T14:30:00Z');
    expect(filename).toMatch(new RegExp(`^2026-09-26-143000-${'a'.repeat(40)}-[a-z0-9]{8,}\\.md$`));
  });

  it('test_inbox_generate_filename_invalid_timestamp', () => {
    expect(generateFilename('My Idea', 'not-a-timestamp')).toBe('');
    expect(generateFilename('My Idea', '')).toBe('');
    expect(generateFilename('My Idea', '2026-99-99')).toBe('');
    expect(generateFilename('My Idea', '2026-02-30T14:30:00Z')).toBe('');
  });

  it('test_inbox_validate_empty_title', () => {
    expect(validateCapture('', 'inbox')).toBe('empty_title');
    expect(validateCapture('   ', 'inbox')).toBe('empty_title');
    expect(validateCapture('\t\n', 'inbox')).toBe('empty_title');
  });

  it('test_inbox_validate_long_title', () => {
    expect(validateCapture('a'.repeat(201), 'inbox')).toBe('title_too_long');
    expect(validateCapture('a'.repeat(200), 'inbox')).toBeNull();
  });

  it('test_inbox_validate_path_traversal', () => {
    const workspaceRoot = path.resolve(process.cwd());
    const outsidePath = path.resolve(workspaceRoot, '../../outside/file');

    expect(validateCapture('Valid Title', '../../outside/file')).toBe('path_traversal');
    expect(validateCapture('Valid Title', outsidePath)).toBe('path_traversal');
    expect(validateCapture('Valid Title', 'dir/../inbox')).toBeNull();
  });

  it('test_inbox_validate_absolute_path', () => {
    expect(validateCapture('Valid Title', '/inbox')).toBe('path_traversal');
    expect(validateCapture('Valid Title', '/home/user/inbox')).toBe('path_traversal');
  });

  it('test_inbox_validate_tilde_path', () => {
    expect(validateCapture('Valid Title', '~/inbox')).toBeNull();
    expect(validateCapture('Valid Title', '~notes')).toBeNull();
  });

  it('test_inbox_validate_ok', () => {
    expect(validateCapture('My Great Idea', 'inbox')).toBeNull();
    expect(validateCapture('A note', 'daily/inbox')).toBeNull();
  });

  it('test_inbox_format_note_with_body', () => {
    const note: InboxNote = {
      title: 'My Great Idea',
      body: 'This is the note body content.',
      provenance: 'direct',
      createdAt: '2026-09-26T14:30:00Z',
    };
    const expected = [
      '---',
      'title: My Great Idea',
      'created: 2026-09-26T14:30:00Z',
      'provenance: direct',
      '---',
      '',
      'This is the note body content.',
      '',
    ].join('\n');
    expect(formatNote(note)).toBe(expected);
  });

  it('test_inbox_format_note_empty_body', () => {
    const note: InboxNote = {
      title: 'My Great Idea',
      body: '',
      provenance: 'direct',
      createdAt: '2026-09-26T14:30:00Z',
    };
    const expected = [
      '---',
      'title: My Great Idea',
      'created: 2026-09-26T14:30:00Z',
      'provenance: direct',
      '---',
      '',
      '',
    ].join('\n');
    expect(formatNote(note)).toBe(expected);
  });

  it('test_inbox_format_note_null_provenance', () => {
    const note: InboxNote = {
      title: 'My Great Idea',
      body: '',
      provenance: null,
      createdAt: '2026-09-26T14:30:00Z',
    };
    const expected = [
      '---',
      'title: My Great Idea',
      'created: 2026-09-26T14:30:00Z',
      'provenance: direct',
      '---',
      '',
      '',
    ].join('\n');
    expect(formatNote(note)).toBe(expected);
  });

  it('test_inbox_format_note_quoted_title', () => {
    const noteWithColon: InboxNote = {
      title: 'Idea: Sub-idea',
      body: 'Content',
      provenance: 'slack',
      createdAt: '2026-09-26T14:30:00Z',
    };
    const formattedColon = formatNote(noteWithColon);
    expect(formattedColon).toContain('title: "Idea: Sub-idea"');
    expect(formattedColon).toContain('provenance: slack');

    const noteWithSpecialChars: InboxNote = {
      title: '[Draft] Note #1 & Details',
      body: 'Content',
      provenance: null,
      createdAt: '2026-09-26T14:30:00Z',
    };
    const formattedSpecial = formatNote(noteWithSpecialChars);
    expect(formattedSpecial).toContain('title: "[Draft] Note #1 & Details"');
  });

  it('test_inbox_parse_roundtrip', () => {
    const note1: InboxNote = {
      title: 'My Great Idea',
      body: 'This is the note body content.',
      provenance: null,
      createdAt: '2026-09-26T14:30:00Z',
    };
    expect(parseNote(formatNote(note1))).toEqual(note1);

    const note2: InboxNote = {
      title: 'Idea: With Colons & YAML Special Characters #42',
      body: 'Paragraph one\n\nParagraph two',
      provenance: 'telegram',
      createdAt: '2026-09-26T14:30:00Z',
    };
    expect(parseNote(formatNote(note2))).toEqual(note2);

    const noteEmptyBody: InboxNote = {
      title: 'Empty Body Note',
      body: '',
      provenance: null,
      createdAt: '2026-09-26T14:30:00Z',
    };
    expect(parseNote(formatNote(noteEmptyBody))).toEqual(noteEmptyBody);
  });

  it('test_inbox_parse_invalid', () => {
    expect(parseNote('No frontmatter at all')).toBeNull();
    expect(parseNote('# Just Markdown\n\nBody here')).toBeNull();
    expect(parseNote('---\nunclosed: frontmatter\n')).toBeNull();
  });

  it('test_inbox_parse_missing_title', () => {
    const noTitle = ['---', 'created: 2026-09-26T14:30:00Z', 'provenance: direct', '---', '', 'Body'].join('\n');
    expect(parseNote(noTitle)).toBeNull();

    const emptyTitle = ['---', 'title: ""', 'created: 2026-09-26T14:30:00Z', '---', '', 'Body'].join('\n');
    expect(parseNote(emptyTitle)).toBeNull();
  });

  it('test_inbox_capture_valid', () => {
    const result: CaptureResult = createCapture(
      'My Great Idea',
      'Body text',
      null,
      '2026-09-26T14:30:00Z',
      'inbox'
    );
    expect(result).toEqual({
      ok: true,
      filename: expect.stringMatching(/^2026-09-26-143000-my-great-idea-[a-z0-9]{8,}\.md$/),
      content: formatNote({
        title: 'My Great Idea',
        body: 'Body text',
        provenance: null,
        createdAt: '2026-09-26T14:30:00Z',
      }),
    });
  });

  it('test_inbox_capture_empty_title', () => {
    const result: CaptureResult = createCapture('', 'Body text', null, '2026-09-26T14:30:00Z', 'inbox');
    const expectedError: CaptureError = 'empty_title';
    expect(result).toEqual({ ok: false, reason: expectedError });
  });

  it('test_inbox_capture_bad_timestamp', () => {
    const result: CaptureResult = createCapture('Valid Title', 'Body text', null, 'invalid-date', 'inbox');
    const expectedError: CaptureError = 'invalid_timestamp';
    expect(result).toEqual({ ok: false, reason: expectedError });
  });

  it('test_inbox_capture_path_traversal', () => {
    const result: CaptureResult = createCapture('Valid Title', 'Body text', null, '2026-09-26T14:30:00Z', '../inbox');
    const expectedError: CaptureError = 'path_traversal';
    expect(result).toEqual({ ok: false, reason: expectedError });
  });
});
