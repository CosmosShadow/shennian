// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/agent-workspace-validation.test.ts

import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  isAvailableAgentType,
  type AgentType,
  type ReqFrame,
  type SessionMode,
} from '@shennian/wire'
import { createAgent, type AgentAdapter, type AgentEvent } from '../../agents/adapter.js'
import { buildManagedAgentEnv } from '../../agents/config-status.js'
import { ManagerModeAdapter } from '../../agents/manager.js'
import { NativeSessionLifecycleRegistry } from '../native-session-lifecycle.js'
import type { SessionManagerRuntime } from '../types.js'
import { validateManagedAgentWorkDir } from '../../security/managed-agent-policy.js'

const VALIDATION_PROMPT = '请回复 hello，用于确认你已准备好。'
const VALIDATION_TIMEOUT_MS = 60_000
// A stuck adapter must not hold the reply back once the deadline has passed.
const VALIDATION_STOP_TIMEOUT_MS = 8_000
/** Worst case before the caller gets a structured answer; must stay below the CLI's IPC wait. */
export const AGENT_VALIDATION_MAX_DURATION_MS = VALIDATION_TIMEOUT_MS + VALIDATION_STOP_TIMEOUT_MS
const nativeLifecycle = new NativeSessionLifecycleRegistry()

export type AgentWorkspaceValidationInput = {
  runtimeAdapter: AgentType
  workDir: string
  modelId?: string | null
  sessionMode: SessionMode
}

export type AgentWorkspaceValidationResult =
  | { ok: true }
  | { ok: false; errorCode: string }

type ValidationDependencies = {
  createAdapter?: (type: AgentType) => AgentAdapter | null
  resolveWorkDir?: (workDir: string) => Promise<string>
  validateWorkDir?: (workDir: string) => Promise<boolean>
  timeoutMs?: number
  stopTimeoutMs?: number
  cleanupNativeSession?: (agentType: AgentType, sessionId: string, workDir: string) => void
  ignoreNativeSession?: (agentType: AgentType, sessionId: string) => void
}

export async function validateAgentWorkspaceConfiguration(
  input: AgentWorkspaceValidationInput,
  dependencies: ValidationDependencies = {},
): Promise<AgentWorkspaceValidationResult> {
  try {
    return await runAgentWorkspaceValidation(input, dependencies)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    return { ok: false, errorCode: message === 'agent_validation_cleanup_failed'
      ? message : classifyRuntimeError(error, 'start') }
  }
}

async function runAgentWorkspaceValidation(
  input: AgentWorkspaceValidationInput,
  dependencies: ValidationDependencies,
): Promise<AgentWorkspaceValidationResult> {
  if (
    !isAvailableAgentType(input.runtimeAdapter) ||
    input.runtimeAdapter === 'manager' ||
    input.runtimeAdapter === 'pi' ||
    input.runtimeAdapter === 'openclaw'
  ) {
    return { ok: false, errorCode: 'agent_validation_runtime_unavailable' }
  }
  if (!path.isAbsolute(input.workDir.trim())) {
    return { ok: false, errorCode: 'agent_validation_workdir_invalid' }
  }

  let resolvedWorkDir: string
  try {
    resolvedWorkDir = await (dependencies.resolveWorkDir ?? resolveWorkDir)(input.workDir)
  } catch (error) {
    return { ok: false, errorCode: classifyWorkDirError(error) }
  }
  const workDirAllowed = dependencies.validateWorkDir
    ? await dependencies.validateWorkDir(resolvedWorkDir)
    : (await validateManagedAgentWorkDir(resolvedWorkDir, async () => resolvedWorkDir)).ok
  if (!workDirAllowed) {
    return { ok: false, errorCode: 'agent_validation_workdir_invalid' }
  }

  const baseAdapter = (dependencies.createAdapter ?? createAgent)(input.runtimeAdapter)
  if (!baseAdapter) return { ok: false, errorCode: 'agent_validation_runtime_unavailable' }
  const adapter = input.sessionMode === 'manager'
    ? new ManagerModeAdapter(
        baseAdapter,
        input.runtimeAdapter as Exclude<AgentType, 'manager' | 'pi' | 'openclaw'>,
      )
    : baseAdapter
  const validationSessionId = `agent-validation-${randomUUID()}`
  let nativeSessionId = ''
  let responseText = ''
  let timeout: ReturnType<typeof setTimeout> | null = null
  let timedOut = false
  let finish: ((outcome: { kind: 'final' } | { kind: 'error'; error: unknown }) => void) | null = null
  const terminal = new Promise<{ kind: 'final' } | { kind: 'error'; error: unknown }>((resolve) => {
    finish = resolve
  })
  const onEvent = (event: AgentEvent) => {
    if (event.agentSessionId) {
      nativeSessionId = event.agentSessionId
      dependencies.ignoreNativeSession?.(input.runtimeAdapter, nativeSessionId)
    }
    if (event.state === 'delta' && !event.thinking && event.text) responseText += event.text
    if (event.state === 'final') {
      if (event.text) responseText += event.text
      finish?.({ kind: 'final' })
    } else if (event.state === 'error' || event.state === 'aborted') {
      finish?.({ kind: 'error', error: event.message ?? event.state })
    }
  }
  const onError = (error: Error) => finish?.({ kind: 'error', error })
  adapter.on('agentEvent', onEvent)
  adapter.on('error', onError)
  const execute = async (): Promise<AgentWorkspaceValidationResult> => {
    adapter.configure?.({
      sessionId: validationSessionId,
      env: buildManagedAgentEnv(input.runtimeAdapter),
    })
    // One deadline covers start and reply: an adapter that hangs while starting
    // must produce the same structured failure as one that never answers.
    const timeoutOutcome = new Promise<{ kind: 'timeout' }>((resolve) => {
      timeout = setTimeout(
        () => resolve({ kind: 'timeout' }),
        dependencies.timeoutMs ?? VALIDATION_TIMEOUT_MS,
      )
    })
    const started = await Promise.race([
      Promise.resolve()
        .then(() => adapter.start(validationSessionId, resolvedWorkDir, null, { persistNativeSession: false }))
        .then(() => ({ kind: 'started' as const }), (error: unknown) => ({ kind: 'error' as const, error })),
      timeoutOutcome,
    ])
    if (started.kind === 'timeout') {
      timedOut = true
      return { ok: false, errorCode: 'agent_validation_start_failed' }
    }
    if (started.kind === 'error') {
      return { ok: false, errorCode: classifyRuntimeError(started.error, 'start') }
    }
    const execution = adapter
      .send(VALIDATION_PROMPT, input.modelId ?? undefined)
      .then(() => terminal)
      .catch((error: unknown) => ({ kind: 'error' as const, error }))
    const outcome = await Promise.race([execution, timeoutOutcome])
    if (outcome.kind === 'timeout') {
      timedOut = true
      return { ok: false, errorCode: 'agent_validation_response_timeout' }
    }
    if (outcome.kind === 'error') {
      return { ok: false, errorCode: classifyRuntimeError(outcome.error, 'response') }
    }
    return responseText.toLowerCase().includes('hello')
      ? { ok: true }
      : { ok: false, errorCode: 'agent_validation_response_mismatch' }
  }
  let result: AgentWorkspaceValidationResult
  try {
    result = await execute()
  } finally {
    if (timeout) clearTimeout(timeout)
    adapter.removeListener('agentEvent', onEvent)
    adapter.removeListener('error', onError)
    await stopWithin(adapter, dependencies.stopTimeoutMs ?? VALIDATION_STOP_TIMEOUT_MS)
    // After a timeout the host is likely overloaded; launching more CLI processes
    // to delete the hello session would add to it. The session stays marked internal.
    if (nativeSessionId && !timedOut) {
      const cleanup = dependencies.cleanupNativeSession ?? ((agentType, sessionId, workDir) => {
        void nativeLifecycle.execute(agentType, sessionId, { workDir }).catch(() => {})
      })
      cleanup(input.runtimeAdapter, nativeSessionId, resolvedWorkDir)
    }
  }
  return result
}

async function stopWithin(adapter: AgentAdapter, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null
  await Promise.race([
    adapter.stop().catch(() => {}),
    new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs) }),
  ])
  if (timer) clearTimeout(timer)
}

export async function handleAgentWorkspaceValidation(
  runtime: SessionManagerRuntime,
  req: ReqFrame,
): Promise<void> {
  const parsed = parseInput(req.params)
  if (!parsed) {
    runtime.client.sendRes({
      type: 'res',
      id: req.id,
      ok: false,
      error: 'agent_validation_invalid_configuration',
    })
    return
  }
  const result = await validateAgentWorkspaceConfiguration(parsed, {
    ignoreNativeSession: (agentType, sessionId) => {
      runtime.nativeFusion?.ignoreNativeSource(agentType, sessionId)
    },
  })
  runtime.client.sendRes(
    result.ok
      ? { type: 'res', id: req.id, ok: true, payload: { ready: true } }
      : { type: 'res', id: req.id, ok: false, error: result.errorCode },
  )
}

async function resolveWorkDir(workDir: string): Promise<string> {
  const trimmed = workDir.trim()
  if (!trimmed) throw Object.assign(new Error('workdir_required'), { code: 'EINVAL' })
  const resolved = await fs.realpath(trimmed)
  const stat = await fs.stat(resolved)
  if (!stat.isDirectory()) throw Object.assign(new Error('workdir_not_directory'), { code: 'ENOTDIR' })
  return resolved
}

function classifyWorkDirError(error: unknown): string {
  const code = errorCode(error)
  if (code === 'ENOENT') return 'agent_validation_workdir_not_found'
  if (code === 'ENOTDIR') return 'agent_validation_workdir_not_directory'
  if (code === 'EACCES' || code === 'EPERM') return 'agent_validation_workdir_unavailable'
  return 'agent_validation_workdir_invalid'
}

function classifyRuntimeError(error: unknown, stage: 'start' | 'response'): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message === 'agent_validation_server_upgrade_required') return message
  if (/model.*(?:not found|unavailable|unsupported|invalid|access denied|permission denied|not (?:allowed|authorized))|(?:access|permission) denied.*model|unknown model/i.test(message)) {
    return 'agent_validation_model_unavailable'
  }
  if (/quota|insufficient.*(?:credit|balance)|billing|rate.?limit|\b429\b/i.test(message)) {
    return 'agent_validation_quota_exceeded'
  }
  if (/not found|enoent|command .* missing|is .* installed/i.test(message)) {
    return 'agent_validation_runtime_unavailable'
  }
  if (/unauth|authentication|not logged|login required|api key|token.*missing|forbidden|401|403/i.test(message)) {
    return 'agent_validation_runtime_auth_required'
  }
  if (/ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|network|fetch failed|connection.*(?:failed|closed|refused)/i.test(message)) {
    return 'agent_validation_network_failed'
  }
  return stage === 'start'
    ? 'agent_validation_start_failed'
    : 'agent_validation_response_failed'
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error && 'code' in error
    ? String((error as NodeJS.ErrnoException).code)
    : ''
}

function parseInput(params: Record<string, unknown>): AgentWorkspaceValidationInput | null {
  const runtimeAdapter = typeof params.runtimeAdapter === 'string' ? params.runtimeAdapter : ''
  const workDir = typeof params.workDir === 'string' ? params.workDir : ''
  const sessionMode = params.sessionMode === 'manager' ? 'manager' : 'standard'
  if (!isAvailableAgentType(runtimeAdapter) || !workDir.trim()) return null
  return {
    runtimeAdapter,
    workDir,
    sessionMode,
    modelId: typeof params.modelId === 'string' ? params.modelId : null,
  }
}
