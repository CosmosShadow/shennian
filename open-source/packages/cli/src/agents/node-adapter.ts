// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/node-adapter-agent.test.ts

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AgentType, ChatAttachmentMeta, CustomAgentType, ModelInfo } from '@shennian/wire'
import { buildAgentProcessEnv, buildManagedNativeFullProcessEnv } from '../agent-env.js'
import type { NodeAdapterRegistration } from '../adapter-kit/registry.js'
import { ADAPTER_PROTOCOL_VERSION } from '../adapter-kit/types.js'
import {
  AgentAdapter,
  registerAgent,
  unregisterAgent,
  type AgentEvent,
  type AgentSendContext,
} from './adapter.js'

type RuntimeResponse = {
  type: 'response'
  id: string | null
  ok: boolean
  result?: Record<string, unknown>
  error?: { code?: string; message?: string }
}

type RuntimeEvent = {
  type: 'event'
  requestId: string
  event: {
    state: string
    text?: string
    thinking?: boolean
    name?: string
    args?: Record<string, unknown>
    result?: string
    code?: string
    nativeSessionId?: string
  }
}

type NodeAdapterAgentOptions = {
  hostPath?: string
  nodeArgs?: string[]
  timeoutMs?: number
}

const DEFAULT_REQUEST_TIMEOUT_MS = 60_000
const DEFAULT_SYSTEM_PROMPT = 'You are a helpful AI assistant. Follow the user request accurately and safely.'
const registeredNodeAdapterNames = new Set<string>()

/**
 * Bridges a checked Adapter V1 Runtime subprocess into the daemon's existing
 * AgentAdapter event boundary. User code remains isolated in the Runtime host;
 * this daemon-side class only speaks the public JSON Lines protocol.
 */
export class NodeAdapterAgent extends AgentAdapter {
  readonly type: CustomAgentType
  private readonly hostPath: string
  private readonly nodeArgs: string[]
  private readonly timeoutMs: number
  private proc: ChildProcessWithoutNullStreams | null = null
  private stdoutBuffer = ''
  private pending = new Map<string, {
    resolve: (response: RuntimeResponse) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()
  private sessionId = ''
  private workDir = ''
  private nativeSessionId: string | null = null
  private systemPrompt: string | null = null
  private activeRequestId: string | null = null
  private runId = ''
  private seq = 0
  private extraEnv: NodeJS.ProcessEnv = {}
  private managed = false
  private stopping = false

  constructor(
    private readonly adapterName: string,
    private readonly registration: NodeAdapterRegistration,
    options: NodeAdapterAgentOptions = {},
  ) {
    super()
    this.type = `custom:${adapterName}`
    this.hostPath = options.hostPath ?? fileURLToPath(new URL('../../bin/shennian-adapter-host.js', import.meta.url))
    this.nodeArgs = options.nodeArgs ?? []
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  }

  configure(options: { env?: NodeJS.ProcessEnv; managedAgentPolicy?: unknown | null }): void {
    this.extraEnv = options.env ?? {}
    this.managed = Boolean(options.managedAgentPolicy)
  }

  async start(sessionId: string, workDir: string, agentSessionId?: string | null): Promise<void> {
    this.sessionId = sessionId
    this.workDir = workDir
    this.nativeSessionId = agentSessionId?.trim() || null
    this.systemPrompt = null
  }

  async send(
    text: string,
    modelId?: string,
    reasoningEffort?: string,
    attachments?: ChatAttachmentMeta[],
    systemPrompt?: string | null,
    _context?: AgentSendContext,
  ): Promise<void> {
    if (!this.sessionId || !this.workDir) throw new Error('node_adapter_session_not_started')
    if (this.activeRequestId) throw new Error('node_adapter_turn_active')
    const selectedModel = modelId?.trim() || this.registration.defaultModel
    if (!this.registration.models.includes(selectedModel)) throw new Error('node_adapter_model_unavailable')
    const nextPrompt = systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT

    if (this.proc && this.systemPrompt !== nextPrompt) {
      await this.stopRuntime()
      this.nativeSessionId = null
    }
    await this.ensureRuntime(nextPrompt, selectedModel)

    const requestId = crypto.randomUUID()
    this.activeRequestId = requestId
    this.runId = crypto.randomUUID()
    this.seq = 0
    this.emitAgentEvent({ state: 'start' })
    const response = await this.request('send', {
      text,
      modelId: selectedModel,
      ...(reasoningEffort?.trim() ? { reasoningEffort: reasoningEffort.trim() } : {}),
      attachments: (attachments ?? []).map((attachment) => ({
        path: attachment.path,
        ...(attachment.name ? { name: attachment.name } : {}),
        ...(attachment.mimeType ? { mime: attachment.mimeType } : {}),
      })),
    }, requestId)
    if (!response.ok) {
      this.activeRequestId = null
      throw new Error(`node_adapter_${response.error?.code ?? 'send_failed'}`)
    }
  }

  async resume(agentSessionId: string): Promise<void> {
    await this.stopRuntime()
    this.nativeSessionId = agentSessionId.trim() || null
    this.systemPrompt = null
  }

  async stop(): Promise<void> {
    await this.stopRuntime()
  }

  private async ensureRuntime(systemPrompt: string, modelId: string): Promise<void> {
    if (!this.proc) this.spawnRuntime()
    if (this.systemPrompt) return
    const method = this.nativeSessionId ? 'resume' : 'start'
    const response = await this.request(method, {
      sessionId: this.sessionId,
      workDir: this.workDir,
      modelId,
      systemPrompt,
      ...(this.nativeSessionId ? { nativeSessionId: this.nativeSessionId } : {}),
    })
    if (!response.ok) {
      await this.stopRuntime()
      throw new Error(`node_adapter_${response.error?.code ?? `${method}_failed`}`)
    }
    const returnedId = typeof response.result?.nativeSessionId === 'string'
      ? response.result.nativeSessionId.trim()
      : ''
    if (!returnedId || (this.nativeSessionId && returnedId !== this.nativeSessionId)) {
      await this.stopRuntime()
      throw new Error('node_adapter_resume_failed')
    }
    this.nativeSessionId = returnedId
    this.systemPrompt = systemPrompt
    this.emit('nativeSession', this.type as AgentType, returnedId)
  }

  private spawnRuntime(): void {
    const env = this.managed
      ? buildManagedNativeFullProcessEnv(this.extraEnv)
      : buildAgentProcessEnv(this.extraEnv)
    const proc = spawn(
      process.execPath,
      [...this.nodeArgs, this.hostPath, this.registration.entryPath, '--workdir', this.workDir],
      { cwd: this.workDir, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    ) as ChildProcessWithoutNullStreams
    this.proc = proc
    this.stopping = false
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => this.onStdout(chunk))
    proc.on('error', () => this.onRuntimeClosed(proc))
    proc.on('close', () => this.onRuntimeClosed(proc))
    // Never relay arbitrary stderr from user code: it may contain environment
    // values, absolute paths, provider responses or other private material.
    proc.stderr.resume()
  }

  private onStdout(chunk: string): void {
    this.stdoutBuffer += chunk
    let newline = this.stdoutBuffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1)
      if (line) this.onRuntimeLine(line)
      newline = this.stdoutBuffer.indexOf('\n')
    }
  }

  private onRuntimeLine(line: string): void {
    let message: RuntimeResponse | RuntimeEvent
    try {
      message = JSON.parse(line) as RuntimeResponse | RuntimeEvent
    } catch {
      return
    }
    if (message.type === 'response' && message.id) {
      const waiter = this.pending.get(message.id)
      if (!waiter) return
      clearTimeout(waiter.timer)
      this.pending.delete(message.id)
      waiter.resolve(message)
      return
    }
    if (message.type !== 'event' || message.requestId !== this.activeRequestId) return
    const event = message.event
    if (event.state === 'delta') {
      this.emitAgentEvent({ state: 'delta', text: event.text ?? '', thinking: event.thinking })
      return
    }
    if (event.state === 'tool-call') {
      this.emitAgentEvent({ state: 'tool-call', name: event.name, args: event.args })
      return
    }
    if (event.state === 'tool-result') {
      this.emitAgentEvent({ state: 'tool-result', name: event.name, result: event.result })
      return
    }
    if (event.nativeSessionId?.trim()) {
      const nextNativeSessionId = event.nativeSessionId.trim()
      if (nextNativeSessionId !== this.nativeSessionId) {
        this.nativeSessionId = nextNativeSessionId
        this.emit('nativeSession', this.type as AgentType, nextNativeSessionId)
      }
    }
    this.activeRequestId = null
    if (event.state === 'final') {
      this.emitAgentEvent({ state: 'final', agentSessionId: this.nativeSessionId ?? undefined })
    } else if (event.state === 'error' && event.code === 'stopped') {
      this.emitAgentEvent({ state: 'aborted', agentSessionId: this.nativeSessionId ?? undefined })
    } else if (event.state === 'error') {
      this.emitAgentEvent({
        state: 'error',
        message: `Local Adapter turn failed (${event.code ?? 'send_failed'}).`,
        agentSessionId: this.nativeSessionId ?? undefined,
      })
    }
  }

  private request(
    method: string,
    params: Record<string, unknown>,
    id = crypto.randomUUID(),
  ): Promise<RuntimeResponse> {
    const proc = this.proc
    if (!proc?.stdin.writable) return Promise.reject(new Error('node_adapter_runtime_unavailable'))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`node_adapter_${method}_timeout`))
      }, this.timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      proc.stdin.write(`${JSON.stringify({ protocolVersion: ADAPTER_PROTOCOL_VERSION, id, method, params })}\n`)
    })
  }

  private async stopRuntime(): Promise<void> {
    const proc = this.proc
    if (!proc) return
    this.stopping = true
    if (this.systemPrompt && proc.stdin.writable) {
      await this.request('stop', { reason: 'client_stop' }).catch(() => null)
    }
    if (this.proc === proc && !proc.killed) proc.kill('SIGTERM')
    if (this.proc === proc) this.proc = null
    this.systemPrompt = null
    this.activeRequestId = null
  }

  private onRuntimeClosed(proc: ChildProcessWithoutNullStreams): void {
    if (this.proc !== proc) return
    this.proc = null
    this.systemPrompt = null
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer)
      waiter.reject(new Error('node_adapter_runtime_exited'))
    }
    this.pending.clear()
    if (this.activeRequestId && !this.stopping) {
      this.activeRequestId = null
      this.emitAgentEvent({ state: 'error', message: 'Local Adapter Runtime exited before the turn completed.' })
    }
  }

  private emitAgentEvent(event: Omit<AgentEvent, 'runId' | 'seq'>): void {
    this.emit('agentEvent', { ...event, runId: this.runId, seq: this.seq++ })
  }
}

/** Synchronize only V1 registrations; legacy custom runtimes keep their own registry. */
export function syncNodeAdapterAgents(
  registrations: Record<string, NodeAdapterRegistration>,
  excludedNames: ReadonlySet<string> = new Set(),
): void {
  for (const name of registeredNodeAdapterNames) {
    if (!excludedNames.has(name)) unregisterAgent(`custom:${name}` as CustomAgentType)
  }
  registeredNodeAdapterNames.clear()
  for (const [name, registration] of Object.entries(registrations)) {
    if (excludedNames.has(name)) continue
    registerAgent(`custom:${name}` as CustomAgentType, () => new NodeAdapterAgent(name, registration))
    registeredNodeAdapterNames.add(name)
  }
}

/** Re-runs V1 listModels for `agent discover --refresh`; no model turn is sent. */
export async function discoverNodeAdapterModels(
  registration: NodeAdapterRegistration,
  options: NodeAdapterAgentOptions = {},
): Promise<ModelInfo[]> {
  const hostPath = options.hostPath ?? fileURLToPath(new URL('../../bin/shennian-adapter-host.js', import.meta.url))
  const workDir = registration.workDir || path.dirname(registration.entryPath)
  const proc = spawn(
    process.execPath,
    [...(options.nodeArgs ?? []), hostPath, registration.entryPath, '--workdir', workDir],
    { cwd: workDir, env: buildAgentProcessEnv(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
  ) as ChildProcessWithoutNullStreams
  proc.stderr.resume()
  proc.stdout.setEncoding('utf8')
  const id = crypto.randomUUID()
  const response = await new Promise<RuntimeResponse>((resolve, reject) => {
    let buffer = ''
    const timer = setTimeout(() => {
      reject(new Error('node_adapter_models_timeout'))
    }, options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS)
    const finish = (callback: () => void) => {
      clearTimeout(timer)
      callback()
    }
    proc.on('error', () => finish(() => reject(new Error('node_adapter_runtime_unavailable'))))
    proc.on('close', () => finish(() => reject(new Error('node_adapter_runtime_exited'))))
    proc.stdout.on('data', (chunk: string) => {
      buffer += chunk
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
        if (!line) continue
        try {
          const message = JSON.parse(line) as RuntimeResponse
          if (message.type === 'response' && message.id === id) {
            finish(() => resolve(message))
            return
          }
        } catch {
          // Ignore non-protocol stdout; the timeout/close path remains bounded.
        }
      }
    })
    proc.stdin.write(`${JSON.stringify({
      protocolVersion: ADAPTER_PROTOCOL_VERSION,
      id,
      method: 'listModels',
      params: { workDir },
    })}\n`)
  }).finally(() => {
    if (!proc.killed) proc.kill('SIGTERM')
  })
  if (!response.ok || !Array.isArray(response.result?.models)) {
    throw new Error(`node_adapter_${response.error?.code ?? 'models_invalid'}`)
  }
  const defaultModel = typeof response.result.defaultModel === 'string' ? response.result.defaultModel : ''
  return response.result.models.map((model): ModelInfo => {
    const item = typeof model === 'string' ? { id: model, name: model } : model as { id: string; name?: string }
    return { id: item.id, name: item.name ?? item.id, isDefault: item.id === defaultModel }
  })
}
