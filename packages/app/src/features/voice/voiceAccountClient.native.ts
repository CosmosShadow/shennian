// @arch docs/architecture/app/chat-voice-draft.md
// @test packages/app/src/__tests__/voice-account-client.test.ts
import { authApi } from '../../config/api'
import { mergeVoiceTranscriptIntoDraft } from '../chat/utils/voice'
import type { NativeVoiceAccountClient, VoiceDraftResponse } from './voiceAccountClient.types'
export type { VoiceDraftResponse } from './voiceAccountClient.types'

export const voiceAccountClient: NativeVoiceAccountClient = {
  async finalizeText(input) {
    try {
      return await authApi<VoiceDraftResponse>('/voice/finalize-text', {
        method: 'POST', body: JSON.stringify(input),
      })
    } catch {
      // Preserve the existing mobile transcription failure behavior.
      return {
        transcript: input.transcript,
        draft: mergeVoiceTranscriptIntoDraft(input.currentDraft ?? '', input.transcript),
        intent: input.currentDraft?.trim() ? 'append' : 'new', model: 'client-transcript',
      }
    }
  },
  createDraft(input) {
    return authApi<VoiceDraftResponse>('/voice/draft', { method: 'POST', body: JSON.stringify(input) })
  },
}
