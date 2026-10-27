// @arch open-source/docs/cli-runtime.md
// @covers src/agents/opencode.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../agents/adapter.js'
import { OpenCodeAdapter } from '../agents/opencode.js'
import type { CompiledManagedAgentPolicy } from '../security/managed-agent-policy.js'

type TestableOpenCodeAdapter = {
  runId: string
  seq: number
  agentSessionId: string | null
  terminalState: 'open' | 'closed'
  runUsage: AgentEvent['usage'] | undefined
  process: object | null
  handleStreamEvent(obj: unknown): void
  handleProcessLine(proc: object, line: string): void
  completeRunAfterProcessExit(code?: number | null, signal?: NodeJS.Signals | null, stderr?: string): void
  spawnAndParse(args: string[], input: string, systemPrompt?: string, publicTurn?: boolean): Promise<void>
  prepareManagedLaunch(systemPrompt?: string): Promise<{
    args: string[]
    env: NodeJS.ProcessEnv
    configDir: string | null
  }>
  disposeManagedConfig(configDir: string | null): Promise<void>
}

const tempDirs: string[] = []

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

function compiledPolicy(workDir: string): CompiledManagedAgentPolicy {
  const requestedPolicy = {
    version: 1,
    fileAccess: 'workspace-write' as const,
    externalCapabilities: {
      commandNetwork: false,
      webSearch: false,
      browser: false,
      computerUse: false,
      mcp: false,
    },
  }
  return {
    requestedPolicy,
    enforcement: {
      level: 'partial',
      effectivePolicy: requestedPolicy,
      unsupportedCapabilities: ['sandbox.toolPermissionOnly'],
      runtimeVersion: '1.18.26',
      platform: process.platform,
    },
    adapterPolicy: {
      version: 1,
      workDir,
      fileAccess: 'workspace-write',
      externalCapabilities: { ...requestedPolicy.externalCapabilities },
      denySensitiveFiles: true,
      failClosed: true,
    },
    environmentPolicy: {
      inheritDaemonEnv: false,
      loadLoginShell: false,
      providerEnvKeys: [],
      sessionEnvKeys: [],
      shellSubprocess: { inherit: 'none', allowedEnvKeys: [], deniedEnvKeys: [] },
    },
  }
}

function createHarness() {
  const adapter = new OpenCodeAdapter()
  const internal = adapter as unknown as TestableOpenCodeAdapter
  internal.runId = 'run-opencode-test'
  internal.seq = 0
  internal.terminalState = 'open'

  const events: AgentEvent[] = []
  adapter.on('agentEvent', (event) => events.push(event))

  return { internal, events }
}

describe('OpenCodeAdapter', () => {
  it('passes public visitor text separately from the owner system prompt', async () => {
    const workDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-opencode-public-')),
    )
    tempDirs.push(workDir)
    const adapter = new OpenCodeAdapter()
    const policy = compiledPolicy(workDir)
    // Synthetic hard proof exercises the Adapter contract only. The current
    // OpenCode runtime declaration remains partial and cannot activate.
    policy.enforcement.level = 'hard'
    policy.enforcement.unsupportedCapabilities = []
    policy.enforcement.executableFingerprint = 'synthetic-test-fingerprint'
    adapter.configure({ managedAgentPolicy: policy, env: {} })
    await adapter.start('public-session', workDir)
    const internal = adapter as unknown as TestableOpenCodeAdapter
    internal.spawnAndParse = vi.fn(async () => {})

    await adapter.send('visitor text', undefined, undefined, undefined,
      'owner system instruction', { source: 'published_agent' })

    expect(internal.spawnAndParse).toHaveBeenCalledWith(
      expect.arrayContaining(['run', '--format', 'json']),
      'visitor text',
      expect.stringContaining('owner system instruction'),
      true,
    )
  })

  it('fails closed when a managed Room turn has no compiled policy', async () => {
    const adapter = new OpenCodeAdapter()
    await adapter.start('session-1', process.cwd())

    await expect(
      adapter.send('hello', undefined, undefined, undefined, undefined, {
        source: 'room_activation',
      }),
    ).rejects.toThrow('managed_agent_policy_missing')
  })

  it('uses an isolated config and filtered environment for managed launches', async () => {
    const workDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-opencode-adapter-')),
    )
    tempDirs.push(workDir)
    const adapter = new OpenCodeAdapter()
    adapter.configure({
      managedAgentPolicy: compiledPolicy(workDir),
      env: {
        SHENNIAN_MANAGED_ROOM_CONTEXT: 'room-context',
        SHENNIAN_MANAGER_IPC_TOKEN: 'manager-token-must-not-pass',
        DAEMON_SECRET_SHOULD_NOT_LEAK: 'secret',
      },
    })
    await adapter.start('session-1', workDir)

    const launch = await (adapter as unknown as TestableOpenCodeAdapter).prepareManagedLaunch()
    if (launch.configDir) tempDirs.push(launch.configDir)
    expect(launch.args).toEqual(['--pure', '--auto'])
    expect(launch.env).toMatchObject({
      SHENNIAN_MANAGED_ROOM_CONTEXT: 'room-context',
      OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
      OPENCODE_DISABLE_CLAUDE_CODE: '1',
    })
    expect(launch.env.SHENNIAN_MANAGER_IPC_TOKEN).toBeUndefined()
    expect(launch.env.DAEMON_SECRET_SHOULD_NOT_LEAK).toBeUndefined()
    expect(launch.env.OPENCODE_CONFIG).toBeTruthy()
    expect(launch.env.OPENCODE_CONFIG_CONTENT).toContain('"bash":"deny"')
    expect(launch.env.XDG_CACHE_HOME).toBeTruthy()
    expect(launch.env.XDG_STATE_HOME).toBeTruthy()
    expect(launch.env.XDG_CACHE_HOME).not.toBe(os.homedir())
    expect(launch.env.XDG_STATE_HOME).not.toBe(os.homedir())
    expect(path.dirname(launch.env.XDG_CACHE_HOME as string)).toBe(launch.configDir)
    expect(path.dirname(launch.env.XDG_STATE_HOME as string)).toBe(launch.configDir)
    if (process.platform !== 'win32') {
      expect(fs.statSync(launch.env.XDG_CACHE_HOME as string).mode & 0o777).toBe(0o700)
      expect(fs.statSync(launch.env.XDG_STATE_HOME as string).mode & 0o777).toBe(0o700)
    }
    await (adapter as unknown as TestableOpenCodeAdapter).disposeManagedConfig(launch.configDir)
    expect(fs.existsSync(launch.env.XDG_CACHE_HOME as string)).toBe(false)
  })

  it('emits start when opencode returns a sessionID', () => {
    const { internal, events } = createHarness()

    internal.handleStreamEvent({
      type: 'step_start',
      sessionID: 'ses_123',
      part: { type: 'step-start' },
    })

    expect(events).toEqual([expect.objectContaining({ state: 'start', agentSessionId: 'ses_123' })])
    expect(internal.agentSessionId).toBe('ses_123')
  })

  it('maps text and reasoning parts to deltas', () => {
    const { internal, events } = createHarness()

    internal.handleStreamEvent({ type: 'text', part: { type: 'text', text: 'hello' } })
    internal.handleStreamEvent({ type: 'reasoning', part: { type: 'reasoning', text: 'thinking' } })

    expect(events).toEqual([
      expect.objectContaining({ state: 'delta', text: 'hello' }),
      expect.objectContaining({ state: 'delta', text: 'thinking', thinking: true }),
    ])
  })

  it('maps completed tools to tool-result events', () => {
    const { internal, events } = createHarness()

    internal.handleStreamEvent({
      type: 'tool_use',
      part: {
        type: 'tool',
        tool: 'bash',
        state: { status: 'completed', input: { command: 'pwd' }, output: '/tmp' },
      },
    })

    expect(events).toEqual([
      expect.objectContaining({ state: 'tool-result', name: 'bash', result: '/tmp' }),
    ])
  })

  it('keeps a multi-step tool run open until process exit and aggregates usage', () => {
    const { internal, events } = createHarness()
    internal.agentSessionId = 'ses_456'

    internal.handleStreamEvent({
      type: 'step_finish',
      part: { type: 'step-finish', tokens: { input: 12, output: 34, total: 46 } },
    })
    internal.handleStreamEvent({
      type: 'tool_use',
      part: {
        type: 'tool',
        tool: 'bash',
        state: { status: 'completed', output: 'sent' },
      },
    })
    internal.handleStreamEvent({
      type: 'step_finish',
      part: { type: 'step-finish', tokens: { input: 5, output: 6 } },
    })

    expect(events).toEqual([
      expect.objectContaining({ state: 'tool-result', name: 'bash', result: 'sent' }),
    ])
    expect(internal.runUsage).toEqual({ inputTokens: 17, outputTokens: 40 })

    internal.completeRunAfterProcessExit()
    internal.completeRunAfterProcessExit()
    expect(events).toEqual([
      expect.objectContaining({ state: 'tool-result', name: 'bash', result: 'sent' }),
      expect.objectContaining({
        state: 'final',
        agentSessionId: 'ses_456',
        usage: { inputTokens: 17, outputTokens: 40 },
      }),
    ])
  })

  it('emits terminal errors once', () => {
    const { internal, events } = createHarness()

    internal.handleStreamEvent({ type: 'error', error: { data: { message: 'auth failed' } } })
    internal.handleStreamEvent({
      type: 'step_finish',
      part: { type: 'step-finish', tokens: { input: 1, output: 1 } },
    })

    expect(events).toEqual([expect.objectContaining({ state: 'error', message: 'auth failed' })])
  })

  it('reports an abnormal process signal as an error instead of a successful final', () => {
    const { internal, events } = createHarness()

    internal.completeRunAfterProcessExit(null, 'SIGKILL')

    expect(events).toEqual([
      expect.objectContaining({ state: 'error', message: 'opencode exited with signal SIGKILL' }),
    ])
  })

  it('ignores buffered output from a stopped process after the next run starts', () => {
    const { internal, events } = createHarness()
    const previousProcess = {}
    const currentProcess = {}
    internal.process = currentProcess

    internal.handleProcessLine(previousProcess, JSON.stringify({
      type: 'error',
      error: { data: { message: 'late previous-run error' } },
    }))
    internal.handleProcessLine(currentProcess, JSON.stringify({
      type: 'text',
      part: { type: 'text', text: 'current run' },
    }))

    expect(events).toEqual([
      expect.objectContaining({ state: 'delta', text: 'current run' }),
    ])
    expect(internal.terminalState).toBe('open')
  })
})
