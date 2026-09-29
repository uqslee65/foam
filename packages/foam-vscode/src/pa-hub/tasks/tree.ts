import type { TaskSnapshot, TaskRecord } from './snapshot';

export const QUADRANT_ORDER = ['Q1', 'Q2', 'Q3', 'Q4'] as const;
export const UNASSIGNED_QUADRANT = 'unassigned';

export interface TaskGroupNode {
  readonly kind: 'group';
  readonly quadrant: string;
  readonly label: string;
  readonly count: number;
}

export interface TaskItemNode {
  readonly kind: 'item';
  readonly identity: string;
  readonly text: string;
  readonly checked: boolean;
  readonly quadrant: string;
  readonly record: TaskRecord;
}

export type TaskTreeElement = TaskGroupNode | TaskItemNode;

export interface TaskTree {
  refresh(snapshot: TaskSnapshot): void;
  getChildren(element?: TaskTreeElement): readonly TaskTreeElement[];
  onDidChange(listener: () => void): { dispose(): void };
  dispose(): void;
}

const QUADRANT_LABELS: Record<string, string> = {
  Q1: 'Q1 — Do',
  Q2: 'Q2 — Schedule',
  Q3: 'Q3 — Delegate',
  Q4: 'Q4 — Eliminate',
};

export function createTaskTree(): TaskTree {
  const groups = new Map<string, TaskItemNode[]>();
  const listeners = new Set<() => void>();
  const disposables: { dispose(): void }[] = [];

  function refresh(snapshot: TaskSnapshot): void {
    groups.clear();
    for (const task of snapshot.tasks) {
      const quadrant =
        typeof task.meta.quadrant === 'string' &&
        QUADRANT_ORDER.includes(task.meta.quadrant as (typeof QUADRANT_ORDER)[number])
          ? task.meta.quadrant
          : UNASSIGNED_QUADRANT;
      const items = groups.get(quadrant) ?? [];
      items.push({
        kind: 'item',
        identity: task.identity,
        text: task.text,
        checked: task.checked,
        quadrant,
        record: task,
      });
      groups.set(quadrant, items);
    }
    for (const listener of listeners) {
      listener();
    }
  }

  function getChildren(element?: TaskTreeElement): readonly TaskTreeElement[] {
    if (element === undefined) {
      return [...QUADRANT_ORDER, UNASSIGNED_QUADRANT]
        .filter(quadrant => (groups.get(quadrant)?.length ?? 0) > 0)
        .map(quadrant => ({
          kind: 'group' as const,
          quadrant,
          label: QUADRANT_LABELS[quadrant] ?? 'Unassigned',
          count: groups.get(quadrant)!.length,
        }));
    }

    if (element.kind === 'group') {
      return groups.get(element.quadrant) ?? [];
    }

    return [];
  }

  function onDidChange(listener: () => void): { dispose(): void } {
    listeners.add(listener);
    let disposed = false;
    const disposable = {
      dispose(): void {
        if (disposed) return;
        disposed = true;
        listeners.delete(listener);
      },
    };
    disposables.push(disposable);
    return disposable;
  }

  function dispose(): void {
    for (const disposable of disposables.splice(0)) {
      disposable.dispose();
    }
  }

  return { refresh, getChildren, onDidChange, dispose };
}
