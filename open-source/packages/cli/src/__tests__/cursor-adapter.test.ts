// @arch open-source/docs/cli-runtime.md
// @covers src/agents/cursor.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentEvent } from '../agents/adapter.js'
import { CursorAdapter } from '../agents/cursor.js'
import type { CompiledManagedAgentPolicy } from '../security/managed-agent-policy.js'

const cleanupPaths: string[] = []

afterEach(() => {
  for (const entry of cleanupPaths.splice(0)) {
    fs.rmSync(entry, { recursive: true, force: true })
  }
})

type TestableCursorAdapter = {
  runId: string
  seq: number
  workDir: string | null
  chatId: string | null
  buildSendArgs(outgoing: string, modelId?: string): string[]
  handleStreamEvent(obj: unknown): void
  prepareManagedLaunch(publicTurn?: boolean): Promise<{
    args: string[]
    env: NodeJS.ProcessEnv
    configDir: string | null
  }>
  disposeManagedConfig(configDir: string | null): Promise<void>
}

function managedPolicy(workDir: string): CompiledManagedAgentPolicy {
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
      unsupportedCapabilities: ['fileAccess.workspaceSensitiveFiles'],
      runtimeVersion: '2026.08.31-4057e58',
      platform: 'darwin',
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
      sessionEnvKeys: ['SHENNIAN_MANAGED_ROOM_CONTEXT', 'SHENNIAN_MANAGED_ROOM_IPC_ROOT'],
      shellSubprocess: {
        inherit: 'none',
        allowedEnvKeys: [
          'PATH',
          'HOME',
          'SHENNIAN_MANAGED_ROOM_CONTEXT',
          'SHENNIAN_MANAGED_ROOM_IPC_ROOT',
        ],
        deniedEnvKeys: [],
      },
    },
  }
}

function createHarness() {
  const adapter = new CursorAdapter()
  const internal = adapter as unknown as TestableCursorAdapter
  internal.runId = 'run-cursor-test'
  internal.seq = 0

  const events: AgentEvent[] = []
  adapter.on('agentEvent', (event) => events.push(event))

  return { internal, events }
}

describe('CursorAdapter', () => {
  it('resumes the exact persisted chat instead of the most recent chat', async () => {
    const adapter = new CursorAdapter()
    await adapter.start('cursor-recovery', process.cwd(), 'cursor-native-chat')
    const internal = adapter as unknown as TestableCursorAdapter

    expect(internal.buildSendArgs('Continue.', 'auto')).toEqual([
      '-p',
      'Continue.',
      '--output-format',
      'stream-json',
      '--stream-partial-output',
      '--model',
      'auto',
      '--resume',
      'cursor-native-chat',
    ])
    expect(internal.buildSendArgs('Continue.')).not.toContain('--continue')
  })

  it('fails closed when Room activation did not supply a compiled policy', async () => {
    const adapter = new CursorAdapter()
    await adapter.start('cursor-room', process.cwd())

    await expect(
      adapter.send('untrusted Room message', undefined, undefined, undefined, undefined, {
        source: 'room_activation',
      }),
    ).rejects.toThrow('managed_agent_policy_missing')
  })

  it('uses the policy realpath and an isolated allowlisted process environment', async () => {
    const workDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-adapter-managed-')),
    )
    cleanupPaths.push(workDir)
    const adapter = new CursorAdapter()
    adapter.configure({
      sessionId: 'managed-room-session',
      env: {
        SHENNIAN_MANAGED_ROOM_CONTEXT: 'room-capability',
        CURSOR_API_KEY: 'must-not-reach-cursor-or-shell',
        UNEXPECTED_DAEMON_SECRET: 'must-not-pass',
      },
      managedAgentPolicy: managedPolicy(workDir),
    })
    await adapter.start('cursor-room', '/must/not/be/used')

    const internal = adapter as unknown as TestableCursorAdapter
    const launch = await internal.prepareManagedLaunch()
    expect(internal.workDir).toBe(workDir)
    expect(launch.args).toEqual(
      expect.arrayContaining(['--workspace', workDir, '--sandbox', 'enabled']),
    )
    expect(launch.configDir).toBeTruthy()
    expect(launch.env.CURSOR_CONFIG_DIR).toBe(launch.configDir)
    expect(launch.env.SHENNIAN_MANAGED_ROOM_CONTEXT).toBe('room-capability')
    expect(launch.env.CURSOR_API_KEY).toBeUndefined()
    expect(launch.env.UNEXPECTED_DAEMON_SECRET).toBeUndefined()
    await internal.disposeManagedConfig(launch.configDir)
  })

  it('passes the public-turn file-tool denial into the isolated Cursor config', async () => {
    const workDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-public-config-')))
    cleanupPaths.push(workDir)
    const adapter = new CursorAdapter()
    adapter.configure({ managedAgentPolicy: managedPolicy(workDir), env: {} })
    await adapter.start('public-session', workDir)
    const internal = adapter as unknown as TestableCursorAdapter
    const launch = await internal.prepareManagedLaunch(true)
    try {
      const config = JSON.parse(fs.readFileSync(path.join(launch.configDir!, 'cli-config.json'), 'utf8')) as {
        permissions: { allow: string[]; deny: string[] }
      }
      expect(config.permissions.allow).not.toContain('Read(**)')
      expect(config.permissions.deny).toContain('Read(**)')
    } finally {
      await internal.disposeManagedConfig(launch.configDir)
    }
  })

  it('refuses to initialize when project sandbox settings widen the workspace', async () => {
    const workDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-adapter-project-policy-')),
    )
    cleanupPaths.push(workDir)
    fs.mkdirSync(path.join(workDir, '.cursor'))
    fs.writeFileSync(
      path.join(workDir, '.cursor', 'sandbox.json'),
      JSON.stringify({ type: 'insecure_none' }),
    )
    const adapter = new CursorAdapter()
    adapter.configure({ managedAgentPolicy: managedPolicy(workDir) })
    await adapter.start('cursor-room', workDir)

    const internal = adapter as unknown as TestableCursorAdapter
    await expect(internal.prepareManagedLaunch()).rejects.toThrow(
      'cursor_managed_project_sandbox_broadens_access',
    )
  })

  it('ignores buffered assistant flushes and emits final once', () => {
    const { internal, events } = createHarness()

    internal.handleStreamEvent({
      type: 'assistant',
      timestamp_ms: 1,
      message: {
        content: [{ type: 'text', text: '你好，我是你的编程助手。' }],
      },
    })

    internal.handleStreamEvent({
      type: 'assistant',
      timestamp_ms: 2,
      model_call_id: 'call-1',
      message: {
        content: [{ type: 'text', text: '你好，我是你的编程助手。' }],
      },
    })

    internal.handleStreamEvent({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: '你好，我是你的编程助手。' }],
      },
    })

    internal.handleStreamEvent({
      type: 'result',
      subtype: 'success',
      result: '你好，我是你的编程助手。',
    })

    expect(events.filter((event) => event.state === 'delta')).toEqual([
      expect.objectContaining({ state: 'delta', text: '你好，我是你的编程助手。' }),
    ])
    expect(events.at(-1)).toEqual(expect.objectContaining({ state: 'final' }))
  })

  it('falls back to result.result when buffered flushes were skipped', () => {
    const { internal, events } = createHarness()

    internal.handleStreamEvent({
      type: 'assistant',
      timestamp_ms: 10,
      model_call_id: 'call-2',
      message: {
        content: [{ type: 'text', text: '最终答案' }],
      },
    })

    internal.handleStreamEvent({
      type: 'result',
      subtype: 'success',
      result: '最终答案',
    })

    expect(events).toEqual([
      expect.objectContaining({ state: 'delta', text: '最终答案' }),
      expect.objectContaining({ state: 'final' }),
    ])
  })
})
