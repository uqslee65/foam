import type { ClaudeUsageState } from './claude';
import type { CodexUsageSnapshot } from './codex';
import type { AgyUsageSnapshot } from './antigravity';

export interface UsageProviderNode {
  readonly kind: 'provider';
  readonly provider: 'claude' | 'codex' | 'antigravity';
  readonly label: string;
  readonly statusLabel: string;
  readonly observedAt: string | null;
}

export interface UsageDetailNode {
  readonly kind: 'detail';
  readonly provider: 'claude' | 'codex' | 'antigravity';
  readonly label: string;
  readonly value: string;
}

export type UsageTreeElement = UsageProviderNode | UsageDetailNode;

export function formatObservedAt(fetchedAt: number | null): string | null {
  if (
    fetchedAt === null ||
    fetchedAt === 0 ||
    !Number.isFinite(fetchedAt) ||
    fetchedAt < 0
  ) {
    return null;
  }
  const date = new Date(fetchedAt);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `Observed ${hours}:${minutes}:${seconds}`;
}

export function claudeStatusLabel(state: ClaudeUsageState): string {
  switch (state.status) {
    case 'missing':
      return 'Not available';
    case 'invalid':
      return 'Invalid data';
    case 'stale':
      return 'Stale';
    case 'fresh':
      return 'Active';
  }
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  return `${value}%`;
}

function formatResetsInMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) {
    return '—';
  }
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const remainingMinutes = totalMinutes % (24 * 60);
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;

  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return '0m';
}

function getClaudeReason(
  state:
    | { status: 'missing'; reason: 'no-dir' | 'no-file' }
    | { status: 'invalid'; reason: 'parse' | 'schema' | 'io'; detail: string }
): string {
  if (state.status === 'missing') {
    return state.reason;
  }
  return state.detail ? `${state.reason}: ${state.detail}` : state.reason;
}

export function claudeDetails(
  state: ClaudeUsageState
): readonly UsageDetailNode[] {
  if (state.status === 'missing' || state.status === 'invalid') {
    return [
      {
        kind: 'detail',
        provider: 'claude',
        label: 'Reason',
        value: getClaudeReason(state),
      },
    ];
  }

  const obs = state.observation;
  const modelId = obs.model?.id ?? '';
  const truncatedModel = modelId.length > 50 ? modelId.slice(0, 50) : modelId;
  const resetsInMs =
    obs.fiveHour?.resetsInMs ?? obs.sevenDay?.resetsInMs ?? null;

  return [
    {
      kind: 'detail',
      provider: 'claude',
      label: '5h window',
      value: formatPercent(obs.fiveHour?.usedPercentage),
    },
    {
      kind: 'detail',
      provider: 'claude',
      label: '7d window',
      value: formatPercent(obs.sevenDay?.usedPercentage),
    },
    {
      kind: 'detail',
      provider: 'claude',
      label: 'Model',
      value: truncatedModel || '—',
    },
    {
      kind: 'detail',
      provider: 'claude',
      label: 'Resets',
      value: formatResetsInMs(resetsInMs),
    },
  ];
}

export function codexStatusLabel(snapshot: CodexUsageSnapshot | null): string {
  if (snapshot === null) {
    return 'Not loaded';
  }
  if (snapshot.error !== null) {
    return 'Error';
  }
  if (
    snapshot.slots.length > 0 &&
    snapshot.slots.every(slot => slot.rateLimitReached)
  ) {
    return 'Rate limited';
  }
  if (snapshot.slots.some(slot => slot.rateLimitReached)) {
    return 'Partially limited';
  }
  return 'Available';
}

export function codexDetails(
  snapshot: CodexUsageSnapshot | null
): readonly UsageDetailNode[] {
  if (snapshot === null) {
    return [
      {
        kind: 'detail',
        provider: 'codex',
        label: 'Status',
        value: 'Not yet refreshed',
      },
    ];
  }

  if (snapshot.error !== null) {
    return [
      {
        kind: 'detail',
        provider: 'codex',
        label: 'Error',
        value: snapshot.error,
      },
    ];
  }

  return snapshot.slots.map(slot => ({
    kind: 'detail',
    provider: 'codex',
    label: slot.label,
    value: slot.authenticated
      ? `${
          slot.usedPercent !== null && slot.usedPercent !== undefined
            ? `${slot.usedPercent}%`
            : '—'
        } / ${slot.confidence}`
      : 'not authenticated',
  }));
}

export function agyStatusLabel(snapshot: AgyUsageSnapshot | null): string {
  if (snapshot === null) {
    return 'Not loaded';
  }
  switch (snapshot.status) {
    case 'ok':
      return 'Available';
    case 'usage_limit':
      return 'Quota exhausted';
    case 'unknown':
    default:
      return 'Unknown';
  }
}

export function agyDetails(
  snapshot: AgyUsageSnapshot | null
): readonly UsageDetailNode[] {
  if (snapshot === null) {
    return [
      {
        kind: 'detail',
        provider: 'antigravity',
        label: 'Status',
        value: 'Not yet refreshed',
      },
    ];
  }

  if (snapshot.error !== null) {
    return [
      {
        kind: 'detail',
        provider: 'antigravity',
        label: 'Error',
        value: snapshot.error,
      },
    ];
  }

  if (snapshot.status === 'usage_limit') {
    return [
      {
        kind: 'detail',
        provider: 'antigravity',
        label: 'Status',
        value:
          'Quota unavailable — agy route attempts will fall back to next route',
      },
    ];
  }

  if (snapshot.status === 'ok') {
    const receipt = snapshot.latestReceipt;
    const model = receipt?.model || 'unknown';
    const duration = receipt ? `${receipt.durationMs}ms` : '0ms';
    return [
      {
        kind: 'detail',
        provider: 'antigravity',
        label: 'Latest receipt',
        value: `${model} (${duration})`,
      },
    ];
  }

  return [
    {
      kind: 'detail',
      provider: 'antigravity',
      label: 'Status',
      value: 'No valid route receipts found',
    },
  ];
}

export interface UsageTree {
  update(
    claude: ClaudeUsageState,
    codex: CodexUsageSnapshot | null,
    agy: AgyUsageSnapshot | null
  ): void;
  getChildren(element?: UsageTreeElement): readonly UsageTreeElement[];
  onDidChange(listener: () => void): { dispose(): void };
}

export function createUsageTree(): UsageTree {
  let claudeState: ClaudeUsageState = { status: 'missing', reason: 'no-file' };
  let codexSnapshot: CodexUsageSnapshot | null = null;
  let agySnapshot: AgyUsageSnapshot | null = null;

  const listeners = new Set<() => void>();

  function update(
    claude: ClaudeUsageState,
    codex: CodexUsageSnapshot | null,
    agy: AgyUsageSnapshot | null
  ): void {
    claudeState = claude;
    codexSnapshot = codex;
    agySnapshot = agy;
    for (const listener of listeners) {
      listener();
    }
  }

  function getClaudeObservedAt(state: ClaudeUsageState): string | null {
    if (state.status === 'fresh' || state.status === 'stale') {
      return formatObservedAt(state.observation.writtenAt);
    }
    return null;
  }

  function getChildren(
    element?: UsageTreeElement
  ): readonly UsageTreeElement[] {
    if (element === undefined) {
      return [
        {
          kind: 'provider',
          provider: 'claude',
          label: 'Claude',
          statusLabel: claudeStatusLabel(claudeState),
          observedAt: getClaudeObservedAt(claudeState),
        },
        {
          kind: 'provider',
          provider: 'codex',
          label: 'Codex',
          statusLabel: codexStatusLabel(codexSnapshot),
          observedAt: formatObservedAt(codexSnapshot?.fetchedAt ?? null),
        },
        {
          kind: 'provider',
          provider: 'antigravity',
          label: 'Antigravity',
          statusLabel: agyStatusLabel(agySnapshot),
          observedAt: formatObservedAt(agySnapshot?.fetchedAt ?? null),
        },
      ];
    }

    if (element.kind === 'provider') {
      switch (element.provider) {
        case 'claude':
          return claudeDetails(claudeState);
        case 'codex':
          return codexDetails(codexSnapshot);
        case 'antigravity':
          return agyDetails(agySnapshot);
      }
    }

    return [];
  }

  function onDidChange(listener: () => void): { dispose(): void } {
    listeners.add(listener);
    return {
      dispose(): void {
        listeners.delete(listener);
      },
    };
  }

  return {
    update,
    getChildren,
    onDidChange,
  };
}
