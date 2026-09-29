import { describe, expect, it } from 'vitest';
import {
  parseReceipt,
  resolveStatus,
  selectNewestReceipt,
  createAgyUsageSnapshot,
  type RouteReceipt,
  type AgyStatus,
} from '../usage/antigravity';

describe('Antigravity usage domain', () => {
  it('test_agy_usage_parse_valid_receipt', () => {
    const raw = JSON.stringify({
      timestamp: '2026-09-26T14:00:00Z',
      route: 'agy',
      model: 'gemini-3.8-flash',
      success: true,
      usage_limit: false,
      duration_ms: 1200,
    });

    const parsed = parseReceipt(raw);
    expect(parsed).toEqual({
      timestamp: '2026-09-26T14:00:00Z',
      route: 'agy',
      model: 'gemini-3.8-flash',
      success: true,
      usageLimit: false,
      durationMs: 1200,
    });
  });

  it('test_agy_usage_parse_non_agy_route', () => {
    const raw = JSON.stringify({
      timestamp: '2026-09-26T14:00:00Z',
      route: 'codex',
      model: 'o3-mini',
      success: true,
      usage_limit: false,
      duration_ms: 500,
    });

    expect(parseReceipt(raw)).toBeNull();
  });

  it('test_agy_usage_parse_invalid_json', () => {
    expect(parseReceipt('invalid json {')).toBeNull();
    expect(parseReceipt('')).toBeNull();
  });

  it('test_agy_usage_parse_missing_fields', () => {
    expect(parseReceipt(JSON.stringify({ route: 'agy', success: true }))).toBeNull();
    expect(
      parseReceipt(JSON.stringify({ timestamp: '2026-09-26T14:00:00Z', success: true }))
    ).toBeNull();
    expect(
      parseReceipt(JSON.stringify({ timestamp: '2026-09-26T14:00:00Z', route: 'agy' }))
    ).toBeNull();
    expect(parseReceipt('123')).toBeNull();
    expect(parseReceipt('[]')).toBeNull();
    expect(parseReceipt('null')).toBeNull();
  });

  it('test_agy_usage_parse_defaults', () => {
    const raw = JSON.stringify({
      timestamp: '2026-09-26T14:00:00Z',
      route: 'agy',
      success: true,
    });

    const parsed = parseReceipt(raw);
    expect(parsed).toEqual({
      timestamp: '2026-09-26T14:00:00Z',
      route: 'agy',
      model: '',
      success: true,
      usageLimit: false,
      durationMs: 0,
    });
  });

  it('test_agy_usage_resolve_ok', () => {
    const receipt: RouteReceipt = {
      timestamp: '2026-09-26T14:00:00Z',
      route: 'agy',
      model: 'gemini-3.8-flash',
      success: true,
      usageLimit: false,
      durationMs: 1200,
    };

    const status: AgyStatus = resolveStatus(receipt);
    expect(status).toBe('ok');
  });

  it('test_agy_usage_resolve_usage_limit', () => {
    const receiptLimitOnly: RouteReceipt = {
      timestamp: '2026-09-26T14:00:00Z',
      route: 'agy',
      model: 'gemini-3.8-flash',
      success: false,
      usageLimit: true,
      durationMs: 50,
    };
    expect(resolveStatus(receiptLimitOnly)).toBe('usage_limit');

    const receiptSuccessAndLimit: RouteReceipt = {
      timestamp: '2026-09-26T14:00:00Z',
      route: 'agy',
      model: 'gemini-3.8-flash',
      success: true,
      usageLimit: true,
      durationMs: 50,
    };
    expect(resolveStatus(receiptSuccessAndLimit)).toBe('usage_limit');
  });

  it('test_agy_usage_resolve_unknown', () => {
    const receipt: RouteReceipt = {
      timestamp: '2026-09-26T14:00:00Z',
      route: 'agy',
      model: 'gemini-3.8-flash',
      success: false,
      usageLimit: false,
      durationMs: 1200,
    };

    expect(resolveStatus(receipt)).toBe('unknown');
  });

  it('test_agy_usage_resolve_null_receipt', () => {
    expect(resolveStatus(null)).toBe('unknown');
  });

  it('test_agy_usage_select_newest', () => {
    const r1 = JSON.stringify({
      timestamp: '2026-09-26T13:00:00Z',
      route: 'agy',
      model: 'gemini-3.8-flash',
      success: true,
      usage_limit: false,
      duration_ms: 100,
    });
    const r2 = JSON.stringify({
      timestamp: '2026-09-26T15:00:00Z',
      route: 'agy',
      model: 'gemini-3.8-flash',
      success: true,
      usage_limit: false,
      duration_ms: 200,
    });
    const r3 = JSON.stringify({
      timestamp: '2026-09-26T14:00:00Z',
      route: 'agy',
      model: 'gemini-3.8-flash',
      success: true,
      usage_limit: false,
      duration_ms: 150,
    });

    const newest = selectNewestReceipt([r1, r2, r3]);
    expect(newest).not.toBeNull();
    expect(newest?.timestamp).toBe('2026-09-26T15:00:00Z');
    expect(newest?.durationMs).toBe(200);
  });

  it('test_agy_usage_select_empty', () => {
    expect(selectNewestReceipt([])).toBeNull();
    expect(selectNewestReceipt(['invalid', '{"route":"codex"}'])).toBeNull();
  });

  it('test_agy_usage_snapshot_valid', () => {
    const r1 = JSON.stringify({
      timestamp: '2026-09-26T13:00:00Z',
      route: 'agy',
      model: 'gemini-3.8-flash',
      success: false,
      usage_limit: true,
      duration_ms: 100,
    });
    const r2 = JSON.stringify({
      timestamp: '2026-09-26T15:00:00Z',
      route: 'agy',
      model: 'gemini-3.8-flash',
      success: true,
      usage_limit: false,
      duration_ms: 200,
    });

    const snapshot = createAgyUsageSnapshot([r1, r2]);
    expect(snapshot.status).toBe('ok');
    expect(snapshot.error).toBeNull();
    expect(snapshot.latestReceipt?.timestamp).toBe('2026-09-26T15:00:00Z');
    expect(snapshot.fetchedAt).toBeGreaterThan(0);
  });

  it('test_agy_usage_snapshot_no_receipts', () => {
    const snapshot = createAgyUsageSnapshot([]);
    expect(snapshot.status).toBe('unknown');
    expect(snapshot.latestReceipt).toBeNull();
    expect(snapshot.error).toBe('no_receipts');
    expect(snapshot.fetchedAt).toBeGreaterThan(0);
  });

  it('test_agy_usage_snapshot_all_invalid', () => {
    const snapshot = createAgyUsageSnapshot([
      'not-json',
      JSON.stringify({ route: 'claude' }),
    ]);
    expect(snapshot.status).toBe('unknown');
    expect(snapshot.latestReceipt).toBeNull();
    expect(snapshot.error).toBe('no_valid_receipts');
    expect(snapshot.fetchedAt).toBeGreaterThan(0);
  });
});
