export interface CodexSlotStatus {
  readonly slot: string;
  readonly label: string;
  readonly authenticated: boolean;
  readonly usedPercent: number | null;
  readonly confidence: string;
  readonly rateLimitReached: boolean;
}

export interface CodexUsageSnapshot {
  readonly slots: readonly CodexSlotStatus[];
  readonly fetchedAt: number;
  readonly error: string | null;
}

export type CodexRunner = () => Promise<string>;

export interface CodexUsageProvider {
  refresh(): Promise<CodexUsageSnapshot>;
  latest(): CodexUsageSnapshot | null;
}

export function parseCodexOutput(raw: string): CodexUsageSnapshot {
  const now = Date.now();
  if (typeof raw !== 'string' || raw.trim() === '') {
    return {
      slots: [],
      fetchedAt: now,
      error: 'parse_error',
    };
  }

  try {
    const parsed = JSON.parse(raw);
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      return {
        slots: [],
        fetchedAt: now,
        error: 'parse_error',
      };
    }

    if (!('slots' in parsed) || !Array.isArray(parsed.slots)) {
      return {
        slots: [],
        fetchedAt: now,
        error: 'parse_error',
      };
    }

    const slots: CodexSlotStatus[] = parsed.slots.map(
      (item: Record<string, unknown>) => ({
        slot:
          typeof item?.slot === 'string' ? item.slot : String(item?.slot ?? ''),
        label:
          typeof item?.label === 'string'
            ? item.label
            : String(item?.label ?? ''),
        authenticated: Boolean(item?.authenticated),
        usedPercent:
          typeof item?.used_percent === 'number' &&
          Number.isFinite(item.used_percent)
            ? item.used_percent
            : null,
        confidence:
          typeof item?.confidence === 'string'
            ? item.confidence
            : String(item?.confidence ?? ''),
        rateLimitReached:
          item?.rate_limit_reached_type !== null &&
          item?.rate_limit_reached_type !== undefined,
      })
    );

    return {
      slots,
      fetchedAt: now,
      error: null,
    };
  } catch {
    return {
      slots: [],
      fetchedAt: now,
      error: 'parse_error',
    };
  }
}

export function createCodexUsageProvider(
  runner: CodexRunner
): CodexUsageProvider {
  let latestSnapshot: CodexUsageSnapshot | null = null;
  let inFlight: Promise<CodexUsageSnapshot> | null = null;

  async function executeRefresh(): Promise<CodexUsageSnapshot> {
    let snapshot: CodexUsageSnapshot;
    try {
      const raw = await runner();
      snapshot = parseCodexOutput(raw);
    } catch {
      snapshot = {
        slots: [],
        fetchedAt: Date.now(),
        error: 'runner_error',
      };
    }
    latestSnapshot = snapshot;
    return snapshot;
  }

  function refresh(): Promise<CodexUsageSnapshot> {
    if (inFlight !== null) {
      return inFlight;
    }
    inFlight = executeRefresh().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  function latest(): CodexUsageSnapshot | null {
    return latestSnapshot;
  }

  return {
    refresh,
    latest,
  };
}
