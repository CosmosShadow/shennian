// @covers packages/app/src/features/sessions/sessionAccountClient.web.ts
// @covers packages/app/src/features/sessions/sessionAccountClient.native.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sessionAccountClient as desktop } from '../features/sessions/sessionAccountClient.web'
import { sessionAccountClient as native } from '../features/sessions/sessionAccountClient.native'

const { authApi } = vi.hoisted(() => ({ authApi: vi.fn() }))
vi.mock('../config/api', () => ({ authApi }))
type Root = typeof globalThis & { shennianDesktop?: unknown }
const session = { id: 'session-1', machineId: 'machine-1', agentType: 'codex', workDir: '/project' }
afterEach(() => {
  delete (globalThis as Root).shennianDesktop
  vi.clearAllMocks()
})

describe('Session platform boundary', () => {
  it('sends rename and both model actions through main without authenticated HTTP', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true, value: {} })
    ;(globalThis as Root).shennianDesktop = { account: { execute } }
    const changes = [{ title: 'Renamed' }, { modelId: 'model-1', modelSource: 'session' as const },
      { modelSource: 'agent' as const }]
    for (const change of changes) await desktop.updateSession('session-1', change)
    expect(execute.mock.calls.map(([command]) => command)).toEqual(changes.map((change) => ({
      requestId: expect.stringMatching(/^session-account-/), operation: 'session.update',
      input: { sessionId: 'session-1', changes: change },
    })))
    expect(authApi).not.toHaveBeenCalled()
  })

  it('maps create settings and rejects a mismatched session lookup result', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true, value: { session } })
    ;(globalThis as Root).shennianDesktop = { account: { execute } }
    await expect(desktop.createSession({ machineId: 'machine-1', agentType: 'codex',
      workDir: '/project', modelId: 'model-1' })).resolves.toEqual(session)
    expect(execute).toHaveBeenCalledWith({ requestId: expect.any(String), operation: 'session.create',
      input: { machineId: 'machine-1', agentType: 'codex', workDir: '/project', settings: { modelId: 'model-1' } } })
    await expect(desktop.getSession('session-1')).resolves.toEqual(session)
    await expect(desktop.getSession('different-session')).rejects.toMatchObject({ code: 'INVALID_OUTPUT' })
  })

  it('propagates main errors without retrying HTTP and fails if the bridge is absent', async () => {
    await expect(desktop.updateSession('session-1', { title: 'Title' }))
      .rejects.toMatchObject({ code: 'BRIDGE_UNAVAILABLE' })
    const execute = vi.fn().mockResolvedValue({ ok: false, error: {
      code: 'AUTH_REQUIRED', message: 'Sign in required', retryable: false, action: 'sign_in',
    } })
    ;(globalThis as Root).shennianDesktop = { account: { execute } }
    await expect(desktop.updateSession('session-1', { modelSource: 'agent' }))
      .rejects.toMatchObject({ code: 'AUTH_REQUIRED', action: 'sign_in', retryable: false })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(authApi).not.toHaveBeenCalled()
  })

  it('preserves native request payloads and URL-encodes session identifiers', async () => {
    authApi.mockResolvedValue({ session })
    const input = { machineId: 'machine-1', agentType: 'codex' as const, workDir: '/project', modelId: 'model-1' }
    await expect(native.createSession(input)).resolves.toEqual(session)
    expect(authApi).toHaveBeenLastCalledWith('/sessions', { method: 'POST', body: JSON.stringify(input) })
    await native.updateSession('session/1', { title: 'Name' })
    expect(authApi).toHaveBeenLastCalledWith('/sessions/session%2F1', {
      method: 'PATCH', body: JSON.stringify({ title: 'Name' }),
    })
    await expect(native.getSession('session/1')).resolves.toEqual(session)
    expect(authApi).toHaveBeenLastCalledWith('/sessions/index/session%2F1')
  })
})
