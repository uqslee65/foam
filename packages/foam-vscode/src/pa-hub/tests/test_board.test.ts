import { describe, expect, it } from 'vitest';
import { createSnapshot } from '../tasks/snapshot';
import {
  snapshotToBoardData,
  escapeHtml,
  buildBoardHtml,
  type BoardData,
  type BoardTask,
} from '../tasks/board';

function makeSnapshot(lines: string[]) {
  return createSnapshot('2026-09-26.md', 'rev1', lines.join('\n'));
}

describe('board', () => {
  it('test_board_eisenhower_groups_by_quadrant', () => {
    const data = snapshotToBoardData(
      makeSnapshot([
        '- [ ] urgent important <!-- quadrant:Q1 -->',
        '- [ ] important <!-- quadrant:Q2 -->',
      ])
    );

    expect(data.eisenhower.q1.map(task => task.text)).toEqual(['urgent important']);
    expect(data.eisenhower.q2.map(task => task.text)).toEqual(['important']);
    expect(data.eisenhower.q3).toEqual([]);
    expect(data.eisenhower.q4).toEqual([]);
  });

  it('test_board_eisenhower_unassigned', () => {
    const data = snapshotToBoardData(makeSnapshot(['- [ ] no quadrant']));

    expect(data.eisenhower.unassigned.map(task => task.text)).toEqual(['no quadrant']);
  });

  it('test_board_eisenhower_invalid_quadrant', () => {
    const data = snapshotToBoardData(
      makeSnapshot(['- [ ] invalid <!-- quadrant:q1 -->'])
    );

    expect(data.eisenhower.unassigned.map(task => task.text)).toEqual(['invalid']);
    expect(data.eisenhower.q1).toEqual([]);
  });

  it('test_board_kanban_checked_is_done', () => {
    const data = snapshotToBoardData(makeSnapshot(['- [x] finished']));

    expect(data.kanban.done.map(task => task.text)).toEqual(['finished']);
    expect(data.kanban.todo).toEqual([]);
  });

  it('test_board_kanban_unchecked_is_todo', () => {
    const data = snapshotToBoardData(makeSnapshot(['- [ ] pending']));

    expect(data.kanban.todo.map(task => task.text)).toEqual(['pending']);
    expect(data.kanban.done).toEqual([]);
  });

  it('test_board_task_count', () => {
    const data = snapshotToBoardData(
      makeSnapshot(['- [ ] first', '- [x] second', '- [ ] third'])
    );

    expect(data.taskCount).toBe(3);
  });

  it('test_board_empty_snapshot', () => {
    const data: BoardData = snapshotToBoardData(makeSnapshot([]));

    expect(data.taskCount).toBe(0);
    expect(data.eisenhower).toEqual({
      q1: [],
      q2: [],
      q3: [],
      q4: [],
      unassigned: [],
    });
    expect(data.kanban).toEqual({ todo: [], done: [] });
  });

  it('test_board_escape_html_ampersand', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('test_board_escape_html_angle_brackets', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('test_board_escape_html_quotes', () => {
    expect(escapeHtml('"x"')).toBe('&quot;x&quot;');
    expect(escapeHtml("'x'")).toBe('&#39;x&#39;');
  });

  it('test_board_build_html_has_csp', () => {
    const html = buildBoardHtml({
      nonce: 'nonce-1',
      scriptUri: 'script.js',
      styleUri: 'style.css',
      cspSource: 'vscode-webview-resource:',
    });

    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain("default-src 'none'");
  });

  it('test_board_build_html_has_nonce', () => {
    const html = buildBoardHtml({
      nonce: 'provided-nonce',
      scriptUri: 'script.js',
      styleUri: 'style.css',
      cspSource: 'vscode-webview-resource:',
    });

    expect(html).toContain("'nonce-provided-nonce'");
    expect(html).toContain('nonce="provided-nonce"');
  });

  it('test_board_build_html_no_inline_script', () => {
    const html = buildBoardHtml({
      nonce: 'nonce-2',
      scriptUri: 'script.js',
      styleUri: 'style.css',
      cspSource: 'vscode-webview-resource:',
    });

    expect(html).not.toMatch(/<script(?![^>]*\bnonce=)[^>]*>/i);
  });

  it('test_board_task_identity_preserved', () => {
    const data = snapshotToBoardData(
      makeSnapshot(['- [ ] identified task <!-- id:task-123 -->'])
    );
    const task: BoardTask = data.kanban.todo[0];

    expect(task.identity).toBe('task-123');
  });
});
