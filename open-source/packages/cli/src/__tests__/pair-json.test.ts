// @arch open-source/docs/cli-runtime.md
// @covers open-source/packages/cli/src/commands/pair.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const detectAgentsMock = vi.fn(() => [{ type: 'codex' }])
let daemonMocks: {
  clearRemoteAccessDisabled: ReturnType<typeof vi.fn>
  startDaemonProcess: ReturnType<typeof vi.fn>
  installService: ReturnType<typeof vi.fn>
  saveEnvSnapshot: ReturnType<typeof vi.fn>
  getDaemonStatus: ReturnType<typeof vi.fn>
}

vi.mock('../agents/detect.js', () => ({
  detectAgents: detectAgentsMock,
}))

vi.mock('../commands/daemon.js', () => {
  daemonMocks = {
    clearRemoteAccessDisabled: vi.fn(),
    startDaemonProcess: vi.fn(),
    installService: vi.fn(() => true),
    saveEnvSnapshot: vi.fn(),
    getDaemonStatus: vi.fn(() => ({
      running: true,
      pid: 12345,
      stale: false,
      remoteAccessDisabled: false,
      launcher: 'global-cli',
      platform: process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux',
      shennianDir: '/tmp/shennian-test',
      pidFile: '/tmp/shennian-test/daemon.pid',
      logFile: '/tmp/shennian-test/daemon.log',
    })),
  }
  return daemonMocks
})

let tmpDir: string
let originalHome: string | undefined
let originalFetch: typeof fetch
let stdout = ''
const originalWrite = process.stdout.write

function parseEvents() {
  return stdout
    .trim()
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string; [key: string]: unknown })
}

describe('pair --json flow', () => {
  beforeEach(() => {
    vi.resetModules()
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-pair-json-'))
    originalHome = process.env.SHENNIAN_HOME
    process.env.SHENNIAN_HOME = tmpDir
    originalFetch = globalThis.fetch
    stdout = ''
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += chunk.toString()
      return true
    }) as typeof process.stdout.write
  })

  afterEach(() => {
    process.stdout.write = originalWrite
    globalThis.fetch = originalFetch
    if (originalHome === undefined) delete process.env.SHENNIAN_HOME
    else process.env.SHENNIAN_HOME = originalHome
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('emits JSONL events and saves claimed machine credentials', async () => {
    let statusCalls = 0
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url)
      if (target.endsWith('/api/machines/pair/create')) {
        expect(JSON.parse(String(init?.body))).toEqual({
          name: 'Macbook',
          os: process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux',
          agentList: ['codex'],
          daemonInstallationId: expect.any(String),
        })
        return new Response(JSON.stringify({ pairToken: 'sn-code', machineId: 'machine-1' }), { status: 200 })
      }
      if (target.includes('/api/machines/pair/status')) {
        statusCalls += 1
        return new Response(JSON.stringify({
          status: 'claimed',
          machineToken: 'machine-token',
          machineId: 'machine-1',
          machineName: 'Macbook',
          accountNamespaceId: 'a'.repeat(64),
        }), { status: 200 })
      }
      throw new Error(`Unexpected URL ${target}`)
    }) as typeof fetch

    const { runPairFlow } = await import('../commands/pair.js')
    await runPairFlow({
      serverUrl: 'https://shennian.net',
      machineName: 'Macbook',
      force: true,
      json: true,
      mode: 'token',
    })

    expect(statusCalls).toBe(1)
    expect(parseEvents().map((event) => event.type)).toEqual([
      'pair.created',
      'pair.waiting',
      'pair.claimed',
      'pair.saved',
    ])
    expect(parseEvents()[0]).toEqual(expect.objectContaining({
      type: 'pair.created',
      code: 'sn-code',
      machineId: 'machine-1',
    }))
    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf-8'))
    expect(config).toEqual(expect.objectContaining({
      machineId: 'machine-1',
      machineToken: 'machine-token',
      accountNamespaceId: 'a'.repeat(64),
      serverUrl: 'https://shennian.net',
    }))
  })

  it('executes both canonical install-document pairing paths through the CLI command contract', async () => {
    const { registerPairCommand } = await import('../commands/pair.js')
    const { Command } = await import('commander')

    const runCommand = async (mode: 'browser' | 'token') => {
      const machineId = `machine-agent-install-${mode}`
      const machineToken = `machine-token-agent-install-${mode}`
      let actionPayloadHash = ''

      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const target = String(url)
        if (mode === 'token' && target.endsWith('/api/machines/pair/create')) {
          return new Response(JSON.stringify({
            pairToken: 'sn-agent-install-token',
            machineId,
          }))
        }
        if (mode === 'token' && target.includes('/api/machines/pair/status')) {
          return new Response(JSON.stringify({
            status: 'claimed',
            machineId,
            machineToken,
            machineName: 'Agent installed machine',
            accountNamespaceId: 'b'.repeat(64),
          }))
        }
        if (mode === 'browser' && target.endsWith('/auth/device-authorizations')) {
          const payload = JSON.parse(String(init?.body)) as Record<string, unknown>
          expect(payload.daemonInstallationId).toEqual(expect.any(String))
          actionPayloadHash = String(payload.actionPayloadHash)
          return new Response(JSON.stringify({
            loginIntentId: 'intent-agent-install-browser',
            publicLoginUrl: 'https://shennian.net/authorize/intent-agent-install-browser',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          }), { status: 201 })
        }
        if (mode === 'browser' && target.endsWith('/status')) {
          return new Response(JSON.stringify({ status: 'approved', actionPayloadHash }))
        }
        if (mode === 'browser' && target.endsWith('/claim')) {
          return new Response(JSON.stringify({
            status: 'claimed',
            actionPayloadHash,
            machineId,
            machineToken,
            accountNamespaceId: 'b'.repeat(64),
          }))
        }
        throw new Error(`Unexpected ${mode} URL ${target}`)
      }) as typeof fetch

      const program = new Command()
      program.exitOverride()
      registerPairCommand(program)
      const args = [
        'node',
        'shennian',
        'pair',
        `--${mode}`,
        '--json',
        '--force',
        '--server',
        'https://shennian.net',
        '--name',
        'Agent installed machine',
      ]

      if (mode === 'token') {
        vi.useFakeTimers()
        try {
          const pending = program.parseAsync(args)
          await vi.advanceTimersByTimeAsync(3_000)
          await pending
        } finally {
          vi.useRealTimers()
        }
      } else {
        const previousSsh = process.env.SSH_CONNECTION
        process.env.SSH_CONNECTION = 'agent-install-e2e'
        try {
          await program.parseAsync(args)
        } finally {
          if (previousSsh === undefined) delete process.env.SSH_CONNECTION
          else process.env.SSH_CONNECTION = previousSsh
        }
      }

      expect(parseEvents().map((event) => event.type)).toEqual(
        mode === 'browser'
          ? ['pair.browser.created', 'pair.claimed', 'pair.saved', 'daemon.starting', 'done']
          : ['pair.created', 'pair.waiting', 'pair.claimed', 'pair.saved', 'daemon.starting', 'done'],
      )
      expect(JSON.parse(fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf-8'))).toMatchObject({
        machineId,
        machineToken,
        accountNamespaceId: 'b'.repeat(64),
        serverUrl: 'https://shennian.net',
      })
      expect(daemonMocks.installService).toHaveBeenCalled()

      fs.rmSync(path.join(tmpDir, 'config.json'))
      stdout = ''
      vi.clearAllMocks()
    }

    await runCommand('browser')
    await runCommand('token')
  })

  it('emits stable browser authorization events and saves claimed credentials', async () => {
    let actionPayloadHash = ''
    let openedUrl = ''
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url)
      if (target.endsWith('/auth/device-authorizations')) {
        const payload = JSON.parse(String(init?.body)) as Record<string, unknown>
        expect(payload.daemonInstallationId).toEqual(expect.any(String))
        actionPayloadHash = String(payload.actionPayloadHash)
        return new Response(JSON.stringify({
          loginIntentId: 'intent-browser-1',
          publicLoginUrl: 'https://shennian.net/authorize/intent-browser-1',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }), { status: 201 })
      }
      if (target.endsWith('/status')) {
        return new Response(JSON.stringify({ status: 'approved', actionPayloadHash }))
      }
      if (target.endsWith('/claim')) {
        return new Response(JSON.stringify({
          status: 'claimed',
          actionPayloadHash,
          machineId: 'machine-browser-1',
          machineToken: 'machine-token-browser-1',
          accountNamespaceId: 'c'.repeat(64),
        }))
      }
      throw new Error(`Unexpected URL ${target}`)
    }) as typeof fetch

    const { runPairFlow } = await import('../commands/pair.js')
    await runPairFlow({
      serverUrl: 'https://shennian.net',
      machineName: 'Macbook',
      force: true,
      json: true,
      mode: 'browser',
      openUrl: async (url) => {
        openedUrl = url
        return false
      },
    })

    expect(openedUrl).toBe('https://shennian.net/authorize/intent-browser-1')
    expect(parseEvents().map((event) => event.type)).toEqual([
      'pair.browser.created',
      'pair.claimed',
      'pair.saved',
    ])
    expect(JSON.parse(fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf-8'))).toMatchObject({
      machineId: 'machine-browser-1',
      machineToken: 'machine-token-browser-1',
      accountNamespaceId: 'c'.repeat(64),
      serverUrl: 'https://shennian.net',
    })
  })

  it('re-enables remote access before starting the daemon after pair --json', async () => {
    let statusCalls = 0
    globalThis.fetch = (async (url: string | URL | Request) => {
      const target = String(url)
      if (target.endsWith('/api/machines/pair/create')) {
        return new Response(JSON.stringify({ pairToken: 'sn-code', machineId: 'machine-1' }), { status: 200 })
      }
      if (target.includes('/api/machines/pair/status')) {
        statusCalls += 1
        return new Response(JSON.stringify({
          status: 'claimed',
          machineToken: 'machine-token',
          machineId: 'machine-1',
          machineName: 'Macbook',
          accountNamespaceId: 'd'.repeat(64),
        }), { status: 200 })
      }
      throw new Error(`Unexpected URL ${target}`)
    }) as typeof fetch

    const { registerPairCommand } = await import('../commands/pair.js')
    const { Command } = await import('commander')
    const program = new Command()
    program.exitOverride()
    registerPairCommand(program)

    await program.parseAsync([
      'node',
      'shennian',
      'pair',
      '--json',
      '--token',
      '--server',
      'https://shennian.net',
      '--name',
      'Macbook',
    ])

    expect(statusCalls).toBe(1)
    expect(daemonMocks.saveEnvSnapshot).toHaveBeenCalledOnce()
    expect(daemonMocks.clearRemoteAccessDisabled).toHaveBeenCalledOnce()
    expect(daemonMocks.installService).toHaveBeenCalledOnce()
    expect(daemonMocks.startDaemonProcess).not.toHaveBeenCalled()
    expect(parseEvents().map((event) => event.type)).toEqual([
      'pair.created',
      'pair.waiting',
      'pair.claimed',
      'pair.saved',
      'daemon.starting',
      'done',
    ])
  })

  it('force re-pairs in JSON mode even when stale machine credentials exist', async () => {
    fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify({
      machineId: 'stale-machine',
      machineToken: 'stale-token',
      serverUrl: 'https://shennian.net',
    }))
    let createCalls = 0
    globalThis.fetch = (async (url: string | URL | Request) => {
      const target = String(url)
      if (target.endsWith('/api/machines/pair/create')) {
        createCalls += 1
        return new Response(JSON.stringify({ pairToken: 'sn-code', machineId: 'machine-2' }), { status: 200 })
      }
      if (target.includes('/api/machines/pair/status')) {
        return new Response(JSON.stringify({
          status: 'claimed',
          machineToken: 'machine-token-2',
          machineId: 'machine-2',
          machineName: 'Macbook',
          accountNamespaceId: 'e'.repeat(64),
        }), { status: 200 })
      }
      throw new Error(`Unexpected URL ${target}`)
    }) as typeof fetch

    const { registerPairCommand } = await import('../commands/pair.js')
    const { Command } = await import('commander')
    const program = new Command()
    program.exitOverride()
    registerPairCommand(program)

    await program.parseAsync([
      'node',
      'shennian',
      'pair',
      '--json',
      '--token',
      '--force',
      '--server',
      'https://shennian.net',
      '--name',
      'Macbook',
    ])

    expect(createCalls).toBe(1)
    expect(parseEvents().map((event) => event.type)).toEqual([
      'pair.created',
      'pair.waiting',
      'pair.claimed',
      'pair.saved',
      'daemon.starting',
      'done',
    ])
    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf-8'))
    expect(config).toEqual(expect.objectContaining({
      machineId: 'machine-2',
      machineToken: 'machine-token-2',
      accountNamespaceId: 'e'.repeat(64),
      serverUrl: 'https://shennian.net',
    }))
  })

  it('preserves existing machine credentials when a forced re-pair expires before claim completes', async () => {
    fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify({
      machineId: 'stale-machine',
      machineToken: 'stale-token',
      serverUrl: 'https://shennian.net',
    }))
    vi.useFakeTimers()
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code ?? 0}`)
    }) as never)
    globalThis.fetch = (async (url: string | URL | Request) => {
      const target = String(url)
      if (target.endsWith('/api/machines/pair/create')) {
        return new Response(JSON.stringify({ pairToken: 'sn-expiring-code', machineId: 'machine-new' }), { status: 200 })
      }
      if (target.includes('/api/machines/pair/status')) {
        return new Response(JSON.stringify({ status: 'waiting' }), { status: 410 })
      }
      throw new Error(`Unexpected URL ${target}`)
    }) as typeof fetch

    try {
      const { runPairFlow } = await import('../commands/pair.js')
      const pairPromise = runPairFlow({
        serverUrl: 'https://shennian.net',
        machineName: 'Macbook',
        force: true,
        json: true,
      })
      const rejected = expect(pairPromise).rejects.toThrow('process.exit:1')

      await vi.advanceTimersByTimeAsync(3000)
      await rejected

      expect(exitSpy).toHaveBeenCalledOnce()
      const config = JSON.parse(fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf-8'))
      expect(config).toEqual(expect.objectContaining({
        machineId: 'stale-machine',
        machineToken: 'stale-token',
        serverUrl: 'https://shennian.net',
      }))
    } finally {
      exitSpy.mockRestore()
      vi.useRealTimers()
    }
  })
})
