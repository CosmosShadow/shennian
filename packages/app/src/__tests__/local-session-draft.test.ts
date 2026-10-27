// @covers packages/app/src/features/sessions/localSessionDraft.ts
import { describe, expect, it, vi } from 'vitest'
import { buildLocalSessionDraft, createLocalSessionPromoter } from '../features/sessions/localSessionDraft'
import { mergeSessionPatch } from '../../../../open-source/packages/shared/src/lib/sync-session-state'
import type { NianSession } from '@shennian/wire'

const input = { machineId: 'machine', workDir: '/project', agentType: 'codex' as const, modelId: 'gpt-6-astra', sessionMode: 'standard' as const }
function setup() {
  let record: NianSession | undefined = buildLocalSessionDraft(input, 'account', 'sess-test')
  const create = vi.fn(async (_id: string, _input: import('../features/machines/machineAccountClient.types').MachineSessionCreateInput): Promise<NianSession> => ({ ...record!, localCreationState: undefined }))
  const persist = vi.fn(async (value: NianSession) => { record = value })
  const publish = vi.fn()
  let account = 'account'
  const ensure = createLocalSessionPromoter({ read: async () => record, create, persist, publish, accountId: () => account })
  return { ensure, create, persist, publish, read: () => record, delete: () => { record = undefined }, switchAccount: () => { account = 'other' } }
}

describe('local conversation lifecycle', () => {
  it('never demotes a created session when a stale composer draft is persisted', () => {
    const draft = buildLocalSessionDraft(input, 'account', 'sess-test')
    expect(mergeSessionPatch({ ...draft, localCreationState: 'created' }, draft).localCreationState).toBe('created')
  })
  it('creates a complete local-only Codex/model configuration without a service call', () => {
    const test = setup()
    expect(test.read()).toMatchObject({ ...input, localCreationState: 'draft', bodyRevision: 0, userId: 'account' })
    expect(test.create).not.toHaveBeenCalled()
    expect(JSON.parse(JSON.stringify(test.read()))).toMatchObject({ modelId: 'gpt-6-astra', agentType: 'codex' })
  })
  it('coalesces sends and durably promotes the same ID before publishing', async () => {
    const test = setup()
    await Promise.all([test.ensure('sess-test'), test.ensure('sess-test')])
    expect(test.create).toHaveBeenCalledTimes(1)
    expect(test.create).toHaveBeenCalledWith('sess-test', expect.objectContaining(input))
    expect(test.read()).toMatchObject({ id: 'sess-test', localCreationState: 'created', modelId: 'gpt-6-astra' })
    await test.ensure('sess-test')
    expect(test.create).toHaveBeenCalledTimes(1)
    expect(test.persist.mock.invocationCallOrder[0]).toBeLessThan(test.publish.mock.invocationCallOrder[0])
  })
  it('retains the draft when creation times out and retries with the same ID', async () => {
    const test = setup()
    test.create.mockRejectedValueOnce(new Error('timeout'))
    await expect(test.ensure('sess-test')).rejects.toThrow('timeout')
    expect(test.read()?.localCreationState).toBe('draft')
    expect(test.publish).not.toHaveBeenCalled()
    await test.ensure('sess-test')
    expect(test.create.mock.calls.map((args) => args[0])).toEqual(['sess-test', 'sess-test'])
  })
  it('does not publish or send after local persistence fails', async () => {
    const test = setup()
    test.persist.mockRejectedValueOnce(new Error('disk full'))
    await expect(test.ensure('sess-test')).rejects.toThrow('disk full')
    expect(test.publish).not.toHaveBeenCalled()
    expect(test.read()?.localCreationState).toBe('draft')
  })
  it('never resurrects a deleted draft or crosses accounts after a delayed response', async () => {
    for (const action of ['delete', 'switchAccount'] as const) {
      const test = setup()
      const remote = { ...test.read()! }
      test.create.mockImplementationOnce(async () => { test[action](); return remote })
      await expect(test.ensure('sess-test')).rejects.toThrow()
      expect(test.persist).not.toHaveBeenCalled()
      expect(test.publish).not.toHaveBeenCalled()
    }
  })
  it('rejects a mismatched response rather than silently switching IDs', async () => {
    const test = setup()
    test.create.mockResolvedValueOnce({ ...test.read()!, id: 'wrong', localCreationState: undefined })
    await expect(test.ensure('sess-test')).rejects.toThrow('identity mismatch')
    expect(test.publish).not.toHaveBeenCalled()
  })
})
