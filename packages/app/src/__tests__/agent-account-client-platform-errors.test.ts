// @covers packages/app/src/features/agents/agentAccountClient.native.ts
// @covers packages/app/src/features/agents/agentAccountClient.web.ts
// @covers packages/app/src/features/agents/agentCardFailure.ts
import { describe, expect, it, vi } from 'vitest'
// @covers packages/app/src/features/agents/startAgentConversation.ts
import type { NianSession } from '@shennian/wire'
import { createAgentConversationStarter } from '../features/agents/startAgentConversation'
import { ApiError } from '@shennian/shared/api'
import { recoverAgentCardFailure } from '../features/agents/agentCardFailure'
vi.mock('../config/api', () => ({ authApi: vi.fn() }))
import { isAgentAccountNotFound as nativeNotFound } from '../features/agents/agentAccountClient.native'
import { isAgentAccountNotFound as webNotFound } from '../features/agents/agentAccountClient.web'

describe.each([['native', nativeNotFound], ['web', webNotFound]] as const)(
  '%s Agent account failure handling', (_platform, isNotFound) => {
    it('distinguishes a removed agent from a temporary request or authentication failure', () => {
      expect(isNotFound({ status: 404 })).toBe(true)
      expect(isNotFound({ code: 'NOT_FOUND' })).toBe(true)
      expect(isNotFound({ status: 503 })).toBe(false)
      expect(isNotFound({ status: 401 })).toBe(false)
      expect(isNotFound(new TypeError('network unavailable'))).toBe(false)
      expect(isNotFound(null)).toBe(false)
    })
  },
)

function fixture(overrides: Partial<Parameters<typeof recoverAgentCardFailure<{ policyVersion: number }>>[0]> = {}) {
  return {
    error: new ApiError(409, '{"error":"agent_publication_conflict"}'),
    current: { policyVersion: 1 }, zh: true, activating: false,
    readPublication: vi.fn().mockResolvedValue({ publication: { policyVersion: 2 } }),
    readReadiness: vi.fn().mockResolvedValue({ readiness: { blockers: [] } }),
    ...overrides,
  }
}

describe('AI card failure recovery', () => {
  it('refreshes CAS versions without replaying a write', async () => {
    const input = fixture()
    const result = await recoverAgentCardFailure(input)
    expect(result.publication.policyVersion).toBe(2)
    expect(result.message).toContain('已刷新')
    expect(input.readPublication).toHaveBeenCalledTimes(1)
    expect(input.readReadiness).not.toHaveBeenCalled()
  })

  it.each([
    ['machine_offline', '电脑离线', 'offline'],
    ['runtime_permission_unconfirmed', '确认并保存运行权限', 'confirm and save'],
    ['runtime_auth_unverified', '完成 AI 登录', 'Sign in to the AI'],
    ['runtime_unavailable', '更新 Client', 'Update Client'],
    ['runtime_capability_gap', '不会自动放宽权限', 'not be relaxed'],
  ])('explains %s in both languages', async (blocker, zh, en) => {
    for (const [language, message] of [[true, zh], [false, en]] as const) {
      const result = await recoverAgentCardFailure(fixture({ activating: true, zh: language,
        readReadiness: vi.fn().mockResolvedValue({ readiness: { blockers: [blocker] } }) }))
      expect(result.message).toContain(message)
    }
  })

  it('does not mislabel a settings conflict as runtime failure', async () => {
    const input = fixture({ readReadiness: vi.fn().mockResolvedValue({ readiness: {
      blockers: ['machine_offline'],
    } }) })
    expect((await recoverAgentCardFailure(input)).message).not.toContain('电脑离线')
    expect(input.readReadiness).not.toHaveBeenCalled()
  })

  it('keeps known state when refresh fails and does not claim success', async () => {
    const input = fixture({ readPublication: vi.fn().mockRejectedValue(new Error('offline')) })
    const result = await recoverAgentCardFailure(input)
    expect(result.publication).toBe(input.current)
    expect(result.message).toContain('刷新失败')
  })

  it('does not replace known state with a missing publication', async () => {
    const input = fixture({ readPublication: vi.fn().mockResolvedValue({ publication: null }) })
    expect((await recoverAgentCardFailure(input)).publication).toBe(input.current)
  })

  it('handles an unavailable readiness endpoint without hiding the conflict', async () => {
    const result = await recoverAgentCardFailure(fixture({ activating: true,
      readReadiness: vi.fn().mockRejectedValue(new ApiError(404, 'not found')) }))
    expect(result.message).toContain('设置已变化')
  })

  it('does not query protected data again after auth fails or echo raw errors', async () => {
    const input = fixture({ error: new ApiError(403, 'sensitive server details') })
    const result = await recoverAgentCardFailure(input)
    expect(result.message).toContain('账号权限')
    expect(result.message).not.toContain('sensitive')
    expect(input.readPublication).not.toHaveBeenCalled()
    expect(input.readReadiness).not.toHaveBeenCalled()
  })

  it('refreshes after a lost write response without claiming the write failed', async () => {
    const input = fixture({ error: new Error('network disconnected'), activating: true })
    const result = await recoverAgentCardFailure(input)
    expect(result.publication.policyVersion).toBe(2)
    expect(result.message).toContain('无法确认')
    expect(input.readReadiness).not.toHaveBeenCalled()
  })
  it('does not turn offline runtime diagnostics into a sharing gate on the new server', async () => {
    const result = await recoverAgentCardFailure(fixture({ activating: true,
      readReadiness: vi.fn().mockResolvedValue({ readiness: {
        activationAvailable: true, blockers: ['machine_offline', 'runtime_permission_unconfirmed'],
      } }) }))
    expect(result.message).toContain('设置已变化')
    expect(result.message).not.toContain('电脑离线')
    expect(result.message).not.toContain('确认并保存运行权限')
  })

})

const session = { id: 'session-1', agentIdentityId: 'agent-1' } as NianSession
function setup() {
  const deps = {
    newIntent: vi.fn(() => 'intent-1'),
    create: vi.fn(async () => session),
    persist: vi.fn(async (_session: NianSession) => {}),
    open: vi.fn(),
    isCurrent: vi.fn(() => true),
    setBusy: vi.fn(),
  }
  return { deps, start: createAgentConversationStarter(deps) }
}

describe('start an owner AI conversation', () => {
  it('persists the agent-owned session before opening the existing chat', async () => {
    const { deps, start } = setup()
    await start()
    expect(deps.create).toHaveBeenCalledWith('intent-1')
    expect(deps.persist).toHaveBeenCalledWith(session)
    expect(deps.open).toHaveBeenCalledWith('session-1')
    expect(deps.persist.mock.invocationCallOrder[0]).toBeLessThan(deps.open.mock.invocationCallOrder[0])
    expect(deps.setBusy.mock.calls).toEqual([[true], [false]])
  })

  it('ignores repeat taps while creating, and creates a new chat on a later click', async () => {
    const { deps, start } = setup()
    const first = start()
    await start()
    await first
    expect(deps.create).toHaveBeenCalledTimes(1)
    await start()
    expect(deps.newIntent).toHaveBeenCalledTimes(2)
    expect(deps.create).toHaveBeenCalledTimes(2)
  })

  it('reuses the idempotent intent after a failed request', async () => {
    const { deps, start } = setup()
    deps.create.mockRejectedValueOnce(new Error('network'))
    await expect(start()).rejects.toThrow('network')
    expect(deps.open).not.toHaveBeenCalled()
    await start()
    expect(deps.newIntent).toHaveBeenCalledTimes(1)
    expect(deps.create.mock.calls).toEqual([['intent-1'], ['intent-1']])
  })

  it('retries local persistence without creating a second server session', async () => {
    const { deps, start } = setup()
    deps.persist.mockRejectedValueOnce(new Error('storage'))
    await expect(start()).rejects.toThrow('storage')
    expect(deps.open).not.toHaveBeenCalled()
    await start()
    expect(deps.create).toHaveBeenCalledTimes(1)
    expect(deps.open).toHaveBeenCalledWith('session-1')
  })

  it('does not persist or navigate when the account or route changes during creation', async () => {
    const { deps, start } = setup()
    const pending = start()
    deps.isCurrent.mockReturnValue(false)
    await pending
    expect(deps.persist).not.toHaveBeenCalled()
    expect(deps.open).not.toHaveBeenCalled()
    await start()
    expect(deps.create).toHaveBeenCalledTimes(1)
  })

  it('does not navigate if the account changes during persistence', async () => {
    const { deps, start } = setup()
    deps.persist.mockImplementationOnce(async () => { deps.isCurrent.mockReturnValue(false) })
    await start()
    expect(deps.open).not.toHaveBeenCalled()
  })

})
