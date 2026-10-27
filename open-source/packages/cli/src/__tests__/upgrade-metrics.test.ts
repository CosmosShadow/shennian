// @covers open-source/packages/cli/src/log-reporter.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  initCliLogReporter,
  reportUpgradeAggregateMetric,
} from '../log-reporter.js'

describe('upgrade aggregate metrics', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('only emits the privacy-reviewed aggregate schema', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(null, { status: 200 }),
    )
    vi.stubGlobal('fetch', fetch)
    initCliLogReporter('https://example.test/', 'machine-must-not-be-sent')
    reportUpgradeAggregateMetric({
      kind: 'recovery',
      result: 'continued',
      adapterType: 'custom:fixture',
      stage: 'continue',
      durationMs: 1250,
      retries: 1,
      errorCode: 'none',
    })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    const calls = fetch.mock.calls as unknown as Array<[string, RequestInit]>
    const body = JSON.parse(String(calls[0]?.[1]?.body))
    expect(body).toMatchObject({
      source: 'cli',
      type: 'internal',
      wsEvent: 'upgrade.recovery.outcome',
      metadata: {
        kind: 'recovery', result: 'continued', adapterType: 'custom:fixture',
        stage: 'continue', durationMs: 1250, retries: 1, errorCode: 'none',
      },
    })
    expect(body).not.toHaveProperty('machineId')
    for (const forbidden of [
      'sessionId', 'agentSessionId', 'workDir', 'prompt', 'todo', 'tool',
      'attachment', 'stderr', 'token',
    ]) expect(JSON.stringify(body).toLowerCase()).not.toContain(forbidden.toLowerCase())
  })

  it('normalizes untrusted dimensions and bounds counters', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(null, { status: 200 }),
    )
    vi.stubGlobal('fetch', fetch)
    reportUpgradeAggregateMetric({
      kind: 'recovery', result: 'recovery_failed', adapterType: '/private/path with spaces',
      stage: 'terminal', durationMs: Number.MAX_SAFE_INTEGER, retries: 999,
      errorCode: 'secret=value with spaces',
    })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    const calls = fetch.mock.calls as unknown as Array<[string, RequestInit]>
    const body = JSON.parse(String(calls[0]?.[1]?.body))
    expect(body.level).toBe('warn')
    expect(body.metadata).toMatchObject({
      adapterType: 'unknown', errorCode: 'unknown', durationMs: 86_400_000, retries: 100,
    })
  })
})
