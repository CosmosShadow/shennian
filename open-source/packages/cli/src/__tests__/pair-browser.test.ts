// @covers open-source/packages/cli/src/commands/pair-browser.ts
// @covers open-source/packages/cli/src/commands/pair.ts

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BrowserPairError,
  browserOpenCommand,
  normalizePairAuthorizationUrl,
  openExternalUrl,
  parsePairModeChoice,
  resolvePairMode,
  runBrowserPairFlow,
  waitForBrowserPairIntent,
} from '../commands/pair-browser.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('browser pairing', () => {
  it('creates an authorization intent, waits for approval, and claims machine credentials once', async () => {
    const events: string[] = []
    const opened: string[] = []
    let statusCalls = 0
    let privateSecret = ''
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url)
      if (target.endsWith('/auth/device-authorizations')) {
        const payload = JSON.parse(String(init?.body)) as Record<string, unknown>
        expect(payload).toMatchObject({
          daemonInstallationId: expect.any(String),
          machineName: 'Build server',
          machineOs: 'linux',
          agentList: ['codex'],
          actionType: 'machine.pair',
          returnTo: '/spaces',
        })
        expect(payload.deviceSecretHash).toMatch(/^[a-f0-9]{64}$/)
        expect(payload.actionPayloadHash).toMatch(/^[a-f0-9]{64}$/)
        return new Response(
          JSON.stringify({
            loginIntentId: 'intent_browser_1',
            publicLoginUrl: 'https://shennian.net/authorize/intent_browser_1',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          }),
          { status: 201 },
        )
      }
      if (target.endsWith('/status')) {
        privateSecret = String(
          (init?.headers as Record<string, string>)['x-shennian-device-secret'],
        )
        statusCalls += 1
        return new Response(
          JSON.stringify({
            status: statusCalls === 1 ? 'waiting_user' : 'approved',
            actionPayloadHash: await createdActionHash(),
          }),
        )
      }
      if (target.endsWith('/claim')) {
        expect((init?.headers as Record<string, string>)['x-shennian-device-secret']).toBe(
          privateSecret,
        )
        return new Response(
          JSON.stringify({
            status: 'claimed',
            actionPayloadHash: await createdActionHash(),
            machineId: 'machine-browser-1',
            machineToken: 'machine-token-browser-1',
            accountNamespaceId: 'a'.repeat(64),
          }),
        )
      }
      throw new Error(`Unexpected URL ${target}`)
    }) as typeof fetch

    const result = await runBrowserPairFlow({
      serverUrl: 'https://shennian.net/',
      machineName: 'Build server',
      machineOs: 'linux',
      agentList: ['codex'],
      pollIntervalMs: 0,
      openUrl: async (url) => {
        opened.push(url)
        return true
      },
      emit: (event) => events.push(event.type),
    })

    expect(opened).toEqual(['https://shennian.net/authorize/intent_browser_1'])
    expect(events).toEqual(['pair.browser.created', 'pair.waiting', 'pair.claimed'])
    expect(result).toMatchObject({
      machineId: 'machine-browser-1',
      machineToken: 'machine-token-browser-1',
      accountNamespaceId: 'a'.repeat(64),
    })
  })

  it('reports user denial as a stable error', async () => {
    mockTerminalStatus('denied')
    await expect(
      runBrowserPairFlow({
        serverUrl: 'https://shennian.net',
        machineName: 'Denied machine',
        machineOs: 'windows',
        agentList: [],
        openUrl: async () => false,
      }),
    ).rejects.toMatchObject({ code: 'PAIR_DENIED' })
  })

  it('reports expiration as a stable error', async () => {
    mockTerminalStatus('expired')
    await expect(
      runBrowserPairFlow({
        serverUrl: 'https://shennian.net',
        machineName: 'Denied machine',
        machineOs: 'windows',
        agentList: [],
        openUrl: async () => false,
      }),
    ).rejects.toMatchObject({ code: 'PAIR_EXPIRED' })
  })

  it('cancels the server intent when the local flow is aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    let cancelled = false
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const target = String(url)
      if (target.endsWith('/auth/device-authorizations')) {
        return new Response(
          JSON.stringify({
            loginIntentId: 'intent_cancel_1',
            publicLoginUrl: 'https://shennian.net/authorize/intent_cancel_1',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          }),
          { status: 201 },
        )
      }
      if (target.endsWith('/cancel')) {
        cancelled = true
        return new Response(JSON.stringify({ status: 'denied' }))
      }
      throw new Error(`Unexpected URL ${target}`)
    }) as typeof fetch

    await expect(
      runBrowserPairFlow({
        serverUrl: 'https://shennian.net',
        machineName: 'Cancelled machine',
        machineOs: 'macos',
        agentList: [],
        signal: controller.signal,
        openUrl: async () => false,
      }),
    ).rejects.toEqual(expect.objectContaining({ code: 'PAIR_CANCELLED' }))
    expect(cancelled).toBe(true)
  })
})

describe('waiting for one saved request', () => {
  it('returns at the caller deadline without cancelling the still-valid request', async () => {
    const calls: string[] = []
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(url)}`)
      return new Response(JSON.stringify({ status: 'waiting_user', actionPayloadHash: 'a'.repeat(64) }))
    }) as typeof fetch
    const result = await waitForBrowserPairIntent({
      serverUrl: 'https://shennian.net',
      intentId: 'intent_wait_1',
      url: 'https://shennian.net/authorize/intent_wait_1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      deviceSecret: 'secret',
      actionPayloadHash: 'a'.repeat(64),
      machineName: 'Build server',
    }, { deadline: Date.now() + 30, pollIntervalMs: 10 })
    expect(result).toBeNull()
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every((call) => call.endsWith('/status'))).toBe(true)
  })
})

describe('pair mode selection', () => {
  it('sends JSON and headless callers (AI hosts) to the link flow unless --token is explicit', () => {
    expect(resolvePairMode({ json: true, stdinIsTty: true, stdoutIsTty: true })).toBe('browser')
    expect(resolvePairMode({ stdinIsTty: false, stdoutIsTty: false })).toBe('browser')
    expect(resolvePairMode({ json: true, token: true })).toBe('token')
    expect(resolvePairMode({ browser: true })).toBe('browser')
    expect(resolvePairMode({ token: true })).toBe('token')
    expect(resolvePairMode({ stdinIsTty: true, stdoutIsTty: true })).toBe('prompt')
  })

  it('uses safe platform-native browser commands on macOS, Windows, and Linux', () => {
    const url = 'https://shennian.net/authorize/intent_123'
    expect(browserOpenCommand('darwin', url)).toEqual({ command: 'open', args: [url] })
    expect(browserOpenCommand('win32', url)).toEqual({
      command: 'explorer.exe',
      args: [url],
    })
    expect(browserOpenCommand('linux', url)).toEqual({ command: 'xdg-open', args: [url] })
  })

  it('accepts only same-host, credential-free authorization URLs', () => {
    expect(
      normalizePairAuthorizationUrl(
        'https://shennian.net/authorize/intent_123',
        'https://shennian.net',
      ),
    ).toBe('https://shennian.net/authorize/intent_123')
    expect(
      normalizePairAuthorizationUrl(
        'http://127.0.0.1:8081/authorize/intent_local',
        'http://127.0.0.1:3000',
      ),
    ).toBe('http://127.0.0.1:8081/authorize/intent_local')
    for (const unsafe of [
      'https://evil.example/authorize/intent_123',
      'https://shennian.net/authorize/intent_123?next=evil',
      'https://user:pass@shennian.net/authorize/intent_123',
      'https://shennian.net/not-authorize/intent_123',
    ]) {
      expect(() => normalizePairAuthorizationUrl(unsafe, 'https://shennian.net')).toThrow(
        BrowserPairError,
      )
    }
  })

  it('does not try to open a remote GUI browser inside SSH', async () => {
    const previous = process.env.SSH_CONNECTION
    process.env.SSH_CONNECTION = 'client server'
    try {
      await expect(openExternalUrl('https://shennian.net/authorize/intent_123')).resolves.toBe(
        false,
      )
    } finally {
      if (previous === undefined) delete process.env.SSH_CONNECTION
      else process.env.SSH_CONNECTION = previous
    }
  })

  it('rejects conflicting flags and defaults an empty interactive choice to browser', () => {
    expect(() => resolvePairMode({ browser: true, token: true })).toThrow(BrowserPairError)
    expect(parsePairModeChoice('')).toBe('browser')
    expect(parsePairModeChoice('1')).toBe('browser')
    expect(parsePairModeChoice('2')).toBe('token')
  })
})

async function createdActionHash(): Promise<string> {
  const { hashActionPayload } = await import('../commands/pair-authorization.js')
  const { getDaemonInstallationId } = await import('../personal-sync/identity.js')
  return hashActionPayload({
    action: 'pair_machine',
    agentList: ['codex'],
    daemonInstallationId: getDaemonInstallationId(),
    machineName: 'Build server',
    machineOs: 'linux',
  })
}

function mockTerminalStatus(status: 'denied' | 'expired') {
  let actionPayloadHash = ''
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url)
    if (target.endsWith('/auth/device-authorizations')) {
      actionPayloadHash = String(
        (JSON.parse(String(init?.body)) as { actionPayloadHash?: unknown }).actionPayloadHash,
      )
      return new Response(
        JSON.stringify({
          loginIntentId: 'intent_terminal_1',
          publicLoginUrl: 'https://shennian.net/authorize/intent_terminal_1',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }),
        { status: 201 },
      )
    }
    if (target.endsWith('/status')) {
      return new Response(
        JSON.stringify({
          status,
          actionPayloadHash,
        }),
      )
    }
    throw new Error(`Unexpected URL ${target}`)
  }) as typeof fetch
}
