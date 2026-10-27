// @covers packages/app/src/features/voice/voiceAccountClient.web.ts
// @covers packages/app/src/features/voice/voiceAccountClient.native.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { voiceAccountClient as desktop } from '../features/voice/voiceAccountClient.web'
import { voiceAccountClient as native } from '../features/voice/voiceAccountClient.native'
const { authApi } = vi.hoisted(() => ({ authApi: vi.fn() }))
vi.mock('../config/api', () => ({ authApi }))
type Root = typeof globalThis & { shennianDesktop?: unknown }
const draft = { transcript: 'Hello', draft: 'Hello', intent: 'new', model: 'model-1' }
afterEach(() => {
  delete (globalThis as Root).shennianDesktop
  vi.resetAllMocks()
})
describe('Voice account platform client', () => {
  it('preserves cleanup false without exposing recorded-file upload on Desktop', async () => {
    const execute = vi.fn().mockResolvedValueOnce({ ok: true, value: draft })
    ;(globalThis as Root).shennianDesktop = { account: { execute } }
    const text = { sessionId: 'session-1', transcript: 'Hello', currentDraft: '', cleanup: false }
    await expect(desktop.finalizeText(text)).resolves.toEqual(draft)
    expect(Object.prototype.hasOwnProperty.call(desktop, 'createDraft')).toBe(false)
    expect(execute.mock.calls.map(([command]) => [command.operation, command.input])).toEqual([
      ['voice.text.finalize', text],
    ])
    expect(authApi).not.toHaveBeenCalled()
  })
  it('does not convert missing bridge or main failures to a successful transcript', async () => {
    const input = { sessionId: 'session-1', transcript: 'Hello' }
    await expect(desktop.finalizeText(input)).rejects.toMatchObject({ code: 'BRIDGE_UNAVAILABLE' })
    const execute = vi.fn().mockResolvedValue({ ok: false, error: {
      code: 'AUTH_REQUIRED', message: 'Sign in', retryable: false, action: 'sign_in',
    } })
    ;(globalThis as Root).shennianDesktop = { account: { execute } }
    for (const cleanup of [false, true]) {
      await expect(desktop.finalizeText({ ...input, cleanup })).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
    }
    expect(execute).toHaveBeenCalledTimes(2)
    expect(authApi).not.toHaveBeenCalled()
  })
  it('rejects invalid draft responses', async () => {
    const execute = vi.fn()
    ;(globalThis as Root).shennianDesktop = { account: { execute } }
    for (const value of [null, {}, { ...draft, transcript: 1 }, { ...draft, intent: 'invalid' }]) {
      execute.mockResolvedValueOnce({ ok: true, value })
      await expect(desktop.finalizeText({ sessionId: 'session-1', transcript: 'Hello' }))
        .rejects.toMatchObject({ code: 'INVALID_OUTPUT' })
    }
  })
  it('keeps Native HTTP payloads and the existing local transcript on processing failure', async () => {
    const input = { sessionId: 'session-1', transcript: 'Hello', currentDraft: '', cleanup: false }
    authApi.mockResolvedValueOnce(draft)
    await expect(native.finalizeText(input)).resolves.toEqual(draft)
    expect(authApi).toHaveBeenLastCalledWith('/voice/finalize-text', { method: 'POST', body: JSON.stringify(input) })
    authApi.mockRejectedValueOnce(new Error('offline'))
    await expect(native.finalizeText(input)).resolves.toMatchObject({ draft: 'Hello', model: 'client-transcript' })
    const audio = { sessionId: 'session-1', audioBase64: 'AQID' }
    authApi.mockResolvedValueOnce(draft)
    await expect(native.createDraft(audio)).resolves.toEqual(draft)
    expect(authApi).toHaveBeenLastCalledWith('/voice/draft', { method: 'POST', body: JSON.stringify(audio) })
  })
})
