// @arch open-source/docs/wire.md
// @test open-source/packages/server/src/__tests__/voice-chief-realtime.test.ts

import type { AgentType, SessionRunPhase } from './session.ts'

export type VoiceChiefConversationBrief = {
  conversationId: string
  title: string
  agentType: AgentType
  modelId?: string | null
  status: 'active' | 'completed' | 'failed'
  runPhase?: SessionRunPhase | null
  canStop?: boolean
  lastActivityAt: string
  lastMessagePreview?: string | null
}

export type VoiceChiefProjectBrief = {
  projectId: string
  displayName: string
  summary: string
  machineId: string
  machineName: string
  machineStatus: 'online' | 'offline' | 'unknown'
  recentProgress: string[]
  conversations: VoiceChiefConversationBrief[]
}

export type VoiceChiefReadableMessage = {
  id: string
  role: 'user' | 'agent'
  ts: number
  text: string
}

export type VoiceChiefOperationStatus = {
  status: 'ok' | 'created' | 'delivered' | 'stopped' | 'scheduled' | 'cancelled' | 'ended' | 'unavailable' | 'failed'
  message: string
  projectId?: string
  projectName?: string
  conversationId?: string
  conversationTitle?: string
}

export type VoiceChiefToolCallDebug = {
  callId: string
  name: string
  argumentsJson: string
  createdAt: string
}

export type VoiceChiefTaskCompletionNotifyMode = 'message' | 'call'

export type VoiceChiefVoiceId =
  | 'longanqian'
  | 'longanlingxin'
  | 'longanlingxi'
  | 'longanxiaoxin'
  | 'longanlufeng'

export type VoiceChiefVoiceOption = {
  id: VoiceChiefVoiceId
  labelKey: string
  default?: boolean
}

export type VoiceChiefPreferences = {
  voice: VoiceChiefVoiceId
  options: VoiceChiefVoiceOption[]
}

export type VoiceChiefClientFrame =
  | {
      type: 'start'
      projectHint?: string
      voice?: string
      debugTools?: boolean
      incomingCallId?: string
      initialPrompt?: string
      reason?: string
      reconnectAttempt?: number
      timeZone?: string
    }
  | { type: 'playback_complete'; responseId: string }
  | { type: 'ping' }
  | { type: 'end' }

export type VoiceChiefServerFrame =
  | {
      type: 'ready'
      conversationId: string
      inputSampleRate: 16_000
      outputSampleRate: 24_000
      projects: VoiceChiefProjectBrief[]
    }
  | { type: 'status'; state: 'connecting' | 'listening' | 'thinking' | 'speaking' | 'ended' }
  | { type: 'input_transcript'; text: string; final: boolean }
  | { type: 'output_transcript'; text: string; final: boolean; responseId?: string }
  | { type: 'audio_start'; responseId: string; sampleRate: 24_000 }
  | { type: 'audio_done'; responseId: string }
  | { type: 'audio_cancel'; responseId: string }
  | ({ type: 'operation_status' } & VoiceChiefOperationStatus)
  | { type: 'tool_call'; call: VoiceChiefToolCallDebug }
  | { type: 'hang_up'; reason?: string; delayMs?: number }
  | { type: 'pong' }
  | { type: 'error'; code: string; message: string; recoverable: boolean }
