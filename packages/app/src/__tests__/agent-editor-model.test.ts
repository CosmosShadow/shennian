// @covers ../features/agents/agentEditorModel.native.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentWorkspace } from '@shennian/wire'

const mocks = vi.hoisted(() => ({
  nativeDb: { getAgent: vi.fn(), upsertAgent: vi.fn(), removeAgent: vi.fn() },
  api: { getAgent: vi.fn(), createAgent: vi.fn(), updateAgent: vi.fn() },
}))
vi.mock('../storage/db.native', () => ({ db: mocks.nativeDb }))
vi.mock('../features/agents/agentAccountClient.native', () => ({ agentAccountClient: mocks.api }))
import { createAgentEditorModel as nativeModel, createAgentWithAvatar as nativeCreate } from '../features/agents/agentEditorModel.native'

const agent = { id: 'a-1', displayName: 'Agent', systemPrompt: 'configuration', sessions: [], avatar: null,
  configurationVersion: 1, updatedAt: '2026-09-12T00:00:00.000Z' } as unknown as AgentWorkspace
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
function context() {
  return { accountId: 'account-1', agentId: 'a-1', isCurrent: vi.fn(() => true), onAgent: vi.fn(), onError: vi.fn() }
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.nativeDb.getAgent.mockResolvedValue(agent)
  mocks.api.getAgent.mockResolvedValue(agent)
  mocks.api.createAgent.mockResolvedValue(agent)
  mocks.api.updateAgent.mockResolvedValue({ ...agent, configurationVersion: 2 })
})

describe('Native Agent editor persistence', () => {
  it('does not resurrect late cached data after a confirmed missing Agent', async () => {
    const c = context()
    const cached = deferred<AgentWorkspace>()
    mocks.nativeDb.getAgent.mockReturnValueOnce(cached.promise)
    mocks.api.getAgent.mockRejectedValueOnce({ status: 404 })
    const stop = nativeModel(c).start()
    await vi.waitFor(() => expect(c.onAgent).toHaveBeenCalledWith(null))
    cached.resolve(agent)
    await Promise.resolve()
    expect(c.onAgent).toHaveBeenCalledOnce()
    expect(mocks.nativeDb.removeAgent).toHaveBeenCalledWith('account-1', 'a-1')
    stop()
  })
  it('loads cached configuration and saves the authoritative entity before publishing', async () => {
    const c = context()
    const model = nativeModel(c)
    const stop = model.start()
    await vi.waitFor(() => expect(mocks.nativeDb.upsertAgent).toHaveBeenCalledWith('account-1', agent))
    await model.save({ displayName: 'changed' })
    expect(mocks.nativeDb.upsertAgent).toHaveBeenLastCalledWith('account-1', { ...agent, configurationVersion: 2 })
    expect(c.onAgent).toHaveBeenLastCalledWith({ ...agent, configurationVersion: 2 })
    stop()
  })

  it('merges avatar acknowledgements into the latest cached configuration', async () => {
    const c = context()
    const model = nativeModel(c)
    const stop = model.start()
    await vi.waitFor(() => expect(mocks.nativeDb.upsertAgent).toHaveBeenCalled())
    const latest = { ...agent, systemPrompt: 'newer saved configuration' }
    mocks.nativeDb.getAgent.mockResolvedValue(latest)
    const avatar = { version: 'v2' } as NonNullable<AgentWorkspace['avatar']>
    await model.avatarChanged(agent, avatar)
    expect(mocks.nativeDb.upsertAgent).toHaveBeenLastCalledWith('account-1', { ...latest, avatar })
    stop()
  })

  it('does not persist a late save after switching accounts', async () => {
    const c = context()
    const model = nativeModel(c)
    const stop = model.start()
    await vi.waitFor(() => expect(mocks.nativeDb.upsertAgent).toHaveBeenCalled())
    mocks.nativeDb.upsertAgent.mockClear()
    const save = deferred<AgentWorkspace>()
    mocks.api.updateAgent.mockReturnValueOnce(save.promise)
    const pending = model.save({})
    c.isCurrent.mockReturnValue(false)
    save.resolve(agent)
    await expect(pending).rejects.toThrow('context_changed')
    expect(mocks.nativeDb.upsertAgent).not.toHaveBeenCalled()
    stop()
  })
})

describe('Native Agent creation', () => {
  it('creates exactly once when avatar upload fails', async () => {
    const onAvatarError = vi.fn()
    const id = await nativeCreate({ accountId: 'account-1', draft: { displayName: 'new' }, isCurrent: () => true,
      uploadAvatar: vi.fn().mockRejectedValue(new Error('upload failed')), onAvatarError })
    expect(id).toBe('a-1')
    expect(mocks.api.createAgent).toHaveBeenCalledExactlyOnceWith({ displayName: 'new' })
    expect(onAvatarError).toHaveBeenCalledOnce()
    expect(mocks.nativeDb.upsertAgent).toHaveBeenCalledTimes(1)
  })

  it('does not upload or persist after account changed during creation', async () => {
    let current = true
    mocks.api.createAgent.mockImplementation(async () => { current = false; return agent })
    const uploadAvatar = vi.fn()
    await expect(nativeCreate({ accountId: 'account-1', draft: {}, isCurrent: () => current,
      uploadAvatar, onAvatarError: vi.fn() })).rejects.toThrow('context_changed')
    expect(uploadAvatar).not.toHaveBeenCalled()
    expect(mocks.nativeDb.upsertAgent).not.toHaveBeenCalled()
  })
})
