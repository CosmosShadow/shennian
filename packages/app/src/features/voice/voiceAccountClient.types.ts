// @arch docs/features/desktop-local-first-client.md#33-进程职责
export type VoiceDraftResponse = {
  transcript: string
  draft: string
  intent: 'new' | 'append' | 'edit' | 'clarify'
  model: string
}
export type VoiceTextInput = {
  sessionId: string
  currentDraft?: string
  transcript: string
  cleanup?: boolean
}
export type VoiceAudioInput = {
  sessionId: string
  currentDraft?: string
  audioBase64: string
  audioMimeType?: string
}
export type VoiceAccountClient = {
  finalizeText(input: VoiceTextInput): Promise<VoiceDraftResponse>
}
export type NativeVoiceAccountClient = VoiceAccountClient & {
  createDraft(input: VoiceAudioInput): Promise<VoiceDraftResponse>
}
