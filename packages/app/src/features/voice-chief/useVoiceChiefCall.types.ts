// @arch docs/features/voice-shennian.md
import type { VoiceChiefServerFrame } from '@shennian/wire'
export type VoiceChiefCallState = 'connecting' | 'reconnecting' | 'listening' | 'thinking' | 'speaking' | 'ended' | 'error'
export type VoiceChiefTranscript = { id: string; role: 'user' | 'chief'; text: string; final: boolean }
export type VoiceChiefOperationUpdate = Extract<VoiceChiefServerFrame, { type: 'operation_status' }>
export type VoiceChiefCallOptions = { projectHint?: string; incomingCallId?: string; initialPrompt?: string; reason?: string }
