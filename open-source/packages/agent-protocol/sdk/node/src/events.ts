export type DeltaEvent = { state: 'delta'; text: string; thinking?: boolean }
export type FinalEvent = { state: 'final'; usage?: { inputTokens: number; outputTokens: number } }
export type ErrorEvent = { state: 'error'; message: string }
export type ToolCallEvent = { state: 'tool-call'; name: string; args?: Record<string, unknown> }
export type ToolResultEvent = { state: 'tool-result'; name: string; result: string }
export type NotifyEvent = { state: 'notify'; text: string; title?: string; source?: string }

export type AgentEvent =
  | DeltaEvent
  | FinalEvent
  | ErrorEvent
  | ToolCallEvent
  | ToolResultEvent
  | NotifyEvent

export type BaseFields = { runId?: string; seq?: number; agentSessionId?: string }

export type Caps = {
  name: string
  model: string
  models?: string[]
  defaultModel?: string
  mode: 'spawn' | 'stdio'
  proactive?: boolean
  resume?: boolean
  version?: string
}

export type Attachment = { path: string; name: string; mime: string }

export type SendParams = {
  text: string
  sessionId: string
  attachments: Attachment[]
  modelId?: string
}

export type ResumeParams = {
  sessionId: string
  agentSessionId: string
}

export type StdinMessage =
  | { method: 'send'; id?: string; params: SendParams }
  | { method: 'resume'; id?: string; params: ResumeParams }
  | { method: 'stop'; id?: string }
