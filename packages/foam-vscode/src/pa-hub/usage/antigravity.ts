export interface RouteReceipt {
  readonly timestamp: string;
  readonly route: string;
  readonly model: string;
  readonly success: boolean;
  readonly usageLimit: boolean;
  readonly durationMs: number;
}

export type AgyStatus = 'ok' | 'usage_limit' | 'unknown';

export interface AgyUsageSnapshot {
  readonly status: AgyStatus;
  readonly latestReceipt: RouteReceipt | null;
  readonly fetchedAt: number;
  readonly error: string | null;
}

export function parseReceipt(raw: string): RouteReceipt | null {
  if (typeof raw !== 'string') {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const record = parsed as Record<string, unknown>;

  if (
    typeof record.timestamp !== 'string' ||
    typeof record.route !== 'string' ||
    typeof record.success !== 'boolean'
  ) {
    return null;
  }

  if (record.route !== 'agy') {
    return null;
  }

  const model =
    typeof record.model === 'string'
      ? record.model
      : '';

  const usageLimit =
    typeof record.usage_limit === 'boolean'
      ? record.usage_limit
      : typeof record.usageLimit === 'boolean'
        ? record.usageLimit
        : false;

  const durationMs =
    typeof record.duration_ms === 'number' && Number.isFinite(record.duration_ms)
      ? record.duration_ms
      : typeof record.durationMs === 'number' && Number.isFinite(record.durationMs)
        ? record.durationMs
        : 0;

  return {
    timestamp: record.timestamp,
    route: record.route,
    model,
    success: record.success,
    usageLimit,
    durationMs,
  };
}

export function resolveStatus(receipt: RouteReceipt | null): AgyStatus {
  if (receipt === null) {
    return 'unknown';
  }

  if (receipt.usageLimit === true) {
    return 'usage_limit';
  }

  if (receipt.success === true) {
    return 'ok';
  }

  return 'unknown';
}

export function selectNewestReceipt(
  receipts: readonly string[]
): RouteReceipt | null {
  const valid: RouteReceipt[] = [];

  for (const raw of receipts) {
    const parsed = parseReceipt(raw);
    if (parsed !== null) {
      valid.push(parsed);
    }
  }

  if (valid.length === 0) {
    return null;
  }

  valid.sort((a, b) => {
    const timeA = Date.parse(a.timestamp);
    const timeB = Date.parse(b.timestamp);
    const diff = timeB - timeA;
    if (!Number.isNaN(diff) && diff !== 0) {
      return diff;
    }
    return b.timestamp.localeCompare(a.timestamp);
  });

  return valid[0];
}

export function createAgyUsageSnapshot(
  receiptContents: readonly string[]
): AgyUsageSnapshot {
  const fetchedAt = Date.now();

  if (receiptContents.length === 0) {
    return {
      status: 'unknown',
      latestReceipt: null,
      fetchedAt,
      error: 'no_receipts',
    };
  }

  const latestReceipt = selectNewestReceipt(receiptContents);
  if (latestReceipt === null) {
    return {
      status: 'unknown',
      latestReceipt: null,
      fetchedAt,
      error: 'no_valid_receipts',
    };
  }

  return {
    status: resolveStatus(latestReceipt),
    latestReceipt,
    fetchedAt,
    error: null,
  };
}
