// @arch docs/features/voice-shennian.md
// @test src/__tests__/voice-chief-transcript.test.ts

import type { VoiceChiefTranscript } from './useVoiceChiefCall.types'

export function normalizeVoiceChiefTranscriptDisplay(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
}

export function mergeVoiceChiefTranscript(
  current: VoiceChiefTranscript[],
  input: {
    role: VoiceChiefTranscript['role']
    text: string
    final: boolean
    responseId?: string
    completedAt?: number
  },
): VoiceChiefTranscript[] {
  const baseId = input.role === 'chief' ? `chief:${input.responseId || 'active'}` : 'user:active'
  const index = current.findIndex((item) => item.id === baseId && !item.final)
  if (index < 0) {
    return [
      ...current,
      {
        id: input.final ? `${baseId}:${input.completedAt ?? Date.now()}` : baseId,
        role: input.role,
        text: input.text,
        final: input.final,
      },
    ].slice(-80)
  }

  const next = [...current]
  const previous = current[index]
  next[index] = {
    id: input.final ? `${baseId}:${input.completedAt ?? Date.now()}` : baseId,
    role: input.role,
    text: input.final ? input.text : `${previous.text}${input.text}`,
    final: input.final,
  }
  return next.slice(-80)
}
