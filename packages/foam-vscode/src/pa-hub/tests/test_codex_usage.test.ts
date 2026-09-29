import { describe, expect, it } from 'vitest';
import {
  parseCodexOutput,
  createCodexUsageProvider,
  type CodexUsageSnapshot,
} from '../usage/codex';

describe('Codex usage domain', () => {
  it('test_codex_usage_parse_valid_output', () => {
    const raw = JSON.stringify({
      slots: [
        {
          slot: 'a',
          label: 'primary',
          authenticated: true,
          used_percent: 28.0,
          confidence: 'fresh',
          rate_limit_reached_type: null,
        },
        {
          slot: 'b',
          label: 'secondary',
          authenticated: true,
          used_percent: null,
          confidence: 'exhausted',
          rate_limit_reached_type: null,
        },
      ],
    });

    const snapshot = parseCodexOutput(raw);
    expect(snapshot.error).toBeNull();
    expect(snapshot.slots).toHaveLength(2);
    expect(snapshot.slots[0]).toEqual({
      slot: 'a',
      label: 'primary',
      authenticated: true,
      usedPercent: 28.0,
      confidence: 'fresh',
      rateLimitReached: false,
    });
    expect(snapshot.slots[1]).toEqual({
      slot: 'b',
      label: 'secondary',
      authenticated: true,
      usedPercent: null,
      confidence: 'exhausted',
      rateLimitReached: false,
    });
    expect(snapshot.fetchedAt).toBeGreaterThan(0);
  });

  it('test_codex_usage_parse_used_percent_number', () => {
    const raw = JSON.stringify({
      slots: [
        {
          slot: 'a',
          label: 'primary',
          authenticated: true,
          used_percent: 45.5,
          confidence: 'fresh',
          rate_limit_reached_type: null,
        },
      ],
    });

    const snapshot = parseCodexOutput(raw);
    expect(snapshot.error).toBeNull();
    expect(snapshot.slots[0].usedPercent).toBe(45.5);
  });

  it('test_codex_usage_parse_used_percent_null', () => {
    const raw = JSON.stringify({
      slots: [
        {
          slot: 'b',
          label: 'secondary',
          authenticated: true,
          used_percent: null,
          confidence: 'exhausted',
          rate_limit_reached_type: null,
        },
      ],
    });

    const snapshot = parseCodexOutput(raw);
    expect(snapshot.error).toBeNull();
    expect(snapshot.slots[0].usedPercent).toBeNull();
  });

  it('test_codex_usage_parse_rate_limit_reached', () => {
    const raw = JSON.stringify({
      slots: [
        {
          slot: 'a',
          label: 'primary',
          authenticated: true,
          used_percent: 100,
          confidence: 'exhausted',
          rate_limit_reached_type: 'token_limit',
        },
      ],
    });

    const snapshot = parseCodexOutput(raw);
    expect(snapshot.error).toBeNull();
    expect(snapshot.slots[0].rateLimitReached).toBe(true);
  });

  it('test_codex_usage_parse_rate_limit_not_reached', () => {
    const raw = JSON.stringify({
      slots: [
        {
          slot: 'a',
          label: 'primary',
          authenticated: true,
          used_percent: 10,
          confidence: 'fresh',
          rate_limit_reached_type: null,
        },
      ],
    });

    const snapshot = parseCodexOutput(raw);
    expect(snapshot.error).toBeNull();
    expect(snapshot.slots[0].rateLimitReached).toBe(false);
  });

  it('test_codex_usage_parse_invalid_json', () => {
    const snapshot = parseCodexOutput('{ invalid json content');
    expect(snapshot.error).toBe('parse_error');
    expect(snapshot.slots).toEqual([]);
    expect(snapshot.fetchedAt).toBeGreaterThan(0);
  });

  it('test_codex_usage_parse_missing_slots', () => {
    const snapshot = parseCodexOutput(JSON.stringify({ status: 'ok' }));
    expect(snapshot.error).toBe('parse_error');
    expect(snapshot.slots).toEqual([]);
    expect(snapshot.fetchedAt).toBeGreaterThan(0);
  });

  it('test_codex_usage_parse_empty_string', () => {
    const snapshot = parseCodexOutput('');
    expect(snapshot.error).toBe('parse_error');
    expect(snapshot.slots).toEqual([]);
    expect(snapshot.fetchedAt).toBeGreaterThan(0);
  });

  it('test_codex_usage_provider_refresh', async () => {
    const raw = JSON.stringify({
      slots: [
        {
          slot: 'a',
          label: 'primary',
          authenticated: true,
          used_percent: 33,
          confidence: 'fresh',
          rate_limit_reached_type: null,
        },
      ],
    });

    let calls = 0;
    const runner = async () => {
      calls++;
      return raw;
    };

    const provider = createCodexUsageProvider(runner);
    const snapshot: CodexUsageSnapshot = await provider.refresh();

    expect(calls).toBe(1);
    expect(snapshot.error).toBeNull();
    expect(snapshot.slots).toHaveLength(1);
    expect(snapshot.slots[0].slot).toBe('a');
  });

  it('test_codex_usage_provider_latest_null_before_refresh', () => {
    const provider = createCodexUsageProvider(async () => '');
    expect(provider.latest()).toBeNull();
  });

  it('test_codex_usage_provider_latest_after_refresh', async () => {
    const raw = JSON.stringify({
      slots: [
        {
          slot: 'a',
          label: 'primary',
          authenticated: true,
          used_percent: 15,
          confidence: 'fresh',
          rate_limit_reached_type: null,
        },
      ],
    });

    const provider = createCodexUsageProvider(async () => raw);
    expect(provider.latest()).toBeNull();

    const snapshot = await provider.refresh();
    expect(provider.latest()).toBe(snapshot);
  });

  it('test_codex_usage_provider_runner_error', async () => {
    const provider = createCodexUsageProvider(async () => {
      throw new Error('runner execution failed');
    });

    const snapshot = await provider.refresh();
    expect(snapshot.error).toBe('runner_error');
    expect(snapshot.slots).toEqual([]);
    expect(snapshot.fetchedAt).toBeGreaterThan(0);
    expect(provider.latest()).toBe(snapshot);
  });

  it('test_codex_usage_provider_single_flight', async () => {
    let runnerCalls = 0;
    let finishRunner!: (output: string) => void;

    const runner = () => {
      runnerCalls++;
      return new Promise<string>(resolve => {
        finishRunner = resolve;
      });
    };

    const provider = createCodexUsageProvider(runner);
    const refresh1 = provider.refresh();
    const refresh2 = provider.refresh();

    expect(runnerCalls).toBe(1);

    finishRunner(
      JSON.stringify({
        slots: [
          {
            slot: 'a',
            label: 'primary',
            authenticated: true,
            used_percent: 50,
            confidence: 'fresh',
            rate_limit_reached_type: null,
          },
        ],
      })
    );

    const [snapshot1, snapshot2] = await Promise.all([refresh1, refresh2]);
    expect(runnerCalls).toBe(1);
    expect(snapshot1).toBe(snapshot2);
    expect(snapshot1.error).toBeNull();
  });
});
