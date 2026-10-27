// @arch open-source/docs/server-runtime.md
// @test src/__tests__/voice-chief-control.test.ts

import type { VoiceChiefReadableMessage } from '@shennian/wire'

type CacheEntry = {
  callId: string
  sessionId: string
  bodyRevision: number
  expiresAt: number
  messages: VoiceChiefReadableMessage[]
}

const cache = new Map<string, CacheEntry>()

function key(callId: string, sessionId: string, bodyRevision: number): string {
  return JSON.stringify([callId, sessionId, bodyRevision])
}

export function readVoiceBodyCache(
  callId: string,
  sessionId: string,
  bodyRevision: number,
): VoiceChiefReadableMessage[] | null {
  const entry = cache.get(key(callId, sessionId, bodyRevision))
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key(callId, sessionId, bodyRevision))
    return null
  }
  return entry.messages
}

export function writeVoiceBodyCache(input: CacheEntry): void {
  for (const [entryKey, entry] of cache.entries()) {
    if (entry.callId === input.callId && entry.sessionId === input.sessionId
      && entry.bodyRevision !== input.bodyRevision) cache.delete(entryKey)
  }
  cache.set(key(input.callId, input.sessionId, input.bodyRevision), input)
}

export function invalidateVoiceBodyCacheForSession(sessionId: string): void {
  for (const [entryKey, entry] of cache.entries()) {
    if (entry.sessionId === sessionId) cache.delete(entryKey)
  }
}

export function invalidateVoiceBodyCacheForCall(callId: string): void {
  for (const [entryKey, entry] of cache.entries()) {
    if (entry.callId === callId) cache.delete(entryKey)
  }
}

export function resetVoiceBodyCache(): void {
  cache.clear()
}
