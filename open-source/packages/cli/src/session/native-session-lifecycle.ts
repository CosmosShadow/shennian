// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/native-session-lifecycle.test.ts

import { createInterface } from 'node:readline'
import type { ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import { isAvailableBuiltinAgentType, type AgentType } from '@shennian/wire'
import { buildAgentProcessEnv } from '../agent-env.js'
import {
  resolveBuiltinCommand,
  spawnAgentCommand,
  type ResolvedCommandSpec,
} from '../agents/command-spec.js'
import { deleteOwnedPiSession } from '../agents/pi-session-ownership.js'

export type NativeLifecycleCapability = {
  canArchive: boolean
  canDelete: boolean
}

export type NativeLifecycleResult =
  | { outcome: 'archived' }
  | { outcome: 'deleted' }
  | { outcome: 'already_absent' }
  | { outcome: 'unsupported' }
  | { outcome: 'invalid_identity' }
  | { outcome: 'transient'; errorCode: string }
  | { outcome: 'permanent'; errorCode: string }

export interface NativeSessionLifecycleAdapter {
  probe(): Promise<NativeLifecycleCapability>
  archive?(
    sourceSessionKey: string,
    context?: { workDir?: string },
  ): Promise<NativeLifecycleResult>
  delete?(
    sourceSessionKey: string,
    context?: { workDir?: string },
  ): Promise<NativeLifecycleResult>
}

type CommandResult = {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  spawnErrorCode?: string
}

export type NativeLifecycleCommandRunner = (
  agentType: AgentType,
  args: string[],
  timeoutMs?: number,
  cwd?: string,
) => Promise<CommandResult>

const OUTPUT_LIMIT = 64 * 1024
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const OPENCODE_SESSION_PATTERN = /^ses_[A-Za-z0-9_-]{6,191}$/

function appendLimited(current: string, chunk: Buffer | string): string {
  if (current.length >= OUTPUT_LIMIT) return current
  return `${current}${String(chunk)}`.slice(0, OUTPUT_LIMIT)
}

export const runNativeLifecycleCommand: NativeLifecycleCommandRunner = async (
  agentType,
  args,
  timeoutMs = 10_000,
  cwd,
) => {
  if (!isAvailableBuiltinAgentType(agentType)) {
    return {
      code: null,
      stdout: '',
      stderr: '',
      timedOut: false,
      spawnErrorCode: 'command_unavailable',
    }
  }
  const spec = resolveBuiltinCommand(agentType)
  if (!spec) {
    return {
      code: null,
      stdout: '',
      stderr: '',
      timedOut: false,
      spawnErrorCode: 'command_unavailable',
    }
  }
  return await new Promise<CommandResult>((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    const proc = spawnAgentCommand(spec, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: buildAgentProcessEnv({ NO_COLOR: '1' }),
      ...(cwd ? { cwd } : {}),
    })
    const finish = (result: Omit<CommandResult, 'stdout' | 'stderr' | 'timedOut'>) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve({ ...result, stdout, stderr, timedOut })
    }
    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout = appendLimited(stdout, chunk)
    })
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr = appendLimited(stderr, chunk)
    })
    proc.on('error', (error: NodeJS.ErrnoException) => {
      finish({ code: null, spawnErrorCode: error.code ?? 'spawn_failed' })
    })
    proc.on('close', (code) => finish({ code }))
    const timer = setTimeout(() => {
      timedOut = true
      proc.kill('SIGTERM')
      setTimeout(() => proc.kill('SIGKILL'), 1_000).unref?.()
    }, timeoutMs)
    timer.unref?.()
  })
}

function safeOutput(result: CommandResult): string {
  return `${result.stdout}\n${result.stderr}`.toLowerCase()
}

function classifyCommandResult(
  result: CommandResult,
  success: 'archived' | 'deleted',
): NativeLifecycleResult {
  if (result.spawnErrorCode === 'command_unavailable' || result.spawnErrorCode === 'ENOENT') {
    return { outcome: 'unsupported' }
  }
  if (result.timedOut) return { outcome: 'transient', errorCode: 'command_timeout' }
  const output = safeOutput(result)
  if (/not found|does not exist|no session|unknown session|already (?:deleted|archived)/.test(output)) {
    return { outcome: 'already_absent' }
  }
  if (/busy|locked|writer|in use|current active session|active turn|temporar|try again|timed out|timeout/.test(output)) {
    return { outcome: 'transient', errorCode: 'native_busy' }
  }
  if (/invalid.*(?:uuid|session|id)|malformed/.test(output)) {
    return { outcome: 'invalid_identity' }
  }
  if (/permission denied|unauthenticated|authentication|forbidden/.test(output)) {
    return { outcome: 'permanent', errorCode: 'native_auth_required' }
  }
  if (result.code === 0) return { outcome: success }
  return { outcome: 'transient', errorCode: 'native_command_failed' }
}

async function commandAdvertises(
  runner: NativeLifecycleCommandRunner,
  agentType: AgentType,
  args: string[],
  pattern: RegExp,
): Promise<boolean> {
  const result = await runner(agentType, args)
  return !result.timedOut && result.code === 0 && pattern.test(`${result.stdout}\n${result.stderr}`)
}

type RpcError = Error & { rpcCode?: number }

async function codexAppServerArchiveWithSpec(
  spec: ResolvedCommandSpec,
  threadId: string,
  codexHome?: string,
): Promise<NativeLifecycleResult> {
  return await new Promise<NativeLifecycleResult>((resolve) => {
    let proc: ChildProcess | null = null
    let settled = false
    let nextId = 1
    let overallTimer: ReturnType<typeof setTimeout> | null = null
    const pending = new Map<number, {
      resolve: (value: unknown) => void
      reject: (error: RpcError) => void
    }>()
    const finish = (result: NativeLifecycleResult) => {
      if (settled) return
      settled = true
      if (overallTimer) clearTimeout(overallTimer)
      for (const request of pending.values()) request.reject(new Error('app_server_stopped'))
      pending.clear()
      proc?.kill('SIGTERM')
      resolve(result)
    }
    const request = (method: string, params: unknown): Promise<unknown> => {
      if (!proc?.stdin) return Promise.reject(new Error('app_server_unavailable'))
      const id = nextId++
      return new Promise((requestResolve, requestReject) => {
        pending.set(id, { resolve: requestResolve, reject: requestReject })
        proc!.stdin!.write(`${JSON.stringify({ id, method, params })}\n`)
      })
    }
    try {
      proc = spawnAgentCommand(spec, ['app-server', '--listen', 'stdio://'], {
        stdio: ['pipe', 'pipe', 'ignore'],
        env: buildAgentProcessEnv({ NO_COLOR: '1', ...(codexHome ? { CODEX_HOME: codexHome } : {}) }),
      })
    } catch {
      finish({ outcome: 'transient', errorCode: 'app_server_start_failed' })
      return
    }
    const lines = createInterface({ input: proc.stdout! })
    lines.on('line', (line) => {
      if (!line.trim()) return
      let message: { id?: number; result?: unknown; error?: { code?: number; message?: string } }
      try {
        message = JSON.parse(line) as typeof message
      } catch {
        return
      }
      if (message.id == null) return
      const waiter = pending.get(message.id)
      if (!waiter) return
      pending.delete(message.id)
      if (message.error) {
        const error = new Error(message.error.message ?? 'app_server_error') as RpcError
        error.rpcCode = message.error.code
        waiter.reject(error)
      } else {
        waiter.resolve(message.result)
      }
    })
    proc.on('error', () => finish({ outcome: 'transient', errorCode: 'app_server_start_failed' }))
    proc.on('close', () => {
      if (!settled) finish({ outcome: 'transient', errorCode: 'app_server_stopped' })
    })
    overallTimer = setTimeout(
      () => finish({ outcome: 'transient', errorCode: 'app_server_timeout' }),
      12_000,
    )
    overallTimer.unref?.()
    void (async () => {
      try {
        await request('initialize', {
          clientInfo: { name: 'shennian-native-cleanup', title: 'Shennian', version: '1' },
          capabilities: { experimentalApi: true },
        })
        await request('thread/archive', { threadId })
        finish({ outcome: 'archived' })
      } catch (error) {
        const rpc = error as RpcError
        const message = rpc.message.toLowerCase()
        if (/not found|does not exist|already archived|no rollout/.test(message)) {
          finish({ outcome: 'already_absent' })
        } else if (/busy|locked|writer|active turn|in use/.test(message)) {
          finish({ outcome: 'transient', errorCode: 'native_busy' })
        } else if (rpc.rpcCode === -32601 || /method not found|unsupported/.test(message)) {
          finish({ outcome: 'unsupported' })
        } else {
          finish({ outcome: 'transient', errorCode: 'app_server_failed' })
        }
      }
    })()
  })
}

export class NativeSessionLifecycleRegistry {
  private capabilities = new Map<AgentType, Promise<NativeLifecycleCapability>>()

  constructor(
    private options: {
      runner?: NativeLifecycleCommandRunner
      codexArchive?: (threadId: string) => Promise<NativeLifecycleResult>
    } = {},
  ) {}

  async execute(
    agentType: AgentType,
    sourceSessionKey: string,
    context: { workDir?: string; codexHome?: string } = {},
  ): Promise<NativeLifecycleResult> {
    if (agentType === 'codex' && context.codexHome) {
      if (!UUID_PATTERN.test(sourceSessionKey)) return { outcome: 'invalid_identity' }
      // Never fall back to a CLI archive in the default account for another home.
      const spec = resolveBuiltinCommand('codex')
      return spec ? await codexAppServerArchiveWithSpec(spec, sourceSessionKey, context.codexHome)
        : { outcome: 'unsupported' }
    }
    const adapter = this.adapter(agentType)
    const capability = await this.probe(agentType, adapter)
    if (capability.canArchive && adapter.archive) return await adapter.archive(sourceSessionKey)
    if (capability.canDelete && adapter.delete) {
      if (agentType === 'gemini' && !context.workDir) return { outcome: 'invalid_identity' }
      if ((agentType === 'gemini' || agentType === 'opencode') && context.workDir) {
        try {
          if (!fs.statSync(context.workDir).isDirectory()) {
            return { outcome: 'permanent', errorCode: 'workdir_unavailable' }
          }
        } catch {
          return { outcome: 'permanent', errorCode: 'workdir_unavailable' }
        }
      }
      return await this.deleteWithContext(adapter, sourceSessionKey, context)
    }
    return { outcome: 'unsupported' }
  }

  private async deleteWithContext(
    adapter: NativeSessionLifecycleAdapter,
    sourceSessionKey: string,
    context: { workDir?: string },
  ): Promise<NativeLifecycleResult> {
    if (!adapter.delete) return { outcome: 'unsupported' }
    return await adapter.delete(sourceSessionKey, context)
  }

  clearCapabilityCache(): void {
    this.capabilities.clear()
  }

  private probe(
    agentType: AgentType,
    adapter: NativeSessionLifecycleAdapter,
  ): Promise<NativeLifecycleCapability> {
    const existing = this.capabilities.get(agentType)
    if (existing) return existing
    const pending = adapter.probe().catch(() => ({ canArchive: false, canDelete: false }))
    this.capabilities.set(agentType, pending)
    return pending
  }

  private adapter(agentType: AgentType): NativeSessionLifecycleAdapter {
    const runner = this.options.runner ?? runNativeLifecycleCommand
    if (agentType === 'codex') {
      return {
        probe: async () => ({
          canArchive: await commandAdvertises(runner, 'codex', ['--help'], /\barchive\b/),
          canDelete: false,
        }),
        archive: async (sourceSessionKey) => {
          if (!UUID_PATTERN.test(sourceSessionKey)) return { outcome: 'invalid_identity' }
          const custom = this.options.codexArchive
          const spec = resolveBuiltinCommand('codex')
          let appServerResult: NativeLifecycleResult = { outcome: 'unsupported' }
          if (custom) appServerResult = await custom(sourceSessionKey)
          else if (spec) appServerResult = await codexAppServerArchiveWithSpec(spec, sourceSessionKey)
          if (
            appServerResult.outcome === 'archived' ||
            appServerResult.outcome === 'already_absent' ||
            appServerResult.outcome === 'invalid_identity' ||
            (appServerResult.outcome === 'transient' && appServerResult.errorCode === 'native_busy')
          ) return appServerResult
          return classifyCommandResult(
            await runner('codex', ['archive', sourceSessionKey], 15_000),
            'archived',
          )
        },
      }
    }
    if (agentType === 'gemini') {
      return {
        probe: async () => ({
          canArchive: false,
          canDelete: await commandAdvertises(runner, 'gemini', ['--help'], /--delete-session\b/),
        }),
        delete: async (sourceSessionKey, context) => {
          if (!UUID_PATTERN.test(sourceSessionKey)) return { outcome: 'invalid_identity' }
          const result = await runner(
            'gemini',
            ['--delete-session', sourceSessionKey],
            15_000,
            context?.workDir,
          )
          if (/invalid session identifier/i.test(`${result.stdout}\n${result.stderr}`)) {
            return { outcome: 'already_absent' }
          }
          return classifyCommandResult(
            result,
            'deleted',
          )
        },
      }
    }
    if (agentType === 'opencode') {
      return {
        probe: async () => ({
          canArchive: false,
          canDelete: await commandAdvertises(
            runner,
            'opencode',
            ['session', 'delete', '--help'],
            /session delete\s+<sessionID>/i,
          ),
        }),
        delete: async (sourceSessionKey, context) => {
          if (!OPENCODE_SESSION_PATTERN.test(sourceSessionKey)) {
            return { outcome: 'invalid_identity' }
          }
          return classifyCommandResult(
            await runner(
              'opencode',
              ['session', 'delete', sourceSessionKey],
              15_000,
              context?.workDir,
            ),
            'deleted',
          )
        },
      }
    }
    if (agentType === 'cursor') {
      return {
        probe: async () => {
          const result = await runner('cursor', ['--help'])
          const output = `${result.stdout}\n${result.stderr}`
          return {
            canArchive: result.code === 0 && /\barchive-chat\b/.test(output),
            canDelete: result.code === 0 && /\bdelete-chat\b/.test(output),
          }
        },
        archive: async (sourceSessionKey) => {
          if (!UUID_PATTERN.test(sourceSessionKey)) return { outcome: 'invalid_identity' }
          return classifyCommandResult(
            await runner('cursor', ['archive-chat', sourceSessionKey], 15_000),
            'archived',
          )
        },
        delete: async (sourceSessionKey) => {
          if (!UUID_PATTERN.test(sourceSessionKey)) return { outcome: 'invalid_identity' }
          return classifyCommandResult(
            await runner('cursor', ['delete-chat', sourceSessionKey], 15_000),
            'deleted',
          )
        },
      }
    }
    if (agentType === 'pi-coding-agent') {
      return {
        probe: async () => ({ canArchive: false, canDelete: true }),
        delete: async (sourceSessionKey) => {
          const outcome = deleteOwnedPiSession(sourceSessionKey)
          return outcome === 'deleted'
            ? { outcome: 'deleted' }
            : outcome === 'already_absent'
              ? { outcome: 'already_absent' }
              : { outcome: 'invalid_identity' }
        },
      }
    }
    return { probe: async () => ({ canArchive: false, canDelete: false }) }
  }
}
