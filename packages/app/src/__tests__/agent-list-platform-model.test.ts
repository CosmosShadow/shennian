// @covers packages/app/src/features/agents/desktopAgentListActions.ts
// @covers packages/app/src/features/agents/useAgentListModel.web.ts
// @covers packages/app/src/features/agents/useAgentListModel.native.ts
// @covers packages/app/src/features/agents/deleteAgentWorkspace.native.ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { AgentWorkspace } from '@shennian/wire'
import { createDesktopAgentListActions } from '../features/agents/desktopAgentListActions'
import { deleteAgentWorkspace } from '../features/agents/deleteAgentWorkspace.native'
import {
  clearAgentListSnapshots,
  getAgentListSnapshot,
  setAgentListSnapshot,
} from '../features/agents/agentListCache'

const nativeDelete = vi.hoisted(() => ({
  deleteAgent: vi.fn(),
  removeAgent: vi.fn(),
  deleteSession: vi.fn(),
}))

vi.mock('../features/agents/agentAccountClient.native', () => ({
  agentAccountClient: { deleteAgent: nativeDelete.deleteAgent },
}))
vi.mock('../storage/db.native', () => ({
  db: {
    removeAgent: nativeDelete.removeAgent,
    deleteSession: nativeDelete.deleteSession,
  },
}))

const agent = { id: 'agent-1', pinnedAt: null, sessions: [] } as unknown as AgentWorkspace

afterEach(() => {
  vi.clearAllMocks()
  clearAgentListSnapshots()
})

function setup() {
  let current = true
  const client = { updateAgent: vi.fn(async () => agent), deleteAgent: vi.fn(async () => {}) }
  const onError = vi.fn()
  return { client, onError, leave: () => { current = false },
    actions: createDesktopAgentListActions({ client, onError, isCurrent: () => current }) }
}

it('keeps the Native row and local projection when remote deletion fails', async () => {
  const other = { ...agent, id: 'agent-2' }
  setAgentListSnapshot('account-1', [agent, other])
  nativeDelete.deleteAgent.mockRejectedValueOnce(new Error('offline'))

  await expect(deleteAgentWorkspace('account-1', agent)).rejects.toThrow('offline')

  expect(nativeDelete.removeAgent).not.toHaveBeenCalled()
  expect(nativeDelete.deleteSession).not.toHaveBeenCalled()
  expect(getAgentListSnapshot('account-1')).toEqual([agent, other])
})

it('removes Native sessions and the cached row only after remote deletion succeeds', async () => {
  const target = {
    ...agent,
    sessions: [{ id: 'session-1' }, { id: 'session-2' }],
  } as AgentWorkspace
  const other = { ...agent, id: 'agent-2' }
  setAgentListSnapshot('account-1', [target, other])
  nativeDelete.deleteAgent.mockResolvedValueOnce(undefined)
  nativeDelete.removeAgent.mockResolvedValueOnce(undefined)
  nativeDelete.deleteSession.mockResolvedValue(undefined)

  await deleteAgentWorkspace('account-1', target)

  expect(nativeDelete.deleteAgent).toHaveBeenCalledExactlyOnceWith('agent-1')
  expect(nativeDelete.removeAgent).toHaveBeenCalledExactlyOnceWith('account-1', 'agent-1')
  expect(nativeDelete.deleteSession.mock.calls).toEqual([['session-1'], ['session-2']])
  expect(nativeDelete.deleteAgent.mock.invocationCallOrder[0]).toBeLessThan(
    nativeDelete.removeAgent.mock.invocationCallOrder[0],
  )
  expect(getAgentListSnapshot('account-1')).toEqual([other])
})

it('sends pin and delete commands without altering the projected Agent snapshot', async () => {
  const h = setup()
  await h.actions.togglePin(agent)
  expect(h.client.updateAgent).toHaveBeenCalledWith('agent-1', { pinned: true })
  await h.actions.remove(agent)
  expect(h.client.deleteAgent).toHaveBeenCalledWith('agent-1')
  expect(agent.pinnedAt).toBeNull()
  expect(h.onError).not.toHaveBeenCalled()
})
it('serializes actions for one Agent while allowing another Agent action', async () => {
  const h = setup()
  let finish!: (value: AgentWorkspace) => void
  h.client.updateAgent.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const pin = h.actions.togglePin(agent)
  await h.actions.remove(agent)
  expect(h.client.deleteAgent).not.toHaveBeenCalled()
  await h.actions.remove({ ...agent, id: 'agent-2' })
  expect(h.client.deleteAgent).toHaveBeenCalledExactlyOnceWith('agent-2')
  finish(agent)
  await pin
})
it('ignores stale account actions and suppresses errors from the old account', async () => {
  const h = setup()
  let reject!: (reason: Error) => void
  h.client.deleteAgent.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
  const deletion = h.actions.remove(agent)
  h.leave()
  reject(new Error('denied'))
  await deletion
  await h.actions.togglePin(agent)
  expect(h.client.updateAgent).not.toHaveBeenCalled()
  expect(h.onError).not.toHaveBeenCalled()
})
it('reports explicit command failure without hiding the existing row', async () => {
  const h = setup()
  h.client.deleteAgent.mockRejectedValueOnce(new Error('offline'))
  await h.actions.remove(agent)
  expect(h.onError).toHaveBeenCalledExactlyOnceWith('delete')
  expect(agent.id).toBe('agent-1')
})
it('keeps database mutations in Native and the Desktop list on the existing main revision projection', () => {
  const read = (file: string) => readFileSync(resolve(__dirname, file), 'utf8')
  const route = read('../../app/(main)/agents/index.tsx')
  const web = read('../features/agents/useAgentListModel.web.ts')
  const native = [
    read('../features/agents/useAgentListModel.native.ts'),
    read('../features/agents/deleteAgentWorkspace.native.ts'),
  ].join('\n')
  expect(route).toContain('useAgentListModel()')
  expect(web).toContain('useDesktopAgentSidebarModel()')
  expect(web).toContain("from './agentAccountClient.web'")
  for (const source of [route, web, read('../features/agents/desktopAgentListActions.ts')]) {
    for (const mutation of ['db.replaceAgents', 'db.upsertAgent', 'db.removeAgent', 'db.deleteSession']) {
      expect(source).not.toContain(mutation)
    }
  }
  for (const mutation of ['db.replaceAgents', 'db.upsertAgent', 'db.removeAgent', 'db.deleteSession']) {
    expect(native).toContain(mutation)
  }
})
