// @arch open-source/docs/cli-runtime.md

import type { ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { createHash, randomUUID } from 'node:crypto'
import { AgentAdapter, registerAgent, type AgentEvent, type AgentSendContext } from './adapter.js'
import type {
  ChatAttachmentMeta,
  CustomAgentType,
  ExternalChannelSessionStatus,
} from '@shennian/wire'
import type { CustomAgentEntry } from '../config/index.js'
import { spawnCommandString } from './command-spec.js'
import {
  buildAgentProcessEnv,
  buildManagedAgentProcessEnv,
  buildManagedNativeFullProcessEnv,
} from '../agent-env.js'
import { buildInlineChannelPreamble, buildPlatformInstructions } from './platform-instructions.js'
import {
  isManagedAgentNativeFull,
  type CompiledManagedAgentPolicy,
} from '../security/managed-agent-policy.js'
import { assertPublicAgentPolicy } from '../security/public-agent-policy.js'
import {
  collectPolicyEnforcementGaps,
  type ManagedAgentRuntimePlatform,
} from '../security/managed-agent-runtime.js'
import {
  assessCustomRuntimeSecurity,
  createCustomManagedPolicyFile,
  CUSTOM_RUNTIME_POLICY_ENV,
  disposeCustomManagedPolicyFile,
  registerCustomRuntimeSecurity,
  resolveCustomRuntimeExecutableFingerprint,
} from './custom-managed-runtime.js'
import {
  hasCustomResumeConformance,
  recordCustomResumeConformance,
} from './custom-recovery-conformance.js'

type CustomAgentProtocolEvent = {
  state: string
  text?: string
  thinking?: boolean
  name?: string
  args?: Record<string, unknown>
  result?: string
  message?: string
  title?: string
  source?: string
  usage?: { inputTokens: number; outputTokens: number }
  agentSessionId?: string
  runId?: string
  seq?: number
}

type CustomAgentProtocolResponse = {
  protocolVersion: 2
  type: 'response'
  id: string | null
  ok: boolean
  result?: { nativeSessionId?: string }
  error?: { code?: string; message?: string }
}

type CustomAgentProtocolEnvelope = {
  protocolVersion: 2
  type: 'event'
  requestId: string
  event: CustomAgentProtocolEvent & { code?: string; nativeSessionId?: string }
}

type DispatchGuard = {
  settled: boolean
  timer: ReturnType<typeof setTimeout>
  resolve: () => void
  reject: (error: Error) => void
  promise: Promise<void>
}

const DISPATCH_GUARD_MS = 3000

export class CustomAgentAdapter extends AgentAdapter {
  readonly type: CustomAgentType
  override get recoveryCapabilities() {
    return {
      inspectTerminal: false,
      reattachRun: false,
      resumeRun: false,
      resumeSession: this.entry.caps.resume === true && this.resumeConformant,
    }
  }
  private command: string
  private mode: 'spawn' | 'stdio'
  private proactive: boolean
  private entry: CustomAgentEntry

  private sessionId: string | null = null
  private agentSessionId: string | null = null
  private workDir: string | null = null
  private runId: string = ''
  private seq: number = 0
  private externalChannel: ExternalChannelSessionStatus | null = null
  private shennianSessionId: string | null = null
  private extraEnv: NodeJS.ProcessEnv = {}
  private managedAgentPolicy: CompiledManagedAgentPolicy | null = null
  private managedConfigDir: string | null = null
  private configurationRestartRequired = false
  private readonly executableFingerprint: string | undefined
  private resumeConformant: boolean
  private expectedResumedSessionId: string | null = null
  private stoppingStdioProcess = false
  private readonly pendingProtocolRequests = new Map<string, {
    resolve: (result: CustomAgentProtocolResponse['result']) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()

  // stdio mode: single long-lived process
  private stdioProcess: ChildProcess | null = null

  // spawn mode: current single-turn process
  private spawnProcess: ChildProcess | null = null
  private dispatchGuard: DispatchGuard | null = null
  private dispatchObservedEvent = false

  constructor(name: string, entry: CustomAgentEntry) {
    super()
    this.type = `custom:${name}` as CustomAgentType
    this.entry = entry
    this.command = entry.command
    this.mode = entry.caps.mode
    this.proactive = entry.caps.proactive ?? false
    this.executableFingerprint = resolveCustomRuntimeExecutableFingerprint(entry)
    this.resumeConformant = hasCustomResumeConformance(
      this.type,
      this.executableFingerprint,
      entry.caps.version,
    )
  }

  private get usesNodeStdioV2(): boolean {
    return this.entry.caps.protocol === 'shennian-node-stdio' &&
      this.entry.caps.protocolVersion === 2
  }

  async start(sessionId: string, workDir: string, agentSessionId?: string | null): Promise<void> {
    this.sessionId = sessionId
    this.workDir = this.managedAgentPolicy?.adapterPolicy.workDir ?? workDir
    this.seq = 0
    if (agentSessionId) {
      this.agentSessionId = agentSessionId
      this.expectedResumedSessionId = agentSessionId
    }

    if (this.mode === 'stdio') {
      await this.startStdioProcess()
      if (this.usesNodeStdioV2) {
        const result = await this.sendProtocolRequest('start', {
          sessionId,
          workDir: this.workDir,
        })
        if (result?.nativeSessionId) this.agentSessionId = result.nativeSessionId
      }
      if (agentSessionId) await this.resume(agentSessionId)
    }
  }

  configure(options: {
    sessionId?: string
    externalChannel?: ExternalChannelSessionStatus | null
    env?: NodeJS.ProcessEnv
    managedAgentPolicy?: CompiledManagedAgentPolicy | null
  }): void {
    const previousFingerprint = this.configurationFingerprint()
    this.shennianSessionId = options.sessionId ?? null
    this.externalChannel = options.externalChannel ?? null
    this.extraEnv = options.env ?? {}
    if ('managedAgentPolicy' in options) {
      this.managedAgentPolicy = options.managedAgentPolicy ?? null
    }
    if (this.managedAgentPolicy) this.workDir = this.managedAgentPolicy.adapterPolicy.workDir
    if (
      previousFingerprint !== this.configurationFingerprint() &&
      (this.stdioProcess || this.spawnProcess)
    ) {
      this.configurationRestartRequired = true
    }
  }

  async send(
    text: string,
    modelId?: string,
    _reasoningEffort?: string,
    _attachments?: ChatAttachmentMeta[],
    agentSystemPrompt?: string | null,
    context?: AgentSendContext,
  ): Promise<void> {
    if (context?.source === 'published_agent') assertPublicAgentPolicy(this.managedAgentPolicy)
    if (context?.source === 'room_activation' && !this.managedAgentPolicy) {
      throw new Error('managed_agent_policy_missing')
    }
    if (this.configurationRestartRequired) {
      if (this.mode === 'stdio') await this.stopStdioProcess()
      else await this.killSpawnProcess()
      this.configurationRestartRequired = false
    }
    this.runId = randomUUID()
    this.seq = 0

    if (this.mode === 'stdio') {
      if (this.usesNodeStdioV2) {
        await this.sendStdioV2(
          text,
          buildPlatformInstructions(
            this.workDir ?? process.cwd(),
            this.externalChannel,
            this.shennianSessionId ?? undefined,
            agentSystemPrompt,
          ),
          modelId,
          _reasoningEffort,
          _attachments,
        )
      } else {
        const outgoing = `${buildInlineChannelPreamble(this.workDir ?? process.cwd(), this.externalChannel, this.shennianSessionId ?? undefined, agentSystemPrompt)}${text}`
        await this.sendStdio(outgoing, modelId)
      }
    } else {
      const outgoing = `${buildInlineChannelPreamble(this.workDir ?? process.cwd(), this.externalChannel, this.shennianSessionId ?? undefined, agentSystemPrompt)}${text}`
      await this.runSpawn(outgoing, modelId)
    }
  }

  async resume(agentSessionId: string): Promise<void> {
    if (this.mode === 'stdio') {
      if (this.usesNodeStdioV2) {
        const result = await this.sendProtocolRequest('resume', {
          sessionId: this.sessionId,
          nativeSessionId: agentSessionId,
        })
        this.agentSessionId = result?.nativeSessionId ?? agentSessionId
        return
      }
      const msg = JSON.stringify({
        method: 'resume',
        id: randomUUID(),
        params: { sessionId: this.sessionId, agentSessionId },
      })
      this.stdioProcess?.stdin?.write(msg + '\n')
    }
  }

  async stop(): Promise<void> {
    if (this.mode === 'stdio') {
      await this.stopStdioProcess()
    } else {
      await this.killSpawnProcess()
    }
  }

  // ─── Spawn mode ───────────────────────────────────────────────────────────

  private async runSpawn(text: string, modelId?: string): Promise<void> {
    await this.killSpawnProcess()

    const args = ['/run', '--workdir', this.workDir ?? process.cwd()]
    if (this.sessionId) args.push('--session', this.sessionId)
    if (this.agentSessionId) args.push('--resume', this.agentSessionId)
    if (modelId) args.push('--model', modelId)

    const managedLaunch = await this.prepareManagedLaunch()
    let proc: ChildProcess
    try {
      proc = spawnCommandString(this.command, args, {
        cwd: this.workDir ?? undefined,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: managedLaunch.env,
      })
    } catch (error) {
      await this.disposeManagedConfig(managedLaunch.configDir)
      throw error
    }
    this.spawnProcess = proc
    this.managedConfigDir = managedLaunch.configDir
    const guard = this.startDispatchGuard()
    this.dispatchObservedEvent = false

    this.attachOutputHandlers(proc, () => {
      if (this.spawnProcess === proc) this.spawnProcess = null
      void this.disposeManagedConfig(managedLaunch.configDir)
    })

    proc.stdin?.once('error', (error) => this.rejectDispatch(error))
    proc.stdin?.write(text)
    proc.stdin?.end()
    await guard.promise
  }

  private async killSpawnProcess(): Promise<void> {
    const proc = this.spawnProcess
    if (!proc) {
      await this.disposeManagedConfig(this.managedConfigDir)
      return
    }
    this.spawnProcess = null
    proc.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      proc.on('close', resolve)
      setTimeout(() => {
        proc.kill('SIGKILL')
        resolve()
      }, 3000)
    })
    await this.disposeManagedConfig(this.managedConfigDir)
  }

  // ─── Stdio mode ───────────────────────────────────────────────────────────

  private async startStdioProcess(): Promise<void> {
    const managedLaunch = await this.prepareManagedLaunch()
    let proc: ChildProcess
    try {
      proc = spawnCommandString(
        this.command,
        ['/start', '--workdir', this.workDir ?? process.cwd()],
        {
          cwd: this.workDir ?? undefined,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: managedLaunch.env,
        },
      )
    } catch (error) {
      await this.disposeManagedConfig(managedLaunch.configDir)
      throw error
    }
    this.stdioProcess = proc
    this.managedConfigDir = managedLaunch.configDir

    this.attachOutputHandlers(proc, () => {
      if (this.stdioProcess === proc) {
        this.stdioProcess = null
        void this.disposeManagedConfig(managedLaunch.configDir)
        if (!this.stoppingStdioProcess) {
          this.emit('error', new Error('Custom agent process exited unexpectedly'))
        }
      }
    })
  }

  private async sendStdio(text: string, modelId?: string): Promise<void> {
    if (!this.stdioProcess) {
      await this.startStdioProcess()
    }
    const guard = this.startDispatchGuard()
    this.dispatchObservedEvent = false

    const msg = JSON.stringify({
      method: 'send',
      id: randomUUID(),
      params: {
        sessionId: this.sessionId,
        text,
        modelId,
      },
    })

    this.stdioProcess?.stdin?.once('error', (error) => this.rejectDispatch(error))
    this.stdioProcess?.stdin?.write(msg + '\n')
    await guard.promise
  }

  private async sendStdioV2(
    text: string,
    systemPrompt: string,
    modelId?: string,
    reasoningEffort?: string,
    attachments?: ChatAttachmentMeta[],
  ): Promise<void> {
    if (!this.stdioProcess) {
      await this.startStdioProcess()
      await this.sendProtocolRequest('start', {
        sessionId: this.sessionId,
        workDir: this.workDir,
      })
    }
    this.dispatchObservedEvent = false
    await this.sendProtocolRequest('send', {
      sessionId: this.sessionId,
      text,
      systemPrompt,
      modelId,
      reasoningEffort,
      attachments: attachments?.map((attachment) => ({
        path: attachment.path,
        name: attachment.name,
        mime: attachment.mimeType,
      })) ?? [],
    })
  }

  private async stopStdioProcess(): Promise<void> {
    const proc = this.stdioProcess
    if (!proc) {
      await this.disposeManagedConfig(this.managedConfigDir)
      return
    }

    this.stoppingStdioProcess = true
    const closed = new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        proc.kill('SIGTERM')
        setTimeout(() => {
          proc.kill('SIGKILL')
          resolve()
        }, 3000)
      }, 5000)

      proc.on('close', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    if (this.usesNodeStdioV2) {
      await this.sendProtocolRequest('stop', {}).catch(() => {})
    } else {
      const stopMsg = JSON.stringify({ method: 'stop', id: randomUUID() })
      proc.stdin?.write(stopMsg + '\n')
    }
    await closed

    this.stdioProcess = null
    await this.disposeManagedConfig(this.managedConfigDir)
    this.stoppingStdioProcess = false
  }

  private async prepareManagedLaunch(): Promise<{
    env: NodeJS.ProcessEnv
    configDir: string | null
  }> {
    const compiled = this.managedAgentPolicy
    if (!compiled) {
      return { env: buildAgentProcessEnv(this.extraEnv), configDir: null }
    }
    if (isManagedAgentNativeFull(compiled)) {
      return { env: buildManagedNativeFullProcessEnv(this.extraEnv), configDir: null }
    }

    const executableFingerprint = resolveCustomRuntimeExecutableFingerprint(this.entry)
    if (
      !compiled.enforcement.executableFingerprint ||
      executableFingerprint !== compiled.enforcement.executableFingerprint
    ) {
      throw new Error('custom_managed_runtime_executable_changed')
    }
    if (compiled.enforcement.level !== 'unverified') {
      throw new Error('custom_managed_runtime_protection_must_be_unverified')
    }

    const assessment = assessCustomRuntimeSecurity(this.entry)
    if (
      assessment.state === 'declared' &&
      compiled.enforcement.runtimeVersion !== this.entry.caps.version
    ) {
      throw new Error('custom_managed_runtime_version_changed')
    }
    if (assessment.state === 'declared') {
      const declaredProfile =
        assessment.declaration.platforms[
          compiled.enforcement.platform as ManagedAgentRuntimePlatform
        ]
      const gaps = collectPolicyEnforcementGaps(compiled.requestedPolicy, declaredProfile ?? null)
      if (gaps.unavailableCapabilities.length > 0) {
        throw new Error(
          `custom_managed_runtime_capability_unavailable:${gaps.unavailableCapabilities.join(',')}`,
        )
      }
    }

    const env = buildManagedAgentProcessEnv({
      agentType: this.type,
      providerEnv: this.extraEnv,
      sessionEnv: this.extraEnv,
      runtimeEnv: { NO_COLOR: '1' },
    })
    if (assessment.state === 'unverified') {
      // The Policy Compiler only emits this snapshot after the user confirms
      // unverified operation. No native filesystem or network limit is claimed.
      return { env, configDir: null }
    }

    const policyFile = await createCustomManagedPolicyFile(compiled)
    env[CUSTOM_RUNTIME_POLICY_ENV] = policyFile.policyPath
    return { env, configDir: policyFile.directory }
  }

  private async disposeManagedConfig(configDir: string | null): Promise<void> {
    if (!configDir) return
    if (this.managedConfigDir === configDir) this.managedConfigDir = null
    await disposeCustomManagedPolicyFile(configDir).catch(() => {})
  }

  private configurationFingerprint(): string {
    const env = Object.keys(this.extraEnv)
      .sort()
      .map((key) => [key, this.extraEnv[key] ?? null])
    return createHash('sha256')
      .update(
        JSON.stringify({
          sessionId: this.shennianSessionId,
          externalChannel: this.externalChannel,
          env,
          managedAgentPolicy: this.managedAgentPolicy,
        }),
      )
      .digest('hex')
  }

  // ─── Shared output parsing ────────────────────────────────────────────────

  private attachOutputHandlers(proc: ChildProcess, onClose: () => void): void {
    const rl = createInterface({ input: proc.stdout! })
    rl.on('line', (line) => {
      if (!line.trim()) return
      try {
        const parsed = JSON.parse(line) as
          | CustomAgentProtocolEvent
          | CustomAgentProtocolResponse
          | CustomAgentProtocolEnvelope
        if ('type' in parsed && parsed.type === 'response') {
          this.handleProtocolResponse(parsed)
        } else if ('type' in parsed && parsed.type === 'event') {
          this.handleProtocolEvent({
            ...parsed.event,
            agentSessionId: parsed.event.nativeSessionId,
          })
        } else {
          this.handleProtocolEvent(parsed)
        }
      } catch {
        // ignore malformed lines
      }
    })

    let stderrBuf = ''
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString()
    })

    proc.on('close', (code) => {
      onClose()
      this.rejectPendingProtocolRequests(new Error(`Custom agent process exited with code ${code ?? 'unknown'}`))
      if (code !== 0 && code !== null) {
        const msg = stderrBuf.trim() || `Agent exited with code ${code}`
        this.rejectDispatch(new Error(msg))
        this.emitEvent({ state: 'error', message: msg })
      } else if (!this.dispatchObservedEvent) {
        this.rejectDispatch(new Error('Custom agent exited without protocol events'))
      } else {
        this.acceptDispatch()
      }
    })

    proc.on('error', (err) => {
      onClose()
      this.rejectDispatch(err)
      this.emit('error', err)
    })
  }

  private handleProtocolResponse(response: CustomAgentProtocolResponse): void {
    if (!response.id) return
    const pending = this.pendingProtocolRequests.get(response.id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pendingProtocolRequests.delete(response.id)
    if (response.ok) {
      pending.resolve(response.result)
      return
    }
    pending.reject(new Error(response.error?.message ?? response.error?.code ?? 'Adapter request failed'))
  }

  private sendProtocolRequest(
    method: 'start' | 'send' | 'resume' | 'stop',
    params: Record<string, unknown>,
  ): Promise<CustomAgentProtocolResponse['result']> {
    const processInput = this.stdioProcess?.stdin
    if (!processInput?.writable) return Promise.reject(new Error('Custom adapter stdio is not writable'))
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingProtocolRequests.delete(id)
        reject(new Error(`Timed out waiting for custom adapter ${method} response`))
      }, method === 'send' ? DISPATCH_GUARD_MS : 5000)
      this.pendingProtocolRequests.set(id, { resolve, reject, timer })
      processInput.write(`${JSON.stringify({ protocolVersion: 2, id, method, params })}\n`, (error) => {
        if (!error) return
        const pending = this.pendingProtocolRequests.get(id)
        if (!pending) return
        clearTimeout(pending.timer)
        this.pendingProtocolRequests.delete(id)
        pending.reject(error)
      })
    })
  }

  private rejectPendingProtocolRequests(error: Error): void {
    for (const pending of this.pendingProtocolRequests.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pendingProtocolRequests.clear()
  }

  private handleProtocolEvent(event: CustomAgentProtocolEvent): void {
    const { state } = event
    if (!state) return
    this.dispatchObservedEvent = true

    switch (state) {
      case 'delta':
        this.acceptDispatch()
        this.emitEvent({ state: 'delta', text: event.text ?? '', thinking: event.thinking })
        break
      case 'final':
        this.acceptDispatch()
        if (
          this.expectedResumedSessionId &&
          event.agentSessionId === this.expectedResumedSessionId &&
          this.executableFingerprint
        ) {
          recordCustomResumeConformance(
            this.type,
            this.executableFingerprint,
            this.entry.caps.version,
          )
          this.resumeConformant = true
          this.expectedResumedSessionId = null
        }
        if (event.agentSessionId) this.agentSessionId = event.agentSessionId
        this.emitEvent({
          state: 'final',
          usage: event.usage,
          agentSessionId: this.agentSessionId ?? undefined,
        })
        break
      case 'error':
        this.rejectDispatch(new Error(event.message ?? 'unknown error'))
        this.emitEvent({ state: 'error', message: event.message ?? 'unknown error' })
        break
      case 'tool-call':
        this.acceptDispatch()
        this.emitEvent({ state: 'tool-call', name: event.name ?? '', args: event.args })
        break
      case 'tool-result':
        this.acceptDispatch()
        this.emitEvent({ state: 'tool-result', name: event.name ?? '', result: event.result ?? '' })
        break
      case 'notify':
        this.acceptDispatch()
        this.emitEvent({
          state: 'notify',
          text: event.text ?? '',
          title: event.title,
          source: event.source,
        })
        break
    }
  }

  private startDispatchGuard(): DispatchGuard {
    this.acceptDispatch()
    let guard!: DispatchGuard
    const promise = new Promise<void>((resolve, reject) => {
      guard = {
        settled: false,
        timer: setTimeout(() => this.acceptDispatch(guard), DISPATCH_GUARD_MS),
        resolve,
        reject,
        promise: Promise.resolve(),
      }
    })
    guard.promise = promise
    this.dispatchGuard = guard
    return guard
  }

  private acceptDispatch(guard = this.dispatchGuard): void {
    if (!guard || guard.settled) return
    guard.settled = true
    clearTimeout(guard.timer)
    if (this.dispatchGuard === guard) this.dispatchGuard = null
    guard.resolve()
  }

  private rejectDispatch(error: Error, guard = this.dispatchGuard): void {
    if (!guard || guard.settled) return
    guard.settled = true
    clearTimeout(guard.timer)
    if (this.dispatchGuard === guard) this.dispatchGuard = null
    guard.reject(error)
  }

  private emitEvent(partial: Omit<AgentEvent, 'runId' | 'seq'>): void {
    const event: AgentEvent = { ...partial, runId: this.runId, seq: this.seq++ }
    this.emit('agentEvent', event)
  }
}

export function registerCustomAgent(name: string, entry: CustomAgentEntry): void {
  const agentType = `custom:${name}` as CustomAgentType
  registerCustomRuntimeSecurity(agentType, entry)
  registerAgent(agentType, () => new CustomAgentAdapter(name, entry))
}
