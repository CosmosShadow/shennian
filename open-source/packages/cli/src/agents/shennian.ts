import { stewardCoreContext } from '../steward/context.js'
import fs from 'node:fs'
import { personalModelSummary } from '../personal-agent/model-settings.js'
// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/personal-agent-adapter.test.ts
import { buildManagedNativeFullProcessEnv } from '../agent-env.js'
import { isManagedAgentNativeFull, type CompiledManagedAgentPolicy } from '../security/managed-agent-policy.js'
import { buildPlatformInstructions } from './platform-instructions.js'
import { randomUUID } from 'node:crypto'
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import type { ChatAttachmentMeta } from '@shennian/wire'
import { AgentAdapter, registerAgent, type AgentEvent, type AgentSendContext, type AgentStartOptions } from './adapter.js'
import { openPersonalAgent, type PersonalSdkSession } from '../personal-agent/sdk-session.js'

/** Bundled SDK, not an installed `pi` command or the legacy Nian `pi` identity. */
export class ShennianAdapter extends AgentAdapter {
  readonly type = 'shennian' as const
  override get recoveryCapabilities() { return { inspectTerminal: false, reattachRun: false, resumeRun: false, resumeSession: true } }
  private managedPolicy: CompiledManagedAgentPolicy | null = null
  private validation = false
  private sessionId = ''
  private cwd = ''
  private nativeId?: string | null
  private env: NodeJS.ProcessEnv = {}
  private sdk?: PersonalSdkSession
  private runId = ''
  private seq = 0
  private active = false
  private preparing = false
  private generation = 0
  private aborted = false
  private failure = false
  private failureMessage = '个人助手请求失败，尚未确认任务完成；请稍后重试。'
  private fail(error: unknown) {
    this.failure = true
    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
    if (/timed?\s*out|timeout/i.test(message)) this.failureMessage = '模型请求超时，本次工作已中断；已执行的操作不会自动撤销，请先查看日程或任务结果，再决定是否重试。'
    if (/nian_quota_exceeded|personal_model_monthly_quota_exceeded/.test(message)) this.failureMessage = '模型额度不足，本次工作中断；请检查额度或模型设置后再试。'
  }
  private inflight?: Promise<void>
  private unsubscribe?: () => void
  configure(options: Parameters<NonNullable<AgentAdapter['configure']>>[0]) {
    // The in-process SDK has no sandbox. Never let a public/restricted session fall through.
    const policy = options.managedAgentPolicy ?? null
    if (options.externalChannel || (policy && !isManagedAgentNativeFull(policy)) || (options.managedRoomContextToken && !policy)) throw new Error('personal_agent_managed_runtime_unsupported')
    if ((this.active || this.preparing || this.sdk) && JSON.stringify(policy) !== JSON.stringify(this.managedPolicy)) throw new Error('personal_agent_policy_change_requires_stop')
    this.managedPolicy = policy
    this.env = policy ? buildManagedNativeFullProcessEnv(options.env) : { ...options.env }
  }
  async start(sessionId: string, workDir: string, agentSessionId?: string | null, options?: AgentStartOptions) {
    if (this.active || this.preparing) throw new Error('personal_agent_busy')
    this.validation = options?.persistNativeSession === false
    this.sessionId = sessionId; this.cwd = this.managedPolicy?.adapterPolicy.workDir ?? workDir; this.nativeId = agentSessionId
  }
  private event(event: Omit<AgentEvent, 'runId' | 'seq'>) { this.emit('agentEvent', { ...event, runId: this.runId, seq: ++this.seq }) }
  private onEvent(event: AgentSessionEvent) {
    if (event.type === 'message_update') {
      const delta = event.assistantMessageEvent
      if (delta.type === 'text_delta') this.event({ state: 'delta', text: delta.delta })
      if (delta.type === 'thinking_delta') this.event({ state: 'delta', text: delta.delta, thinking: true })
    } else if (event.type === 'tool_execution_start') {
      this.event({ state: 'tool-call', name: event.toolName, toolCallId: event.toolCallId, args: event.args })
    } else if (event.type === 'tool_execution_end') {
      const content = event.result as { content?: Array<{ type: string; text?: string }> }
      this.event({ state: 'tool-result', name: event.toolName, toolCallId: event.toolCallId, result: content.content?.filter(c => c.type === 'text').map(c => c.text ?? '').join('\n') ?? '' })
    } else if (event.type === 'compaction_start') {
      this.event({ state: 'notify', runPhase: 'thinking', message: 'Compressing conversation context' })
    } else if (event.type === 'compaction_end' && event.errorMessage && !event.aborted) {
      this.failure = true
    } else if (event.type === 'message_end' && event.message.role === 'assistant') {
      if (event.message.stopReason === 'error') this.fail(event.message.errorMessage)
      if (event.message.stopReason === 'aborted') this.aborted = true
    }
  }
  async send(text: string, _modelId?: string, _effort?: string, attachments?: ChatAttachmentMeta[], systemPrompt?: string | null, context?: AgentSendContext) {
    if (context?.source === 'published_agent') throw new Error('personal_agent_public_runtime_unsupported')
    if ((this.managedPolicy || this.validation) && _modelId && _modelId !== personalModelSummary().model) throw new Error('builtin_agent_model_unavailable')
    if (this.active || this.preparing) throw new Error('personal_agent_busy')
    // Attachment transport must be explicitly implemented; never silently drop the user's files.
    const images: Array<{ type: 'image'; data: string; mimeType: string }> = []
    let imageBytes = 0
    const files: string[] = []
    for (const file of attachments ?? []) {
      if (file.kind !== 'image') { files.push(`[${file.name}](<${file.path}>)`); continue }
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimeType)) throw new Error('personal_agent_image_unsupported')
      let data = file.previewData?.replace(/^data:[^,]+,/, '') ?? ''
      if (!data) {
        const stat = fs.statSync(file.path)
        if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw new Error('personal_agent_image_too_large')
        data = fs.readFileSync(file.path).toString('base64')
      }
      imageBytes += data.length
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data) || imageBytes > 5 * 1024 * 1024) throw new Error('personal_agent_image_too_large')
      images.push({ type: 'image', data, mimeType: file.mimeType })
    }
    const personalContext = !this.managedPolicy && !this.validation && this.env.SHENNIAN_STEWARD_SESSION_ID === this.sessionId ? stewardCoreContext(this.sessionId) : ''
    const prompt = [personalContext ? `<personal-context-data>\n${personalContext}\n</personal-context-data>` : '', text, ...files].filter(Boolean).join('\n\n')
    this.preparing = true
    const generation = this.generation
    try {
    if (!this.sdk) {
      const opened = await openPersonalAgent(this.sessionId, this.cwd, this.nativeId, () => this.env, this.managedPolicy || this.validation ? buildPlatformInstructions(this.cwd, null, this.sessionId, systemPrompt) : systemPrompt ?? '', this.validation ? 'validation' : this.managedPolicy ? 'managed-native-full' : 'personal')
      if (generation !== this.generation) { opened.session.dispose(); opened.cleanup?.(); throw new Error('personal_agent_cancelled') }
      this.nativeId = opened.session.sessionId
      // A failed ownership commit must not leave a usable, unowned SDK session.
      try { if (!this.validation) this.emit('nativeSession', this.type, this.nativeId) }
      catch (error) { opened.session.dispose(); opened.cleanup?.(); throw error }
      this.sdk = opened
      this.unsubscribe = opened.session.subscribe(event => this.onEvent(event))
    }
    await this.sdk.refreshModel()
    if (generation !== this.generation) throw new Error('personal_agent_cancelled')
    } finally { this.preparing = false }
    this.runId = randomUUID(); this.seq = 0; this.active = true; this.aborted = false; this.failure = false; this.failureMessage = '个人助手请求失败，尚未确认任务完成；请稍后重试。'
    this.event({ state: 'start', agentSessionId: this.nativeId ?? undefined })
    const sdk = this.sdk
    this.inflight = (async () => {
      try { await sdk.session.prompt(prompt, { expandPromptTemplates: false, ...(images.length ? { images } : {}) }); sdk.persist() }
      catch (error) { this.fail(error) }
      finally {
        this.active = false
        this.event(this.aborted ? { state: 'aborted' } : this.failure ? { state: 'error', message: this.failureMessage } : { state: 'final' })
      }
    })()
    // Dispatch ACK, not completion. The queue advances only after the terminal event.
  }
  async resume(id: string) {
    if (this.sdk && this.sdk.session.sessionId !== id) {
      if (this.active || this.preparing) throw new Error('personal_agent_busy')
      this.unsubscribe?.(); this.sdk.session.dispose(); this.sdk.cleanup?.(); this.sdk = undefined
    }
    this.nativeId = id
  }
  async getStatus() { return { active: this.active, runId: this.active ? this.runId : null, canStop: this.active } }
  async stop() {
    this.generation++
    if (this.active) { this.aborted = true; await this.sdk?.session.abort(); await this.inflight }
    this.unsubscribe?.(); this.sdk?.session.dispose(); this.sdk?.cleanup?.(); this.sdk = undefined
  }
}
registerAgent('shennian', () => new ShennianAdapter())
