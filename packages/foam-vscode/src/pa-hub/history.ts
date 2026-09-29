import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse } from 'yaml';

export interface PdcaCycle {
  readonly slug: string;
  readonly title: string;
  readonly stage: string;
  readonly outcome: string;
  readonly date: string;
  readonly state: 'done' | 'active' | 'queued' | 'parked';
  readonly parkedReason?: string;
  readonly source: string;
}

export interface HistoryGroupNode {
  readonly kind: 'state-group';
  readonly state: string;
  readonly label: string;
  readonly count: number;
}

export interface HistoryItemNode {
  readonly kind: 'cycle';
  readonly cycle: PdcaCycle;
  readonly label: string;
}

export type HistoryTreeElement = HistoryGroupNode | HistoryItemNode;

export interface HistoryTree {
  refresh(cycles: PdcaCycle[]): void;
  getChildren(element?: HistoryTreeElement): readonly HistoryTreeElement[];
  onDidChange(listener: () => void): { dispose(): void };
}

const STATE_ORDER: Record<string, number> = {
  active: 0,
  queued: 1,
  parked: 2,
  done: 3,
};

const STATE_LABELS: Record<string, string> = {
  active: 'Active',
  queued: 'Queued',
  parked: 'Parked',
  done: 'Done',
};

function classifyCycle(entry: Record<string, unknown>): string {
  const stage = String(entry.stage ?? '').trim().toLowerCase();
  const outcome = String(entry.outcome ?? '').trim().toLowerCase();
  const hasManager = Boolean(entry.manager);
  const hasParkedReason = Boolean(entry.parked_reason);

  if (outcome === 'parked' && hasParkedReason) {
    return 'parked';
  }
  if (stage === 'plan' && outcome === 'pending' && !hasManager) {
    return 'queued';
  }
  if (['pass', 'fail', 'partial'].includes(outcome)) {
    return 'done';
  }
  if ((stage === 'do' || stage === 'check') && hasManager) {
    return 'active';
  }
  return 'done';
}

export function readPdcaCycles(logsDir: string, limit = 100): PdcaCycle[] {
  const cycles: PdcaCycle[] = [];
  let files: string[];
  try {
    files = fs.readdirSync(logsDir).filter(f => f.endsWith('.yaml') && f !== 'queue-order.yaml');
  } catch {
    return [];
  }

  files.sort().reverse();
  const toRead = files.slice(0, limit);

  for (const file of toRead) {
    const filePath = path.join(logsDir, file);
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const doc = parse(raw) as Record<string, unknown> | null;
      if (!doc) {
        continue;
      }
      const entry = (doc.pdca_entry ?? doc) as Record<string, unknown>;
      const slug = String(entry.task_slug ?? entry.cycle_id ?? file);
      const state = classifyCycle(entry);

      cycles.push({
        slug,
        title: String(entry.title ?? slug),
        stage: String(entry.stage ?? ''),
        outcome: String(entry.outcome ?? ''),
        date: String(entry.date ?? ''),
        state: state as PdcaCycle['state'],
        parkedReason: entry.parked_reason ? String(entry.parked_reason) : undefined,
        source: filePath,
      });
    } catch {
      // skip malformed files
    }
  }

  return cycles;
}

export function createHistoryTree(): HistoryTree {
  const groups = new Map<string, HistoryItemNode[]>();
  const listeners = new Set<() => void>();

  function refresh(cycles: PdcaCycle[]): void {
    groups.clear();
    for (const cycle of cycles) {
      const items = groups.get(cycle.state) ?? [];
      const outcomeTag = cycle.outcome && cycle.outcome !== 'pending'
        ? ` [${cycle.outcome}]`
        : '';
      items.push({
        kind: 'cycle',
        cycle,
        label: `${cycle.slug}${outcomeTag}`,
      });
      groups.set(cycle.state, items);
    }
    for (const listener of listeners) {
      listener();
    }
  }

  function getChildren(element?: HistoryTreeElement): readonly HistoryTreeElement[] {
    if (element === undefined) {
      return [...groups.keys()]
        .sort((a, b) => (STATE_ORDER[a] ?? 99) - (STATE_ORDER[b] ?? 99))
        .map(state => ({
          kind: 'state-group' as const,
          state,
          label: STATE_LABELS[state] ?? state,
          count: groups.get(state)!.length,
        }));
    }

    if (element.kind === 'state-group') {
      return groups.get(element.state) ?? [];
    }

    return [];
  }

  function onDidChange(listener: () => void): { dispose(): void } {
    listeners.add(listener);
    return { dispose: () => listeners.delete(listener) };
  }

  return { refresh, getChildren, onDidChange };
}
