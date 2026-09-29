import type { TaskRecord, TaskSnapshot } from './snapshot';

export interface BoardTask {
  readonly identity: string;
  readonly text: string;
  readonly checked: boolean;
  readonly quadrant: string;
}

export interface EisenhowerData {
  readonly q1: readonly BoardTask[];
  readonly q2: readonly BoardTask[];
  readonly q3: readonly BoardTask[];
  readonly q4: readonly BoardTask[];
  readonly unassigned: readonly BoardTask[];
}

export interface KanbanData {
  readonly todo: readonly BoardTask[];
  readonly done: readonly BoardTask[];
}

export interface BoardData {
  readonly eisenhower: EisenhowerData;
  readonly kanban: KanbanData;
  readonly taskCount: number;
}

const QUADRANTS = ['Q1', 'Q2', 'Q3', 'Q4'] as const;

function resolveQuadrant(task: TaskRecord): string {
  const quadrant = task.meta.quadrant;
  return typeof quadrant === 'string' && QUADRANTS.includes(quadrant as (typeof QUADRANTS)[number])
    ? quadrant
    : 'unassigned';
}

function toBoardTask(task: TaskRecord): BoardTask {
  return {
    identity: task.identity,
    text: escapeHtml(task.text),
    checked: task.checked,
    quadrant: resolveQuadrant(task),
  };
}

export function snapshotToBoardData(snapshot: TaskSnapshot): BoardData {
  const eisenhower: Record<string, BoardTask[]> = {
    Q1: [],
    Q2: [],
    Q3: [],
    Q4: [],
    unassigned: [],
  };
  const todo: BoardTask[] = [];
  const done: BoardTask[] = [];

  for (const task of snapshot.tasks) {
    const boardTask = toBoardTask(task);
    eisenhower[boardTask.quadrant].push(boardTask);
    (boardTask.checked ? done : todo).push(boardTask);
  }

  return {
    eisenhower: {
      q1: eisenhower.Q1,
      q2: eisenhower.Q2,
      q3: eisenhower.Q3,
      q4: eisenhower.Q4,
      unassigned: eisenhower.unassigned,
    },
    kanban: { todo, done },
    taskCount: snapshot.tasks.length,
  };
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, character => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return character;
    }
  });
}

export function buildBoardHtml(options: {
  nonce: string;
  scriptUri: string;
  styleUri: string;
  cspSource: string;
}): string {
  const { nonce, scriptUri, styleUri, cspSource } = options;
  const csp = `default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';`;

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="${styleUri}" nonce="${nonce}">
    <title>Task Board</title>
  </head>
  <body>
    <div id="board-root"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
}
