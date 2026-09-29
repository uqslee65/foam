import { describe, expect, it } from 'vitest';
import {
  createUsageTree,
  claudeStatusLabel,
  claudeDetails,
  codexStatusLabel,
  codexDetails,
  agyStatusLabel,
  agyDetails,
  formatObservedAt,
  type UsageProviderNode,
  type UsageDetailNode,
} from '../usage/tree';
import type { ClaudeUsageState } from '../usage/claude';
import type { CodexUsageSnapshot } from '../usage/codex';
import type { AgyUsageSnapshot } from '../usage/antigravity';

describe('usage view domain', () => {
  it('test_usage_view_claude_status_fresh', () => {
    const state: ClaudeUsageState = {
      status: 'fresh',
      observation: {
        fiveHour: null,
        sevenDay: null,
        model: { id: 'claude-3-7-sonnet', displayName: 'Claude 3.7 Sonnet' },
        writtenAt: 1700000000000,
        ageMs: 1000,
      },
    };
    expect(claudeStatusLabel(state)).toBe('Active');
  });

  it('test_usage_view_claude_status_missing', () => {
    const state: ClaudeUsageState = { status: 'missing', reason: 'no-file' };
    expect(claudeStatusLabel(state)).toBe('Not available');
  });

  it('test_usage_view_claude_status_stale', () => {
    const state: ClaudeUsageState = {
      status: 'stale',
      observation: {
        fiveHour: null,
        sevenDay: null,
        model: { id: 'claude-3-7-sonnet', displayName: 'Claude 3.7 Sonnet' },
        writtenAt: 1700000000000,
        ageMs: 700000,
      },
    };
    expect(claudeStatusLabel(state)).toBe('Stale');
  });

  it('test_usage_view_claude_status_invalid', () => {
    const state: ClaudeUsageState = {
      status: 'invalid',
      reason: 'parse',
      detail: 'Unexpected token',
    };
    expect(claudeStatusLabel(state)).toBe('Invalid data');
  });

  it('test_usage_view_claude_details_fresh', () => {
    const state: ClaudeUsageState = {
      status: 'fresh',
      observation: {
        fiveHour: {
          usedPercentage: 42,
          resetsAt: 1700008100000,
          resetsInMs: (2 * 60 + 15) * 60 * 1000,
        },
        sevenDay: {
          usedPercentage: 7,
          resetsAt: 1700100000000,
          resetsInMs: 24 * 60 * 60 * 1000,
        },
        model: {
          id: 'claude-3-7-sonnet',
          displayName: 'Claude 3.7 Sonnet',
        },
        writtenAt: 1700000000000,
        ageMs: 5000,
      },
    };
    const details = claudeDetails(state);
    expect(details).toHaveLength(4);
    expect(details[0]).toEqual({
      kind: 'detail',
      provider: 'claude',
      label: '5h window',
      value: '42%',
    });
    expect(details[1]).toEqual({
      kind: 'detail',
      provider: 'claude',
      label: '7d window',
      value: '7%',
    });
    expect(details[2]).toEqual({
      kind: 'detail',
      provider: 'claude',
      label: 'Model',
      value: 'claude-3-7-sonnet',
    });
    expect(details[3]).toEqual({
      kind: 'detail',
      provider: 'claude',
      label: 'Resets',
      value: '2h 15m',
    });
  });

  it('test_usage_view_claude_details_null_windows', () => {
    const state: ClaudeUsageState = {
      status: 'fresh',
      observation: {
        fiveHour: null,
        sevenDay: null,
        model: { id: '', displayName: '' },
        writtenAt: 1700000000000,
        ageMs: 5000,
      },
    };
    const details = claudeDetails(state);
    expect(details).toHaveLength(4);
    expect(details[0].value).toBe('—');
    expect(details[1].value).toBe('—');
    expect(details[2].value).toBe('—');
    expect(details[3].value).toBe('—');
  });

  it('test_usage_view_claude_details_model_truncation', () => {
    const longModel = 'a'.repeat(60);
    const state: ClaudeUsageState = {
      status: 'fresh',
      observation: {
        fiveHour: null,
        sevenDay: null,
        model: { id: longModel, displayName: 'Long Model' },
        writtenAt: 1700000000000,
        ageMs: 5000,
      },
    };
    const details = claudeDetails(state);
    expect(details[2].value).toBe('a'.repeat(50));
  });

  it('test_usage_view_claude_details_missing', () => {
    const state: ClaudeUsageState = { status: 'missing', reason: 'no-dir' };
    const details = claudeDetails(state);
    expect(details).toHaveLength(1);
    expect(details[0]).toEqual({
      kind: 'detail',
      provider: 'claude',
      label: 'Reason',
      value: 'no-dir',
    });
  });

  it('test_usage_view_claude_details_invalid', () => {
    const state: ClaudeUsageState = {
      status: 'invalid',
      reason: 'schema',
      detail: 'missing five_hour',
    };
    const details = claudeDetails(state);
    expect(details).toHaveLength(1);
    expect(details[0]).toEqual({
      kind: 'detail',
      provider: 'claude',
      label: 'Reason',
      value: 'schema: missing five_hour',
    });
  });

  it('test_usage_view_codex_status_available', () => {
    const snapshot: CodexUsageSnapshot = {
      slots: [
        {
          slot: 'slot-1',
          label: 'primary',
          authenticated: true,
          usedPercent: 20,
          confidence: 'fresh',
          rateLimitReached: false,
        },
      ],
      fetchedAt: 1700000000000,
      error: null,
    };
    expect(codexStatusLabel(snapshot)).toBe('Available');
  });

  it('test_usage_view_codex_status_limited', () => {
    const snapshot: CodexUsageSnapshot = {
      slots: [
        {
          slot: 'slot-1',
          label: 'primary',
          authenticated: true,
          usedPercent: 100,
          confidence: 'exhausted',
          rateLimitReached: true,
        },
        {
          slot: 'slot-2',
          label: 'secondary',
          authenticated: true,
          usedPercent: 100,
          confidence: 'exhausted',
          rateLimitReached: true,
        },
      ],
      fetchedAt: 1700000000000,
      error: null,
    };
    expect(codexStatusLabel(snapshot)).toBe('Rate limited');
  });

  it('test_usage_view_codex_status_partially_limited', () => {
    const snapshot: CodexUsageSnapshot = {
      slots: [
        {
          slot: 'slot-1',
          label: 'primary',
          authenticated: true,
          usedPercent: 100,
          confidence: 'exhausted',
          rateLimitReached: true,
        },
        {
          slot: 'slot-2',
          label: 'secondary',
          authenticated: true,
          usedPercent: 30,
          confidence: 'fresh',
          rateLimitReached: false,
        },
      ],
      fetchedAt: 1700000000000,
      error: null,
    };
    expect(codexStatusLabel(snapshot)).toBe('Partially limited');
  });

  it('test_usage_view_codex_status_error', () => {
    const snapshot: CodexUsageSnapshot = {
      slots: [],
      fetchedAt: 1700000000000,
      error: 'runner_error',
    };
    expect(codexStatusLabel(snapshot)).toBe('Error');
  });

  it('test_usage_view_codex_status_null', () => {
    expect(codexStatusLabel(null)).toBe('Not loaded');
  });

  it('test_usage_view_codex_details_slots', () => {
    const snapshot: CodexUsageSnapshot = {
      slots: [
        {
          slot: 's1',
          label: 'primary',
          authenticated: true,
          usedPercent: 42,
          confidence: 'fresh',
          rateLimitReached: false,
        },
        {
          slot: 's2',
          label: 'secondary',
          authenticated: false,
          usedPercent: null,
          confidence: 'low',
          rateLimitReached: false,
        },
      ],
      fetchedAt: 1700000000000,
      error: null,
    };
    const details = codexDetails(snapshot);
    expect(details).toHaveLength(2);
    expect(details[0]).toEqual({
      kind: 'detail',
      provider: 'codex',
      label: 'primary',
      value: '42% / fresh',
    });
    expect(details[1]).toEqual({
      kind: 'detail',
      provider: 'codex',
      label: 'secondary',
      value: 'not authenticated',
    });
  });

  it('test_usage_view_codex_details_null', () => {
    const details = codexDetails(null);
    expect(details).toHaveLength(1);
    expect(details[0]).toEqual({
      kind: 'detail',
      provider: 'codex',
      label: 'Status',
      value: 'Not yet refreshed',
    });
  });

  it('test_usage_view_codex_details_error', () => {
    const snapshot: CodexUsageSnapshot = {
      slots: [],
      fetchedAt: 1700000000000,
      error: 'parse_error',
    };
    const details = codexDetails(snapshot);
    expect(details).toHaveLength(1);
    expect(details[0]).toEqual({
      kind: 'detail',
      provider: 'codex',
      label: 'Error',
      value: 'parse_error',
    });
  });

  it('test_usage_view_codex_details_null_used_percent', () => {
    const snapshot: CodexUsageSnapshot = {
      slots: [
        {
          slot: 's1',
          label: 'backup',
          authenticated: true,
          usedPercent: null,
          confidence: 'unknown',
          rateLimitReached: false,
        },
      ],
      fetchedAt: 1700000000000,
      error: null,
    };
    const details = codexDetails(snapshot);
    expect(details[0].value).toBe('— / unknown');
  });

  it('test_usage_view_agy_status_ok', () => {
    const snapshot: AgyUsageSnapshot = {
      status: 'ok',
      latestReceipt: {
        timestamp: '2026-09-26T14:00:00Z',
        route: 'agy',
        model: 'gemini-3.8-flash',
        success: true,
        usageLimit: false,
        durationMs: 1200,
      },
      fetchedAt: 1700000000000,
      error: null,
    };
    expect(agyStatusLabel(snapshot)).toBe('Available');
  });

  it('test_usage_view_agy_status_quota', () => {
    const snapshot: AgyUsageSnapshot = {
      status: 'usage_limit',
      latestReceipt: null,
      fetchedAt: 1700000000000,
      error: null,
    };
    expect(agyStatusLabel(snapshot)).toBe('Quota exhausted');
  });

  it('test_usage_view_agy_status_null', () => {
    expect(agyStatusLabel(null)).toBe('Not loaded');
  });

  it('test_usage_view_agy_status_unknown', () => {
    const snapshot: AgyUsageSnapshot = {
      status: 'unknown',
      latestReceipt: null,
      fetchedAt: 1700000000000,
      error: null,
    };
    expect(agyStatusLabel(snapshot)).toBe('Unknown');
  });

  it('test_usage_view_agy_details_quota', () => {
    const snapshot: AgyUsageSnapshot = {
      status: 'usage_limit',
      latestReceipt: null,
      fetchedAt: 1700000000000,
      error: null,
    };
    const details = agyDetails(snapshot);
    expect(details).toHaveLength(1);
    expect(details[0].provider).toBe('antigravity');
    expect(details[0].kind).toBe('detail');
    expect(details[0].value).toBe(
      'Quota unavailable — agy route attempts will fall back to next route'
    );
    expect(details[0].value).toContain('fall back');
  });

  it('test_usage_view_agy_details_null', () => {
    const details = agyDetails(null);
    expect(details).toHaveLength(1);
    expect(details[0]).toEqual({
      kind: 'detail',
      provider: 'antigravity',
      label: 'Status',
      value: 'Not yet refreshed',
    });
  });

  it('test_usage_view_agy_details_error', () => {
    const snapshot: AgyUsageSnapshot = {
      status: 'unknown',
      latestReceipt: null,
      fetchedAt: 1700000000000,
      error: 'no_receipts',
    };
    const details = agyDetails(snapshot);
    expect(details).toHaveLength(1);
    expect(details[0]).toEqual({
      kind: 'detail',
      provider: 'antigravity',
      label: 'Error',
      value: 'no_receipts',
    });
  });

  it('test_usage_view_agy_details_ok', () => {
    const snapshot: AgyUsageSnapshot = {
      status: 'ok',
      latestReceipt: {
        timestamp: '2026-09-26T14:00:00Z',
        route: 'agy',
        model: 'gemini-3.8-flash',
        success: true,
        usageLimit: false,
        durationMs: 1200,
      },
      fetchedAt: 1700000000000,
      error: null,
    };
    const details = agyDetails(snapshot);
    expect(details).toHaveLength(1);
    expect(details[0]).toEqual({
      kind: 'detail',
      provider: 'antigravity',
      label: 'Latest receipt',
      value: 'gemini-3.8-flash (1200ms)',
    });
  });

  it('test_usage_view_agy_details_unknown', () => {
    const snapshot: AgyUsageSnapshot = {
      status: 'unknown',
      latestReceipt: null,
      fetchedAt: 1700000000000,
      error: null,
    };
    const details = agyDetails(snapshot);
    expect(details).toHaveLength(1);
    expect(details[0]).toEqual({
      kind: 'detail',
      provider: 'antigravity',
      label: 'Status',
      value: 'No valid route receipts found',
    });
  });

  it('test_usage_view_tree_root_children', () => {
    const tree = createUsageTree();
    const roots = tree.getChildren(undefined);
    expect(roots).toHaveLength(3);
    expect(roots.every(r => r.kind === 'provider')).toBe(true);
    const providers = (roots as UsageProviderNode[]).map(r => r.provider);
    expect(providers).toEqual(['claude', 'codex', 'antigravity']);
    const labels = (roots as UsageProviderNode[]).map(r => r.label);
    expect(labels).toEqual(['Claude', 'Codex', 'Antigravity']);
  });

  it('test_usage_view_tree_provider_children', () => {
    const tree = createUsageTree();
    const roots = tree.getChildren(undefined);
    const claudeNode = roots.find(
      r => (r as UsageProviderNode).provider === 'claude'
    )!;
    const details = tree.getChildren(claudeNode);
    expect(details.length).toBeGreaterThan(0);
    expect(details.every(d => d.kind === 'detail')).toBe(true);
    expect(tree.getChildren(details[0])).toEqual([]);
  });

  it('test_usage_view_tree_update_fires', () => {
    const tree = createUsageTree();
    let calls = 0;
    tree.onDidChange(() => {
      calls += 1;
    });
    tree.update({ status: 'missing', reason: 'no-dir' }, null, null);
    expect(calls).toBe(1);
  });

  it('test_usage_view_tree_dispose', () => {
    const tree = createUsageTree();
    let calls = 0;
    const subscription = tree.onDidChange(() => {
      calls += 1;
    });
    subscription.dispose();
    tree.update({ status: 'missing', reason: 'no-dir' }, null, null);
    expect(calls).toBe(0);
  });

  it('test_usage_view_tree_update_reflects_in_children', () => {
    const tree = createUsageTree();
    const claudeFresh: ClaudeUsageState = {
      status: 'fresh',
      observation: {
        fiveHour: {
          usedPercentage: 50,
          resetsAt: 1700000000000,
          resetsInMs: 3600000,
        },
        sevenDay: null,
        model: { id: 'claude-3-opus', displayName: 'Opus' },
        writtenAt: 1700000000000,
        ageMs: 2000,
      },
    };
    const codexSnapshot: CodexUsageSnapshot = {
      slots: [
        {
          slot: 'slot-1',
          label: 'main',
          authenticated: true,
          usedPercent: 10,
          confidence: 'high',
          rateLimitReached: false,
        },
      ],
      fetchedAt: 1700000000000,
      error: null,
    };
    const agySnapshot: AgyUsageSnapshot = {
      status: 'ok',
      latestReceipt: {
        timestamp: '2026-09-26T14:00:00Z',
        route: 'agy',
        model: 'gemini-2.5-flash',
        success: true,
        usageLimit: false,
        durationMs: 800,
      },
      fetchedAt: 1700000000000,
      error: null,
    };

    tree.update(claudeFresh, codexSnapshot, agySnapshot);
    const roots = tree.getChildren(undefined) as UsageProviderNode[];

    expect(roots[0].statusLabel).toBe('Active');
    expect(roots[0].observedAt).toBe(formatObservedAt(1700000000000));
    expect(roots[1].statusLabel).toBe('Available');
    expect(roots[1].observedAt).toBe(formatObservedAt(1700000000000));
    expect(roots[2].statusLabel).toBe('Available');
    expect(roots[2].observedAt).toBe(formatObservedAt(1700000000000));

    const claudeChildren = tree.getChildren(roots[0]) as UsageDetailNode[];
    expect(claudeChildren).toHaveLength(4);
    expect(claudeChildren[0].value).toBe('50%');

    const codexChildren = tree.getChildren(roots[1]) as UsageDetailNode[];
    expect(codexChildren).toHaveLength(1);
    expect(codexChildren[0].value).toBe('10% / high');

    const agyChildren = tree.getChildren(roots[2]) as UsageDetailNode[];
    expect(agyChildren).toHaveLength(1);
    expect(agyChildren[0].value).toBe('gemini-2.5-flash (800ms)');
  });

  it('test_usage_view_format_observed_at', () => {
    const timestamp = Date.now();
    const formatted = formatObservedAt(timestamp);
    expect(formatted).not.toBeNull();
    expect(formatted).toMatch(/^Observed \d{2}:\d{2}:\d{2}$/);
  });

  it('test_usage_view_format_observed_at_null', () => {
    expect(formatObservedAt(null)).toBeNull();
    expect(formatObservedAt(0)).toBeNull();
    expect(formatObservedAt(-1)).toBeNull();
    expect(formatObservedAt(Number.NaN)).toBeNull();
  });
});
