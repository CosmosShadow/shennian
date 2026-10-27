// @arch docs/features/voice-shennian.md
// @covers packages/app/src/features/voice-chief/voiceChiefUrl.ts

import { afterEach, describe, expect, it, vi } from 'vitest'

function reset() {
  vi.resetModules()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
}

async function importWithServer(url: string) {
  vi.doMock('../config/server', () => ({
    getServerUrl: () => url,
  }))
  return import('../features/voice-chief/voiceChiefUrl')
}

afterEach(reset)

describe('voice chief websocket URL', () => {
  it('uses the public /api websocket proxy in production', async () => {
    const { buildVoiceChiefUrl } = await importWithServer('https://shennian.net')
    const url = new URL(buildVoiceChiefUrl('abc'))
    expect(`${url.protocol}//${url.host}${url.pathname}`).toBe(
      'wss://shennian.net/api/voice-chief/ws',
    )
    expect(url.searchParams.get('token')).toBe('abc')
    expect(url.searchParams.get('syncProtocol')).toBe('2')
    expect(url.searchParams.get('dataEpoch')).toBe('2')
  })

  it('keeps localhost direct for local development', async () => {
    const { buildVoiceChiefUrl } = await importWithServer('http://127.0.0.1:3000')
    const url = new URL(buildVoiceChiefUrl('a b'))
    expect(`${url.protocol}//${url.host}${url.pathname}`).toBe(
      'ws://127.0.0.1:3000/voice-chief/ws',
    )
    expect(url.searchParams.get('token')).toBe('a b')
    expect(url.searchParams.get('syncProtocol')).toBe('2')
    expect(url.searchParams.get('dataEpoch')).toBe('2')
  })
})
