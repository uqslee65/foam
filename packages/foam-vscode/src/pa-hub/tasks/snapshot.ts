export interface TaskMeta {
  readonly id: string | null;
  readonly project: string | null;
  readonly quadrant: string | null;
  readonly mode: string | null;
  readonly lever: string | null;
  readonly parent: string | null;
  readonly deadline: string | null;
  readonly estimate: string | null;
  readonly spent: string | null;
  readonly origin: string | null;
  readonly priority: string | null;
  readonly pdca: string | null;
  readonly stakeholder: string | null;
  readonly created: string | null;
  readonly day: string | null;
  readonly pdca_stage: string | null;
  readonly [key: string]: string | null;
}

export interface TaskRecord {
  readonly lineIndex: number;
  readonly raw: string;
  readonly checked: boolean;
  readonly text: string;
  readonly meta: TaskMeta;
  readonly id: string | null;
  readonly identity: string;
  readonly ambiguousId: boolean;
}

export interface TaskSnapshot {
  readonly filename: string;
  readonly revision: string;
  readonly tasks: readonly TaskRecord[];
}

export type SnapshotResult =
  | { ok: true; snapshot: TaskSnapshot }
  | { ok: false; reason: 'no_valid_file' };

const dailyFilenamePattern = /^\d{4}-\d{2}-\d{2}\.md$/;
const taskLinePattern =
  /^- \[( |x|X)\] (.*?)(?:\s*<!--\s*(.*?)\s*-->)?\s*$/;

const knownMetaKeys = [
  'id',
  'project',
  'quadrant',
  'mode',
  'lever',
  'parent',
  'deadline',
  'estimate',
  'spent',
  'origin',
  'priority',
  'pdca',
  'stakeholder',
  'created',
  'day',
  'pdca_stage',
] as const;

function emptyTaskMeta(): TaskMeta {
  const meta: Record<string, string | null> = {};
  for (const key of knownMetaKeys) {
    meta[key] = null;
  }
  return meta as TaskMeta;
}

function parseTaskMeta(comment: string | undefined): TaskMeta {
  const meta = emptyTaskMeta() as Record<string, string | null>;
  if (comment === undefined) {
    return meta as TaskMeta;
  }

  for (const token of comment.trim().split(/\s+/)) {
    const separator = token.indexOf(':');
    if (separator === -1) {
      continue;
    }

    const key = token.slice(0, separator);
    const value = token.slice(separator + 1);
    meta[key] = value === 'null' ? null : value;
  }

  return meta as TaskMeta;
}

export function selectNewestDailyFile(
  filenames: readonly string[]
): string | null {
  let newest: string | null = null;
  for (const filename of filenames) {
    if (!dailyFilenamePattern.test(filename)) {
      continue;
    }
    if (newest === null || filename > newest) {
      newest = filename;
    }
  }
  return newest;
}

export function parseTaskLine(
  line: string,
  lineIndex: number
): TaskRecord | null {
  const match = taskLinePattern.exec(line);
  if (match === null) {
    return null;
  }

  const checked = match[1] === 'x' || match[1] === 'X';
  const meta = parseTaskMeta(match[3]);
  return {
    lineIndex,
    raw: line,
    checked,
    text: match[2].trim(),
    meta,
    id: meta.id,
    identity: '',
    ambiguousId: false,
  };
}

export function createSnapshot(
  filename: string,
  revision: string,
  content: string
): TaskSnapshot {
  const tasks: TaskRecord[] = [];
  for (const [lineIndex, line] of content.split('\n').entries()) {
    const task = parseTaskLine(line, lineIndex);
    if (task !== null) {
      tasks.push(task);
    }
  }

  const idCounts = new Map<string, number>();
  for (const task of tasks) {
    if (task.id !== null) {
      idCounts.set(task.id, (idCounts.get(task.id) ?? 0) + 1);
    }
  }

  const resolvedTasks = tasks.map(task => {
    if (task.id === null) {
      return {
        ...task,
        identity: `${filename}@${revision}#${task.lineIndex}`,
        ambiguousId: false,
      };
    }

    return {
      ...task,
      identity: task.id,
      ambiguousId: (idCounts.get(task.id) ?? 0) > 1,
    };
  });

  return { filename, revision, tasks: resolvedTasks };
}

export async function snapshotFromFiles(
  filenames: readonly string[],
  getContent: (filename: string) => Promise<string | null>,
  getRevision: (filename: string) => string
): Promise<SnapshotResult> {
  const filename = selectNewestDailyFile(filenames);
  if (filename === null) {
    return { ok: false, reason: 'no_valid_file' };
  }

  const content = await getContent(filename);
  if (content === null) {
    return { ok: false, reason: 'no_valid_file' };
  }

  const revision = getRevision(filename);
  return { ok: true, snapshot: createSnapshot(filename, revision, content) };
}
