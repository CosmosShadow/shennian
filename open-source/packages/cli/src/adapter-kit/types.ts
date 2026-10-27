// @arch open-source/docs/cli-runtime.md
// 神念 Adapter 协议 V1：open-source/packages/agent-protocol/PROTOCOL.md

/** JSON Lines 协议版本；V1 只有这一个版本，不提供多协议选择。 */
export const ADAPTER_PROTOCOL_VERSION = 1

/** 协议第 8 节定义的稳定错误码；自动化只依赖错误码，不依赖可变文案。 */
export type AdapterErrorCode =
  | 'invalid_json'
  | 'invalid_request'
  | 'method_not_found'
  | 'adapter_contract_invalid'
  | 'models_invalid'
  | 'session_not_started'
  | 'session_already_started'
  | 'turn_active'
  | 'system_prompt_unsupported'
  | 'start_failed'
  | 'send_failed'
  | 'stop_failed'
  | 'resume_failed'
  | 'stopped'

export type AdapterError = { code: AdapterErrorCode; message: string }

export type AdapterModel = { id: string; name?: string }

/** `listModels` 的返回值；`models` 必须动态发现，且至少包含一个模型。 */
export type ModelList = {
  models: Array<string | AdapterModel>
  defaultModel: string
}

export type AdapterAttachment = { path: string; name?: string; mime?: string }

export type ListModelsInput = { workDir: string }

export type StartInput = {
  sessionId: string
  workDir: string
  modelId: string
  /** Client 为该 Session 生成的完整、不可变系统提示词；必须映射到真实 system/instructions 通道。 */
  systemPrompt: string
}

/** `start` 与 `resume` 共用的返回结构；`session` 只留在 Runtime 子进程内存中。 */
export type SessionResult = { session: unknown; nativeSessionId: string }

export type AdapterUsage = { inputTokens: number; outputTokens: number }

/** Runtime 提供给 `send` 的输出通道；协议第 5 节。 */
export type AdapterOutput = {
  delta(text: string, options?: { thinking?: boolean }): void
  toolCall(name: string, args?: Record<string, unknown>): void
  toolResult(name: string, result: string): void
  setNativeSessionId(id: string): void
  final(usage?: AdapterUsage): void
  error(message: string, code?: AdapterErrorCode): void
}

export type SendInput = {
  sessionId: string
  session: unknown
  /** 只承载当前用户消息；系统提示词已经由 start / resume 建立，不在这里传递。 */
  text: string
  modelId: string
  reasoningEffort?: string
  attachments: AdapterAttachment[]
  signal: AbortSignal
  output: AdapterOutput
}

export type StopInput = {
  sessionId: string
  session: unknown
  reason: 'client_stop' | 'process_shutdown'
}

export type ResumeInput = {
  sessionId: string
  /** 必须恢复这个精确原生 Session；禁止选择“最近一次”。 */
  nativeSessionId: string
  workDir: string
  modelId: string
  systemPrompt: string
}

/**
 * `adapter.mjs` 默认导出的对象。五个生命周期函数全部必需，不支持用
 * capability 声明省略；上游不支持任一能力时，该实现不满足协议。
 */
export type NodeAdapterDefinition = {
  name: string
  version: string
  listModels: (input: ListModelsInput) => ModelList | Promise<ModelList>
  start: (input: StartInput) => SessionResult | Promise<SessionResult>
  send: (input: SendInput) => void | Promise<void>
  stop: (input: StopInput) => void | Promise<void>
  resume: (input: ResumeInput) => SessionResult | Promise<SessionResult>
}

export const NODE_ADAPTER_REQUIRED_METHODS = [
  'listModels',
  'start',
  'send',
  'stop',
  'resume',
] as const

export type AdapterMethod = 'listModels' | 'start' | 'send' | 'stop' | 'resume'

export type AdapterRequest = {
  protocolVersion: 1
  id: string
  method: AdapterMethod
  params: Record<string, unknown>
}

export type AdapterResponse = {
  protocolVersion: 1
  type: 'response'
  id: string | null
  ok: boolean
  result?: Record<string, unknown>
  error?: AdapterError
}

export type AdapterWireEventState = 'delta' | 'tool-call' | 'tool-result' | 'final' | 'error'

export type AdapterWireEvent = {
  protocolVersion: 1
  type: 'event'
  requestId: string
  event: {
    state: AdapterWireEventState
    text?: string
    thinking?: boolean
    name?: string
    args?: Record<string, unknown>
    result?: string
    message?: string
    code?: AdapterErrorCode
    usage?: AdapterUsage
    nativeSessionId?: string
  }
}

export type AdapterWireMessage = AdapterResponse | AdapterWireEvent
