import type { PrivacyPolicy } from './privacy';

export interface SourceTopic {
  readonly kind: 'topic';
  readonly label: string;
  readonly count: number;
}

export interface SourceEntry {
  readonly kind: 'entry';
  readonly label: string;
  readonly relativePath: string;
  readonly broken: boolean;
  readonly topic: string;
}

export type SourceElement = SourceTopic | SourceEntry;

export interface ParsedTopic {
  readonly label: string;
  readonly entries: readonly { relativePath: string; label: string }[];
}

export function parseIndex(content: string): readonly ParsedTopic[] {
  const lines = content.split(/\r?\n/);
  const topics: ParsedTopic[] = [];
  let currentTopic: { label: string; entries: { relativePath: string; label: string }[] } | null = null;

  for (const line of lines) {
    if (line.startsWith('## ')) {
      currentTopic = {
        label: line.slice(3).trim(),
        entries: [],
      };
      topics.push(currentTopic);
      continue;
    }

    if (currentTopic === null) {
      continue;
    }

    const wikiMatches = line.matchAll(/\[\[([^\]]+)\]\]/g);
    for (const match of wikiMatches) {
      const relativePath = match[1];
      const lastSlashIndex = relativePath.lastIndexOf('/');
      const label = lastSlashIndex >= 0 ? relativePath.slice(lastSlashIndex + 1) : relativePath;
      currentTopic.entries.push({ relativePath, label });
    }
    const mdMatches = line.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g);
    for (const match of mdMatches) {
      const label = match[1];
      const relativePath = match[2];
      currentTopic.entries.push({ relativePath, label });
    }
  }

  return topics;
}

export interface SourceTree {
  refresh(
    topics: readonly ParsedTopic[],
    fileExists: (relativePath: string) => boolean,
    isPermitted: (relativePath: string) => boolean
  ): void;
  getChildren(element?: SourceElement): readonly SourceElement[];
  onDidChange(listener: () => void): { dispose(): void };
}

export function createSourceTree(): SourceTree {
  const groups = new Map<string, SourceEntry[]>();
  const listeners = new Set<() => void>();

  function refresh(
    topics: readonly ParsedTopic[],
    fileExists: (relativePath: string) => boolean,
    isPermitted: (relativePath: string) => boolean
  ): void {
    groups.clear();
    for (const topic of topics) {
      const entries: SourceEntry[] = [];
      for (const entry of topic.entries) {
        if (!isPermitted(entry.relativePath)) {
          continue;
        }
        entries.push({
          kind: 'entry',
          label: entry.label,
          relativePath: entry.relativePath,
          broken: !fileExists(entry.relativePath),
          topic: topic.label,
        });
      }
      const existing = groups.get(topic.label);
      if (existing) {
        existing.push(...entries);
      } else {
        groups.set(topic.label, entries);
      }
    }
    for (const listener of listeners) {
      listener();
    }
  }

  function getChildren(element?: SourceElement): readonly SourceElement[] {
    if (element === undefined) {
      const result: SourceTopic[] = [];
      for (const [label, entries] of groups) {
        if (entries.length > 0) {
          result.push({
            kind: 'topic',
            label,
            count: entries.length,
          });
        }
      }
      return result;
    }

    if (element.kind === 'topic') {
      return groups.get(element.label) ?? [];
    }

    return [];
  }

  function onDidChange(listener: () => void): { dispose(): void } {
    listeners.add(listener);
    return { dispose: () => listeners.delete(listener) };
  }

  return { refresh, getChildren, onDidChange };
}
