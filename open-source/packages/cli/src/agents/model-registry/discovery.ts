import { personalModelSummary } from '../../personal-agent/model-settings.js'
// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/model-switching.test.ts

import type { BuiltinAgentType, ModelInfo } from '@shennian/wire'
import type { ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { DetectedAgent } from '../detect.js'
import { resolveBuiltinCommand, spawnResolvedCommand } from '../command-spec.js'
import {
  fallbackClaudeAliasModels,
  discoverClaudeAliasModelsFromEnv,
  fallbackCodexModels,
  fallbackWorkBuddyModels,
  fallbackGeminiModels,
  parseCodexAppServerModels,
  parseCursorModels,
  parseOpenCodeModels,
} from './parsers.js'
import { runResolvedCommand } from './runner.js'
import {
  DISCOVERY_WORKDIR,
  ModelDiscoveryFallbackError,
  type DiscoveryContext,
  type ModelDiscoveryFailureCode,
} from './types.js'
import { buildAgentProcessEnv, readLatestUserEnv } from '../../agent-env.js'
import { CODEX_APP_SERVER_CLIENT_INFO } from '../codex-utils.js'
import { PiRpcClient } from '../pi-rpc-client.js'
import { discoverOpenCodeModelsViaApi } from './opencode-api.js'
import { discoverNodeAdapterModels } from '../node-adapter.js'

type AppServerRpcMessage = {
  id?: number
  result?: unknown
  error?: { message?: string; code?: number }
}

function classifyCodexDiscoveryFailure(error: unknown): ModelDiscoveryFailureCode {
  const message = error instanceof Error ? error.message : ''
  if (/timed out/i.test(message)) return 'app_server_timeout'
  if (/\berror\b|invalid|unsupported|unknown (?:method|field)/i.test(message)) {
    return 'app_server_rpc_error'
  }
  return 'app_server_unavailable'
}

function sendAppServerRpc(
  proc: ChildProcess,
  pending: Map<number, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timer: NodeJS.Timeout
  }>,
  id: number,
  method: string,
  params: unknown,
  timeoutMs: number,
): Promise<unknown> {
  if (!proc.stdin) return Promise.reject(new Error('codex app-server stdin unavailable'))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`codex app-server request timed out: ${method}`))
    }, timeoutMs)
    pending.set(id, { resolve, reject, timer })
    proc.stdin!.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
      if (!error) return
      clearTimeout(timer)
      pending.delete(id)
      reject(error)
    })
  })
}

async function discoverCodexModelsViaAppServer(spec: NonNullable<ReturnType<typeof resolveBuiltinCommand>>): Promise<ModelInfo[]> {
  const proc = spawnResolvedCommand(spec, ['app-server', '--listen', 'stdio://'], {
    cwd: DISCOVERY_WORKDIR,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: buildAgentProcessEnv({ NO_COLOR: '1' }),
  })
  const pending = new Map<number, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timer: NodeJS.Timeout
  }>()
  let seq = 1
  const rl = createInterface({ input: proc.stdout! })
  rl.on('line', (line) => {
    if (!line.trim()) return
    let msg: AppServerRpcMessage
    try {
      msg = JSON.parse(line) as AppServerRpcMessage
    } catch {
      return
    }
    if (msg.id == null) return
    const request = pending.get(msg.id)
    if (!request) return
    clearTimeout(request.timer)
    pending.delete(msg.id)
    if (msg.error) {
      request.reject(new Error(msg.error.message || `codex app-server error ${msg.error.code ?? ''}`.trim()))
    } else {
      request.resolve(msg.result)
    }
  })

  try {
    await sendAppServerRpc(proc, pending, seq++, 'initialize', {
      clientInfo: CODEX_APP_SERVER_CLIENT_INFO,
      capabilities: { experimentalApi: true },
    }, 10_000)
    const [modelList, configRead] = await Promise.all([
      sendAppServerRpc(proc, pending, seq++, 'model/list', {}, 15_000),
      sendAppServerRpc(proc, pending, seq++, 'config/read', {}, 15_000).catch(() => null),
    ])
    const config = typeof configRead === 'object' && configRead !== null && 'config' in configRead
      ? (configRead as { config?: unknown }).config
      : undefined
    return parseCodexAppServerModels({
      ...(typeof modelList === 'object' && modelList !== null ? (modelList as Record<string, unknown>) : {}),
      config,
    })
  } finally {
    for (const [id, request] of pending) {
      clearTimeout(request.timer)
      request.reject(new Error('codex app-server stopped'))
      pending.delete(id)
    }
    proc.kill('SIGTERM')
    setTimeout(() => proc.kill('SIGKILL'), 1000).unref()
  }
}

async function discoverCursorModels(): Promise<ModelInfo[]> {
  const spec = resolveBuiltinCommand('cursor')
  if (!spec) return []
  const result = await runResolvedCommand(spec, ['--list-models'])
  return parseCursorModels(result.stdout)
}

// OpenClaw support is intentionally disabled.
// async function discoverOpenClawModels(): Promise<ModelInfo[]> {
//   const spec = resolveBuiltinCommand('openclaw')
//   if (!spec) return []
//   const result = await runResolvedCommand(spec, ['models', 'list', '--json'])
//   return parseOpenClawModels(result.stdout)
// }

async function discoverOpenCodeModels(): Promise<ModelInfo[]> {
  const spec = resolveBuiltinCommand('opencode')
  if (!spec) return []
  const scoped = await discoverOpenCodeModelsViaApi().catch(() => [])
  if (scoped.length > 0) return scoped
  const result = await runResolvedCommand(spec, ['models'])
  return parseOpenCodeModels(result.stdout)
}

async function discoverPiCodingAgentModels(): Promise<ModelInfo[]> {
  const spec = resolveBuiltinCommand('pi-coding-agent')
  if (!spec) return []
  const proc = spawnResolvedCommand(
    spec,
    [
      '--mode', 'rpc',
      '--no-session',
      '--offline',
      '--no-extensions',
      '--no-skills',
      '--no-prompt-templates',
      '--no-context-files',
      '--no-tools',
    ],
    {
      cwd: DISCOVERY_WORKDIR,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: buildAgentProcessEnv({ NO_COLOR: '1' }),
    },
  )
  const rpc = new PiRpcClient(proc, { requestTimeoutMs: 10_000 })
  try {
    const [available, stateResponse] = await Promise.all([
      rpc.request('get_available_models'),
      rpc.request('get_state'),
    ])
    const availableData = available.data && typeof available.data === 'object'
      ? available.data as { models?: unknown }
      : {}
    const stateData = stateResponse.data && typeof stateResponse.data === 'object'
      ? stateResponse.data as { model?: { id?: unknown; provider?: unknown } }
      : {}
    const defaultId =
      typeof stateData.model?.id === 'string' && typeof stateData.model.provider === 'string'
        ? `${stateData.model.provider}/${stateData.model.id}`
        : null
    if (!Array.isArray(availableData.models)) return []
    const discovered = availableData.models.flatMap((value): ModelInfo[] => {
      if (!value || typeof value !== 'object') return []
      const model = value as Record<string, unknown>
      if (typeof model.id !== 'string' || typeof model.provider !== 'string') return []
      const id = `${model.provider}/${model.id}`
      const efforts = model.reasoning === true
        ? ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map((effort) => ({
            id: effort,
            name: effort,
          }))
        : undefined
      return [{
        id,
        name: typeof model.name === 'string' && model.name.trim() ? model.name : model.id,
        provider: model.provider,
        isDefault: id === defaultId,
        ...(efforts ? { supportedReasoningEfforts: efforts, defaultReasoningEffort: 'medium' } : {}),
      }]
    })
    return discovered
  } catch {
    return []
  } finally {
    rpc.close()
    proc.kill('SIGTERM')
    setTimeout(() => proc.kill('SIGKILL'), 1_000).unref()
  }
}

async function discoverClaudeModels(): Promise<ModelInfo[]> {
  const spec = resolveBuiltinCommand('claude')
  if (!spec) return []
  const shellEnv = readLatestUserEnv()
  const shellEnvModels = discoverClaudeAliasModelsFromEnv(shellEnv)
  if (shellEnvModels.length > 0) return shellEnvModels
  const fallbackModels = fallbackClaudeAliasModels(shellEnv)
  const help = await runResolvedCommand(spec, ['--help'], 3_000).catch(() => null)
  if (!help || /\bfable\b/i.test(`${help.stdout}\n${help.stderr}`)) return fallbackModels
  return fallbackModels.filter((model) => model.id !== 'fable')
}

async function discoverCodexModels(): Promise<ModelInfo[]> {
  const spec = resolveBuiltinCommand('codex')
  if (!spec) return []
  let appServerModels: ModelInfo[]
  try {
    appServerModels = await discoverCodexModelsViaAppServer(spec)
  } catch (error) {
    throw new ModelDiscoveryFallbackError(
      'codex',
      classifyCodexDiscoveryFailure(error),
      fallbackCodexModels(),
    )
  }
  if (appServerModels.length === 0) {
    throw new ModelDiscoveryFallbackError('codex', 'empty_model_list', fallbackCodexModels())
  }
  return appServerModels
}

async function discoverGeminiModels(): Promise<ModelInfo[]> {
  if (!resolveBuiltinCommand('gemini')) return []
  return fallbackGeminiModels()
}

const fallbackPiModels: ModelInfo[] = [
  { id: 'qwen3.6-plus', name: 'Qwen 3.6 Plus', provider: 'dashscope', isDefault: true },
]

const managerModels: ModelInfo[] = [
  { id: 'codex', name: 'Codex', provider: 'shennian', isDefault: true },
  { id: 'claude', name: 'Claude Code', provider: 'shennian' },
]

async function discoverPiModels(context: DiscoveryContext): Promise<ModelInfo[]> {
  if (!context.serverUrl || !context.authToken) return fallbackPiModels
  try {
    const response = await fetch(`${context.serverUrl.replace(/\/$/, '')}/api/models`, {
      headers: {
        Authorization: `Bearer ${context.authToken}`,
      },
    })
    if (!response.ok) return fallbackPiModels
    const data = (await response.json()) as {
      models?: Array<{ id: string; name?: string; provider?: string }>
      default?: string
    }
    const models = (data.models ?? []).map((model) => ({
      id: model.id,
      name: model.name?.trim() || model.id,
      provider: model.provider,
      isDefault: model.id === data.default,
    }))
    return models.length > 0 ? models : fallbackPiModels
  } catch {
    return fallbackPiModels
  }
}

async function discoverBuiltinModels(type: BuiltinAgentType, context: DiscoveryContext): Promise<ModelInfo[]> {
  switch (type) {
    case 'shennian': {
      const model = personalModelSummary()
      return [{ id: model.model, name: model.model, isDefault: true }]
    }
    case 'claude':
      return discoverClaudeModels()
    case 'codex':
      return discoverCodexModels()
    case 'workbuddy':
      return resolveBuiltinCommand('workbuddy') ? fallbackWorkBuddyModels() : []
    case 'gemini':
      return discoverGeminiModels()
    case 'cursor':
      return discoverCursorModels()
    case 'openclaw':
      // OpenClaw support is intentionally disabled.
      return []
    case 'opencode':
      return discoverOpenCodeModels()
    case 'pi':
      return discoverPiModels(context)
    case 'pi-coding-agent':
      return discoverPiCodingAgentModels()
    case 'manager':
      return managerModels
  }
}

export async function discoverModelsForAgent(agent: DetectedAgent, context: DiscoveryContext): Promise<ModelInfo[]> {
  if (agent.type.startsWith('custom:')) {
    if (agent.nodeAdapter) return discoverNodeAdapterModels(agent.nodeAdapter)
    return agent.models ?? []
  }
  // ACP models only exist inside a live provider session; they reach the cache
  // through recordAcpAgentModels, never through a probe.
  if (agent.type.startsWith('acp:')) return []
  return discoverBuiltinModels(agent.type as BuiltinAgentType, context)
}
